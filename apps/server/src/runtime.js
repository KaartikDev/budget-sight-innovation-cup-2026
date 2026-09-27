import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  PRICING_VERSION,
  billableToolKind,
  budgetState,
  estimateGenerationMicros,
  estimateToolUsageMicros,
  estimateUsageMicros,
  normalizeToolUsage,
  normalizeUsage,
  tokenEnvelope,
} from "@budgetsight/shared";
import { config } from "./config.js";
import { codexAppServer } from "./codex-app-server.js";
import { db, hydrateTask, json, now, parseJson, audit } from "./db.js";
import { publish } from "./events.js";
import { repositorySnapshot } from "./repositories.js";

function taskRow(id) {
  return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
}

export function getTask(id) {
  return hydrateTask(taskRow(id));
}

export function taskPaths(task) {
  const root = path.join(config.dataDir, "tasks", task.userId, task.id);
  return { root, inputs: path.join(root, "inputs"), tmp: path.join(root, "tmp") };
}

function ensureTaskPaths(task) {
  const paths = taskPaths(task);
  for (const target of Object.values(paths)) fs.mkdirSync(target, { recursive: true });
  return paths;
}

function emitLocal(taskId, type, data = {}) {
  const payload = { type, taskId, createdAt: now(), ...data };
  publish(taskId, payload);
  return payload;
}

function saveRepoSnapshot(task, phase, turnId = null) {
  if (!task?.repository?.path) return;
  const snapshot = repositorySnapshot(task.repository.path);
  db.prepare(
    "INSERT INTO repo_snapshots(task_id,phase,turn_id,raw_json,created_at) VALUES(?,?,?,?,?)",
  ).run(task.id, phase, turnId, json(snapshot), now());
}

const USAGE_FIELDS = [
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
];

function usageDelta(current, previous) {
  if (!current) return null;
  if (!previous) return current;
  const delta = Object.fromEntries(USAGE_FIELDS.map((field) => [field, current[field] - previous[field]]));
  return USAGE_FIELDS.every((field) => delta[field] >= 0) ? delta : null;
}

function sameUsage(left, right) {
  return Boolean(left && right && USAGE_FIELDS.every((field) => left[field] === right[field]));
}

function toolUsageFromEvents(events) {
  const usage = { webSearchCalls: 0, fileSearchCalls: 0 };
  const seen = new Set();
  for (const event of events) {
    const payload = event.raw_json ? parseJson(event.raw_json, {}) : event;
    const method = event.event_type || payload.method || payload.type;
    if (method !== "item/completed") continue;
    const kind = billableToolKind(payload.item);
    if (!kind) continue;
    const key = payload.item?.id || `${kind}:${event.seq ?? seen.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    usage[`${kind}Calls`] += 1;
  }
  return normalizeToolUsage(usage);
}

function storedToolUsage(taskId) {
  return toolUsageFromEvents(db.prepare(`
    SELECT seq,event_type,raw_json FROM agent_events WHERE task_id=? ORDER BY seq
  `).all(taskId));
}

function nextUsageEstimate(model, previousUsage, previousMicros, tokenUsage) {
  const total = normalizeUsage(tokenUsage?.total ?? tokenUsage);
  const last = normalizeUsage(tokenUsage?.last);
  if (!total) return { usage: null, estimatedMicros: null };
  const delta = usageDelta(total, normalizeUsage(previousUsage));

  if (delta && USAGE_FIELDS.every((field) => delta[field] === 0)) {
    return { usage: total, estimatedMicros: previousMicros ?? estimateUsageMicros(model, total) };
  }

  if (delta && previousMicros != null) {
    const generation = sameUsage(delta, last) ? last : delta;
    return {
      usage: total,
      estimatedMicros: previousMicros + estimateGenerationMicros(model, generation),
    };
  }

  if (!previousUsage && last && sameUsage(total, last)) {
    return { usage: total, estimatedMicros: estimateGenerationMicros(model, last) };
  }

  // A cumulative snapshot without earlier per-response data cannot reveal
  // which calls crossed the long-context threshold. Use standard list rates.
  return { usage: total, estimatedMicros: estimateUsageMicros(model, total) };
}

function saveUsage(task, source, tokenUsage) {
  const measured = nextUsageEstimate(
    task.model,
    task.usage,
    task.pricingVersion === PRICING_VERSION ? task.estimatedTokenCostMicros : null,
    tokenUsage,
  );
  const normalized = measured.usage;
  const toolMicros = task.pricingVersion === PRICING_VERSION
    ? task.estimatedToolCostMicros
    : estimateToolUsageMicros(task.toolUsage);
  const totalMicros = measured.estimatedMicros == null
    ? toolMicros
    : measured.estimatedMicros + toolMicros;
  const state = budgetState(task.model, task.budgetMicros, normalized, {
    estimatedMicros: totalMicros,
  });
  db.prepare(`
    INSERT INTO usage_snapshots(task_id,source,usage_json,estimated_cost_micros,token_envelope,exhausted,created_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(task.id, source, json(normalized), state.estimatedMicros, state.tokenEnvelope, state.exhausted ? 1 : 0, now());
  db.prepare(`
    UPDATE tasks SET latest_usage_json=?, estimated_token_cost_micros=?, estimated_cost_micros=?,
      overrun_micros=?, pricing_version=?, last_active_at=? WHERE id=?
  `).run(
    json(normalized),
    measured.estimatedMicros,
    state.estimatedMicros,
    state.overrunMicros,
    PRICING_VERSION,
    now(),
    task.id,
  );
  emitLocal(task.id, "budgetsight.usage", { usage: normalized, toolUsage: task.toolUsage, budget: state });
  return state;
}

function saveToolUsage(task) {
  const toolUsage = storedToolUsage(task.id);
  const toolMicros = estimateToolUsageMicros(toolUsage);
  const tokenMicros = task.estimatedTokenCostMicros
    ?? (task.usage ? estimateUsageMicros(task.model, task.usage) : null);
  const totalMicros = (tokenMicros || 0) + toolMicros;
  const state = budgetState(task.model, task.budgetMicros, task.usage, {
    estimatedMicros: totalMicros,
  });
  db.prepare(`
    UPDATE tasks SET latest_tool_usage_json=?, estimated_tool_cost_micros=?,
      estimated_token_cost_micros=?, estimated_cost_micros=?, overrun_micros=?,
      pricing_version=?, last_active_at=? WHERE id=?
  `).run(
    json(toolUsage),
    toolMicros,
    tokenMicros,
    totalMicros,
    state.overrunMicros,
    PRICING_VERSION,
    now(),
    task.id,
  );
  emitLocal(task.id, "budgetsight.usage", { usage: task.usage, toolUsage, budget: state });
  return state;
}

async function interruptForBudget(task, state) {
  if (!state.exhausted || !task.activeTurnId || !task.codexThreadId) return false;
  const changed = db.prepare(`
    UPDATE tasks SET status='budget_interrupted', interruption_reason='budget_limit',
      last_turn_outcome='cancel_requested', finished_at=?, last_active_at=?
    WHERE id=? AND status IN ('connecting','running')
  `).run(now(), now(), task.id);
  if (!changed.changes) return false;
  audit({ userId: task.userId, taskId: task.id, action: "budget.auto_cancel", detail: state });
  emitLocal(task.id, "budgetsight.budget.exhausted", { budget: state });
  await codexAppServer.interruptTurn(task.codexThreadId, task.activeTurnId).catch((error) => {
    emitLocal(task.id, "budgetsight.cancel.failed", { message: error.message });
  });
  return true;
}

function taskForThread(threadId) {
  if (!threadId) return null;
  return hydrateTask(db.prepare("SELECT * FROM tasks WHERE openai_session_id=?").get(threadId));
}

function storeEvent(task, message) {
  const method = message.method || "unknown";
  const params = message.params || {};
  const turnId = params.turnId || params.turn?.id || null;
  const item = params.item || null;
  const payload = { type: method, method, ...params };
  const createdAt = now();
  db.prepare(`
    INSERT INTO agent_events(task_id,upstream_id,event_type,turn_id,raw_json,created_at)
    VALUES(?,?,?,?,?,?)
  `).run(task.id, item?.id || null, method, turnId, json(payload), createdAt);
  publish(task.id, { ...payload, localCreatedAt: createdAt });
  return { method, params, turnId, item, createdAt };
}

async function handleCodexMessage(message) {
  const params = message.params || {};
  const threadId = params.threadId || params.thread?.id;
  if (!threadId) {
    if (message.method === "account/rateLimits/updated") {
      const active = db.prepare("SELECT * FROM tasks WHERE status IN ('connecting','running')").all().map(hydrateTask);
      for (const task of active) {
        db.prepare("INSERT INTO rate_limit_snapshots(task_id,operation,headers_json,created_at) VALUES(?,?,?,?)")
          .run(task.id, message.method, json(params), now());
        publish(task.id, { type: message.method, ...params });
      }
    }
    return;
  }
  let task = taskForThread(threadId);
  if (!task) return;
  const event = storeEvent(task, message);

  if (event.method === "turn/started") {
    db.prepare(`
      UPDATE tasks SET status='running', active_turn_id=?, started_at=COALESCE(started_at,?),
        finished_at=NULL, last_active_at=? WHERE id=?
    `).run(event.turnId, event.createdAt, event.createdAt, task.id);
  }

  if (event.method === "thread/tokenUsage/updated") {
    const usage = params.tokenUsage;
    if (usage?.total) {
      task = getTask(task.id);
      const state = saveUsage(task, event.method, usage);
      await interruptForBudget(getTask(task.id), state);
    }
  }

  if (event.method === "item/completed" && billableToolKind(event.item)) {
    task = getTask(task.id);
    const state = saveToolUsage(task);
    await interruptForBudget(getTask(task.id), state);
  }

  if (event.method === "item/completed" && event.item?.type === "agentMessage" && event.item.text) {
    const exists = db.prepare("SELECT id FROM messages WHERE id=?").get(event.item.id);
    if (!exists) {
      db.prepare("INSERT INTO messages(id,task_id,role,text,raw_json,created_at) VALUES(?,?,?,?,?,?)")
        .run(event.item.id, task.id, "assistant", event.item.text, json(event.item), event.createdAt);
    }
  }

  if (event.method === "turn/completed") {
    const status = params.turn?.status || "completed";
    const current = getTask(task.id);
    let nextStatus = "idle_completed";
    let reason = null;
    if (status === "failed") { nextStatus = "failed"; reason = params.turn?.error?.message || "turn_failed"; }
    if (status === "interrupted" && current.status === "budget_interrupted") {
      nextStatus = "budget_interrupted";
      reason = current.interruptionReason || "budget_limit";
    }
    else if (status === "interrupted") { nextStatus = "user_interrupted"; reason = current.interruptionReason || "user_requested"; }
    db.prepare(`
      UPDATE tasks SET status=?, active_turn_id=NULL, last_turn_outcome=?, interruption_reason=?,
        finished_at=?, last_active_at=? WHERE id=?
    `).run(nextStatus, status, reason, event.createdAt, event.createdAt, task.id);
    saveRepoSnapshot(getTask(task.id), "after_turn", event.turnId);
  }

  if (event.method === "error") {
    db.prepare(`
      UPDATE tasks SET status='failed', active_turn_id=NULL, last_turn_outcome='failed',
        interruption_reason=?, finished_at=?, last_active_at=? WHERE id=?
    `).run(params.error?.message || "codex_error", event.createdAt, event.createdAt, task.id);
    saveRepoSnapshot(getTask(task.id), "after_failure", event.turnId);
  }
}

codexAppServer.subscribe(handleCodexMessage);

async function ensureCodexThread(task) {
  if (task.codexThreadId) {
    await codexAppServer.request("thread/resume", { threadId: task.codexThreadId });
    return task;
  }
  ensureTaskPaths(task);
  const thread = await codexAppServer.startThread({
    cwd: task.repository.path,
    model: task.model,
    title: task.title,
  });
  db.prepare(`
    UPDATE tasks SET openai_session_id=?, runtime_provider='codex_app_server', status='idle_completed', last_active_at=? WHERE id=?
  `).run(thread.id, now(), task.id);
  db.prepare("INSERT INTO agent_events(task_id,upstream_id,event_type,raw_json,created_at) VALUES(?,?,?,?,?)")
    .run(task.id, thread.id, "thread/created", json({ type: "thread/created", thread }), now());
  return getTask(task.id);
}

function turnInput(text, attachments) {
  const input = [{ type: "text", text }];
  if (attachments.length) {
    input.push({
      type: "text",
      text: `Attached task files (read them from disk):\n${attachments.map((file) => `- ${file.absolute_path}`).join("\n")}`,
    });
  }
  return input;
}

async function snapshotRateLimits(taskId) {
  try {
    const limits = await codexAppServer.readRateLimits();
    db.prepare("INSERT INTO rate_limit_snapshots(task_id,operation,headers_json,created_at) VALUES(?,?,?,?)")
      .run(taskId, "account/rateLimits/read", json(limits), now());
  } catch {
    // Rate-limit metadata is best-effort and must not prevent a coding turn.
  }
}

export async function sendMessage(taskId, user, text, attachmentIds = []) {
  let task = getTask(taskId);
  if (!task) throw Object.assign(new Error("Thread not found"), { status: 404 });
  const activeOther = db.prepare(`
    SELECT id FROM tasks WHERE repo_path=? AND id<>? AND status IN ('connecting','running') LIMIT 1
  `).get(task.repository.path, task.id);
  if (activeOther) throw Object.assign(new Error("Repository is busy with another thread"), { status: 409, code: "repository_locked", taskId: activeOther.id });
  if (task.status === "budget_interrupted") {
    const state = budgetState(task.model, task.budgetMicros, task.usage, {
      estimatedMicros: task.estimatedCostMicros,
    });
    if (state.exhausted) throw Object.assign(new Error("Increase the budget before continuing"), { status: 409, code: "budget_exhausted" });
    db.prepare("UPDATE tasks SET status='idle_completed', interruption_reason=NULL, last_active_at=? WHERE id=?")
      .run(now(), task.id);
    audit({ userId: user.id, taskId: task.id, action: "budget.policy_released", detail: { enforcementBasis: state.enforcementBasis } });
    task = getTask(task.id);
  }

  const attachments = attachmentIds.length
    ? db.prepare(`SELECT id,relative_path,absolute_path FROM uploads WHERE task_id=? AND id IN (${attachmentIds.map(() => "?").join(",")})`).all(task.id, ...attachmentIds)
    : [];
  const messageId = crypto.randomUUID();
  db.prepare("INSERT INTO messages(id,task_id,role,text,raw_json,created_at) VALUES(?,?,?,?,?,?)")
    .run(messageId, task.id, "user", text, json({ attachmentIds }), now());
  audit({ userId: user.id, taskId: task.id, action: "thread.message", detail: { messageId, attachmentIds } });

  task = await ensureCodexThread(task);
  const input = turnInput(text, attachments);
  if (task.status === "running" && task.activeTurnId) {
    await codexAppServer.steerTurn(task.codexThreadId, task.activeTurnId, input);
    emitLocal(task.id, "budgetsight.turn.steered", { messageId, turnId: task.activeTurnId });
  } else {
    saveRepoSnapshot(task, "before_turn");
    db.prepare("UPDATE tasks SET status='connecting', finished_at=NULL, last_active_at=? WHERE id=?").run(now(), task.id);
    const result = await codexAppServer.startTurn(task.codexThreadId, input, {
      cwd: task.repository.path,
      model: task.model,
      effort: "medium",
    });
    const turnId = result.turn?.id;
    db.prepare("UPDATE tasks SET status='running', active_turn_id=?, started_at=COALESCE(started_at,?), last_active_at=? WHERE id=?")
      .run(turnId || null, now(), now(), task.id);
    emitLocal(task.id, "budgetsight.turn.started", { messageId, turnId });
  }
  snapshotRateLimits(task.id);
  return { messageId, task: getTask(task.id) };
}

export async function cancelTask(taskId, user, reason = "user_requested") {
  const task = getTask(taskId);
  if (!task?.codexThreadId || !task.activeTurnId) throw Object.assign(new Error("Thread has no active turn"), { status: 409 });
  const changed = db.prepare(`
    UPDATE tasks SET status='user_interrupted', interruption_reason=?, last_turn_outcome='cancel_requested',
      finished_at=?, last_active_at=? WHERE id=? AND status IN ('connecting','running')
  `).run(reason, now(), now(), task.id);
  if (!changed.changes) throw Object.assign(new Error("Thread is not active"), { status: 409 });
  audit({ userId: user.id, taskId, action: "thread.cancel", detail: { reason } });
  await codexAppServer.interruptTurn(task.codexThreadId, task.activeTurnId);
  return getTask(task.id);
}

export function increaseBudget(taskId, user, newBudgetMicros, reason = null) {
  const task = getTask(taskId);
  if (!task) throw Object.assign(new Error("Thread not found"), { status: 404 });
  if (newBudgetMicros <= task.budgetMicros) throw Object.assign(new Error("Budget can only increase"), { status: 400, code: "budget_increase_required" });
  const envelope = tokenEnvelope(task.model, newBudgetMicros);
  const nextStatus = task.status === "budget_interrupted" ? "idle_completed" : task.status;
  db.prepare("UPDATE tasks SET budget_micros=?, token_envelope=?, status=?, interruption_reason=NULL, last_active_at=? WHERE id=?")
    .run(newBudgetMicros, envelope, nextStatus, now(), task.id);
  db.prepare(`
    INSERT INTO budget_actions(task_id,actor_user_id,action,old_budget_micros,new_budget_micros,reason,created_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(task.id, user.id, "increase", task.budgetMicros, newBudgetMicros, reason, now());
  audit({ userId: user.id, taskId, action: "budget.increase", detail: { from: task.budgetMicros, to: newBudgetMicros, reason } });
  emitLocal(task.id, "budgetsight.budget.increased", { oldBudgetMicros: task.budgetMicros, newBudgetMicros });
  return getTask(task.id);
}

export async function exportCodexThread(task) {
  if (!task.codexThreadId) return { thread: null, rateLimits: null, account: null, errors: [] };
  const errors = [];
  let thread = null;
  let rateLimits = null;
  let account = null;
  await Promise.all([
    codexAppServer.readThread(task.codexThreadId, true).then((value) => { thread = value.thread; }).catch((error) => errors.push({ resource: "thread", message: error.message })),
    codexAppServer.readRateLimits().then((value) => { rateLimits = value; }).catch((error) => errors.push({ resource: "rateLimits", message: error.message })),
    codexAppServer.readAccount().then((value) => { account = value; }).catch((error) => errors.push({ resource: "account", message: error.message })),
  ]);
  return { thread, rateLimits, account, errors };
}

export function appServerStatus() {
  return codexAppServer.status();
}

export function repriceStoredUsage() {
  const tasks = db.prepare(`
    SELECT * FROM tasks
    WHERE pricing_version<>?
      OR (latest_usage_json IS NOT NULL AND estimated_token_cost_micros IS NULL)
      OR latest_tool_usage_json IS NULL
  `).all(PRICING_VERSION).map(hydrateTask);
  for (const task of tasks) {
    const events = db.prepare(`
      SELECT seq,event_type,raw_json FROM agent_events WHERE task_id=? ORDER BY seq
    `).all(task.id);
    const snapshots = db.prepare("SELECT id FROM usage_snapshots WHERE task_id=? ORDER BY id").all(task.id);
    let usage = null;
    let tokenMicros = null;
    const toolUsage = { webSearchCalls: 0, fileSearchCalls: 0 };
    const seenTools = new Set();
    let snapshotIndex = 0;

    for (const event of events) {
      const payload = parseJson(event.raw_json, {});
      const kind = event.event_type === "item/completed" ? billableToolKind(payload.item) : null;
      if (kind) {
        const key = payload.item?.id || `${kind}:${event.seq}`;
        if (!seenTools.has(key)) {
          seenTools.add(key);
          toolUsage[`${kind}Calls`] += 1;
        }
      }

      const tokenUsage = event.event_type === "thread/tokenUsage/updated" ? payload.tokenUsage : null;
      if (tokenUsage?.total) {
        const measured = nextUsageEstimate(task.model, usage, tokenMicros, tokenUsage);
        usage = measured.usage;
        tokenMicros = measured.estimatedMicros;
        const totalMicros = (tokenMicros || 0) + estimateToolUsageMicros(toolUsage);
        const state = budgetState(task.model, task.budgetMicros, usage, { estimatedMicros: totalMicros });
        const snapshot = snapshots[snapshotIndex++];
        if (snapshot) {
          db.prepare(`
            UPDATE usage_snapshots
            SET usage_json=?, estimated_cost_micros=?, token_envelope=?, exhausted=?
            WHERE id=?
          `).run(json(usage), totalMicros, state.tokenEnvelope, state.exhausted ? 1 : 0, snapshot.id);
        }
      }
    }

    if (!usage) {
      usage = normalizeUsage(task.usage);
      tokenMicros = usage ? estimateUsageMicros(task.model, usage) : null;
    }
    const normalizedToolUsage = normalizeToolUsage(toolUsage);
    const toolMicros = estimateToolUsageMicros(normalizedToolUsage);
    const totalMicros = (tokenMicros || 0) + toolMicros;
    const estimatedMicros = tokenMicros == null && toolMicros === 0 ? null : totalMicros;
    const state = budgetState(task.model, task.budgetMicros, usage, { estimatedMicros });
    db.prepare(`
      UPDATE tasks SET pricing_version=?, latest_usage_json=?, latest_tool_usage_json=?,
        estimated_token_cost_micros=?, estimated_tool_cost_micros=?, estimated_cost_micros=?,
        overrun_micros=?, token_envelope=? WHERE id=?
    `).run(
      PRICING_VERSION,
      json(usage),
      json(normalizedToolUsage),
      tokenMicros,
      toolMicros,
      estimatedMicros,
      state.overrunMicros,
      state.tokenEnvelope,
      task.id,
    );
  }
}

export function reconcileRuntimes() {
  repriceStoredUsage();
  const active = db.prepare("SELECT * FROM tasks WHERE status IN ('connecting','running')").all().map(hydrateTask);
  for (const task of active) {
    db.prepare(`
      UPDATE tasks SET status='user_interrupted', interruption_reason='server_restarted',
        last_turn_outcome='unknown', active_turn_id=NULL, finished_at=?, last_active_at=? WHERE id=?
    `).run(now(), now(), task.id);
  }
  const legacyBudgetStops = db.prepare("SELECT * FROM tasks WHERE status='budget_interrupted'").all().map(hydrateTask);
  for (const task of legacyBudgetStops) {
    const state = budgetState(task.model, task.budgetMicros, task.usage, {
      estimatedMicros: task.estimatedCostMicros,
    });
    if (state.exhausted) continue;
    db.prepare("UPDATE tasks SET status='idle_completed', interruption_reason=NULL, last_active_at=? WHERE id=?")
      .run(now(), task.id);
    audit({ userId: task.userId, taskId: task.id, action: "budget.policy_released", detail: { enforcementBasis: state.enforcementBasis } });
  }
}

export { PRICING_VERSION };
