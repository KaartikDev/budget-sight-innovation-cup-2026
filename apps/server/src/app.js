import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import express from "express";
import cookieParser from "cookie-parser";
import multer from "multer";
import { z } from "zod";
import {
  MODELS,
  PRICING,
  TOOL_PRICING,
  budgetUsdToMicros,
  budgetState,
  microsToUsd,
  normalizeUsage,
  tokenEnvelope,
} from "@budgetsight/shared";
import { config, configurationStatus } from "./config.js";
import { authenticate, canAccessTask, canManageTask, login, logout, requireAdmin, requireUser } from "./auth.js";
import { audit, db, hydrateTask, json, now, parseJson, publicUser } from "./db.js";
import { subscribe } from "./events.js";
import { createRepository, getRepository, listRepositories, listRepositoryRoots } from "./repositories.js";
import {
  PRICING_VERSION,
  appServerStatus,
  cancelTask,
  exportCodexThread,
  getTask,
  increaseBudget,
  sendMessage,
  taskPaths,
} from "./runtime.js";
import { featureWorkerStatus, retryTurnExtraction } from "./feature-worker.js";
import { OUTCOME_STATUSES, WORKLOAD_LABELS } from "./feature-contract.js";
import { getCurrentReportingRow, getReportingRowVersions, listReportingRows } from "./reporting-db.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(authenticate);

const upload = multer({
  storage: multer.diskStorage({
    destination(req, _file, callback) {
      const task = getTask(req.params.taskId);
      const temp = task ? path.join(taskPaths(task).root, "upload-tmp") : config.dataDir;
      fs.mkdirSync(temp, { recursive: true });
      callback(null, temp);
    },
    filename(_req, _file, callback) {
      callback(null, crypto.randomUUID());
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 50 },
});

function rawTask(id) {
  return db.prepare("SELECT * FROM tasks WHERE id=?").get(id);
}

function requireTaskAccess(req, res, next) {
  const row = rawTask(req.params.taskId);
  if (!row) return res.status(404).json({ error: "task_not_found" });
  if (!canAccessTask(req.user, row)) return res.status(403).json({ error: "forbidden" });
  req.taskRow = row;
  req.task = hydrateTask(row);
  next();
}

function requireTaskManagement(req, res, next) {
  if (!canManageTask(req.user, req.taskRow)) return res.status(403).json({ error: "task_owner_required" });
  next();
}

function taskView(row) {
  const task = hydrateTask(row);
  const user = publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(row.user_id));
  const state = budgetState(task.model, task.budgetMicros, task.usage, {
    estimatedMicros: task.estimatedCostMicros,
  });
  const latestRepoSnapshot = parseJson(
    db.prepare("SELECT raw_json FROM repo_snapshots WHERE task_id=? ORDER BY id DESC LIMIT 1").get(task.id)?.raw_json,
  );
  return {
    ...task,
    user,
    budget: {
      requestedUsd: microsToUsd(task.budgetMicros),
      estimatedUsd: task.estimatedCostMicros == null ? null : microsToUsd(task.estimatedCostMicros),
      estimatedTokenUsd: task.estimatedTokenCostMicros == null ? null : microsToUsd(task.estimatedTokenCostMicros),
      estimatedToolUsd: microsToUsd(task.estimatedToolCostMicros),
      toolUsage: task.toolUsage,
      overrunUsd: microsToUsd(task.overrunMicros),
      tokenEnvelope: state.tokenEnvelope,
      worstCaseTokens: state.worstCaseTokens,
      planningTokenRange: state.planningTokenRange,
      estimatedTokenCapacity: state.estimatedTokenCapacity,
      estimatedRemainingTokens: state.estimatedRemainingTokens,
      remainingTokens: state.remainingTokens,
      enforcementBasis: state.enforcementBasis,
      exhausted: state.exhausted,
      estimateOnly: true,
      pricingBasis: "standard_api_list_price",
    },
    usage: state.usage,
    repoSnapshot: latestRepoSnapshot,
  };
}

function safeRelativePath(value) {
  const normalized = path.posix.normalize(String(value || "").replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!normalized || normalized === "." || path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw Object.assign(new Error("Unsafe upload path"), { status: 400, code: "unsafe_upload_path" });
  }
  return normalized;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

app.get("/api/v1/health", (_req, res) => {
  res.json({
    ok: true,
    configuration: configurationStatus(),
    appServer: appServerStatus(),
    featureExtraction: featureWorkerStatus(),
    models: MODELS,
  });
});

app.post("/api/v1/auth/login", async (req, res, next) => {
  try {
    const input = z.object({ username: z.string().min(1), password: z.string().min(1) }).parse(req.body);
    const user = await login(input.username, input.password, res);
    if (!user) return res.status(401).json({ error: "invalid_credentials" });
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.post("/api/v1/auth/logout", (req, res) => {
  logout(req, res);
  res.status(204).end();
});

app.get("/api/v1/auth/me", requireUser, (req, res) => res.json({ user: req.user }));

app.get("/api/v1/repositories", requireUser, (_req, res) => {
  const repositories = listRepositories().map((repo) => {
    const active = db.prepare("SELECT id,user_id FROM tasks WHERE repo_path=? AND status IN ('connecting','running') LIMIT 1").get(repo.path);
    return { ...repo, busy: Boolean(active), activeTaskId: active?.id || null };
  });
  res.json({ repositories, roots: listRepositoryRoots() });
});

app.post("/api/v1/repositories", requireUser, (req, res, next) => {
  try {
    const input = z.object({
      rootId: z.string().min(1),
      name: z.string().trim().min(1).max(64),
    }).parse(req.body);
    const repository = createRepository(input.rootId, input.name);
    audit({ userId: req.user.id, action: "repository.create", detail: { repository } });
    res.status(201).json({ repository });
  } catch (error) {
    next(error);
  }
});

app.post("/api/v1/tasks", requireUser, (req, res, next) => {
  try {
    const input = z.object({
      repositoryId: z.string().min(1),
      title: z.string().trim().min(1).max(120).optional(),
      model: z.enum(MODELS).default("gpt-6-sol"),
      budgetUsd: z.coerce.number().positive().max(10_000),
    }).parse(req.body);
    const repo = getRepository(input.repositoryId);
    if (!repo) return res.status(400).json({ error: "repository_not_allowed" });
    const id = crypto.randomUUID();
    const budgetMicros = budgetUsdToMicros(input.budgetUsd);
    const createdAt = now();
    db.prepare(`
      INSERT INTO tasks(
        id,user_id,title,repo_id,repo_name,repo_path,model,status,budget_micros,pricing_version,
        token_envelope,latest_tool_usage_json,created_at,last_active_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id,
      req.user.id,
      input.title || "New coding task",
      repo.id,
      repo.name,
      repo.path,
      input.model,
      "draft",
      budgetMicros,
      PRICING_VERSION,
      tokenEnvelope(input.model, budgetMicros),
      json({ webSearchCalls: 0, fileSearchCalls: 0 }),
      createdAt,
      createdAt,
    );
    fs.mkdirSync(taskPaths(getTask(id)).inputs, { recursive: true });
    db.prepare(`
      INSERT INTO budget_actions(task_id,actor_user_id,action,new_budget_micros,reason,created_at)
      VALUES(?,?,?,?,?,?)
    `).run(id, req.user.id, "created", budgetMicros, "Initial task cap", createdAt);
    audit({ userId: req.user.id, taskId: id, action: "task.create", detail: { repoId: repo.id, model: input.model, budgetMicros } });
    res.status(201).json({ task: taskView(rawTask(id)) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/tasks", requireUser, (req, res) => {
  const rows = db.prepare("SELECT * FROM tasks ORDER BY last_active_at DESC").all();
  res.json({ tasks: rows.map(taskView) });
});

app.get("/api/v1/tasks/:taskId", requireUser, requireTaskAccess, (req, res) => {
  const messages = db.prepare("SELECT * FROM messages WHERE task_id=? ORDER BY created_at ASC").all(req.task.id).map((row) => ({
    id: row.id,
    role: row.role,
    text: row.text,
    raw: parseJson(row.raw_json),
    createdAt: row.created_at,
  }));
  const uploads = db.prepare("SELECT id,relative_path,size_bytes,sha256,mime_type,created_at FROM uploads WHERE task_id=? ORDER BY created_at").all(req.task.id);
  const events = db.prepare("SELECT seq,event_type,turn_id,raw_json,created_at FROM agent_events WHERE task_id=? ORDER BY seq").all(req.task.id).map((row) => ({
    seq: row.seq,
    event_type: row.event_type,
    turn_id: row.turn_id,
    raw_json: parseJson(row.raw_json),
    created_at: row.created_at,
    ...(parseJson(row.raw_json, {})),
  }));
  const latestRateLimits = parseJson(
    db.prepare("SELECT headers_json FROM rate_limit_snapshots WHERE task_id=? ORDER BY id DESC LIMIT 1").get(req.task.id)?.headers_json,
    {},
  );
  res.json({ task: taskView(req.taskRow), messages, uploads, events, latestRateLimits });
});

app.post(
  "/api/v1/tasks/:taskId/uploads",
  requireUser,
  requireTaskAccess,
  requireTaskManagement,
  upload.array("files", 50),
  (req, res, next) => {
    const tempFiles = req.files || [];
    try {
      const task = req.task;
      const paths = Array.isArray(req.body.relativePaths) ? req.body.relativePaths : req.body.relativePaths ? [req.body.relativePaths] : [];
      const currentBytes = Number(db.prepare("SELECT COALESCE(SUM(size_bytes),0) AS total FROM uploads WHERE task_id=?").get(task.id).total);
      const incomingBytes = tempFiles.reduce((sum, file) => sum + file.size, 0);
      if (currentBytes + incomingBytes > 500 * 1024 * 1024) throw Object.assign(new Error("Task upload limit exceeded"), { status: 413, code: "task_upload_limit" });
      const created = [];
      for (let index = 0; index < tempFiles.length; index += 1) {
        const file = tempFiles[index];
        const relative = safeRelativePath(paths[index] || file.originalname);
        const destination = path.join(taskPaths(task).inputs, relative);
        const canonicalRoot = path.resolve(taskPaths(task).inputs) + path.sep;
        if (!path.resolve(destination).startsWith(canonicalRoot)) throw Object.assign(new Error("Unsafe upload path"), { status: 400 });
        if (fs.existsSync(destination)) throw Object.assign(new Error(`Upload already exists: ${relative}`), { status: 409, code: "upload_exists" });
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.renameSync(file.path, destination);
        const id = crypto.randomUUID();
        const digest = sha256(destination);
        db.prepare(`
          INSERT INTO uploads(id,task_id,relative_path,absolute_path,size_bytes,sha256,mime_type,created_at)
          VALUES(?,?,?,?,?,?,?,?)
        `).run(id, task.id, relative, destination, file.size, digest, file.mimetype, now());
        created.push({ id, relativePath: relative, sizeBytes: file.size, sha256: digest, mimeType: file.mimetype });
      }
      audit({ userId: req.user.id, taskId: task.id, action: "task.upload", detail: { files: created.map(({ id, relativePath, sizeBytes }) => ({ id, relativePath, sizeBytes })) } });
      res.status(201).json({ uploads: created });
    } catch (error) {
      for (const file of tempFiles) if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      next(error);
    }
  },
);

app.post("/api/v1/tasks/:taskId/messages", requireUser, requireTaskAccess, requireTaskManagement, async (req, res, next) => {
  try {
    const input = z.object({ text: z.string().trim().min(1).max(200_000), attachmentIds: z.array(z.string().uuid()).default([]) }).parse(req.body);
    const result = await sendMessage(req.task.id, req.user, input.text, input.attachmentIds);
    res.status(202).json(result);
  } catch (error) {
    next(error);
  }
});

app.post("/api/v1/tasks/:taskId/cancel", requireUser, requireTaskAccess, requireTaskManagement, async (req, res, next) => {
  try {
    const reason = z.object({ reason: z.string().max(200).optional() }).parse(req.body || {}).reason;
    res.json({ task: await cancelTask(req.task.id, req.user, reason) });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/v1/tasks/:taskId/budget", requireUser, requireTaskAccess, requireTaskManagement, (req, res, next) => {
  try {
    const input = z.object({ budgetUsd: z.coerce.number().positive().max(10_000), reason: z.string().max(500).optional() }).parse(req.body);
    const task = increaseBudget(req.task.id, req.user, budgetUsdToMicros(input.budgetUsd), input.reason);
    res.json({ task: taskView(rawTask(task.id)) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/tasks/:taskId/events", requireUser, requireTaskAccess, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const after = Number(req.headers["last-event-id"] || req.query.after || 0);
  const rows = db.prepare("SELECT seq,raw_json FROM agent_events WHERE task_id=? AND seq>? ORDER BY seq ASC").all(req.task.id, after);
  for (const row of rows) res.write(`id: ${row.seq}\ndata: ${row.raw_json}\n\n`);
  const unsubscribe = subscribe(req.task.id, (event) => res.write(`event: update\ndata: ${JSON.stringify(event)}\n\n`));
  const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15_000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.get("/api/v1/tasks/:taskId/files", requireUser, requireTaskAccess, (req, res, next) => {
  try {
    const requested = z.string().min(1).max(4_096).parse(req.query.path);
    const repoRoot = fs.realpathSync(req.task.repository.path);
    const candidate = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(repoRoot, requested);
    let canonical;
    try { canonical = fs.realpathSync(candidate); }
    catch { return res.status(404).json({ error: "file_not_found" }); }
    if (canonical !== repoRoot && !canonical.startsWith(`${repoRoot}${path.sep}`)) {
      return res.status(403).json({ error: "file_outside_repository" });
    }
    if (!fs.statSync(canonical).isFile()) return res.status(400).json({ error: "not_a_file" });
    audit({ userId: req.user.id, taskId: req.task.id, action: "repository.file_download", detail: { path: path.relative(repoRoot, canonical) } });
    res.download(canonical, path.basename(canonical), (error) => {
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/tasks/:taskId/session", requireUser, requireTaskAccess, async (req, res, next) => {
  try {
    const task = taskView(req.taskRow);
    const user = task.user;
    const local = {
      messages: db.prepare("SELECT * FROM messages WHERE task_id=? ORDER BY created_at").all(task.id).map((row) => ({ ...row, raw_json: parseJson(row.raw_json) })),
      uploads: db.prepare("SELECT id,relative_path,absolute_path,size_bytes,sha256,mime_type,created_at FROM uploads WHERE task_id=? ORDER BY created_at").all(task.id),
      events: db.prepare("SELECT seq,upstream_id,event_type,turn_id,raw_json,created_at FROM agent_events WHERE task_id=? ORDER BY seq").all(task.id).map((row) => ({ ...row, raw_json: parseJson(row.raw_json) })),
      usageSnapshots: db.prepare("SELECT * FROM usage_snapshots WHERE task_id=? ORDER BY id").all(task.id).map((row) => ({ ...row, usage_json: parseJson(row.usage_json) })),
      budgetActions: db.prepare("SELECT * FROM budget_actions WHERE task_id=? ORDER BY id").all(task.id),
      repoSnapshots: db.prepare("SELECT * FROM repo_snapshots WHERE task_id=? ORDER BY id").all(task.id).map((row) => ({ ...row, raw_json: parseJson(row.raw_json) })),
      rateLimitSnapshots: db.prepare("SELECT * FROM rate_limit_snapshots WHERE task_id=? ORDER BY id").all(task.id).map((row) => ({ ...row, headers_json: parseJson(row.headers_json) })),
      executorEvents: db.prepare("SELECT * FROM executor_events WHERE task_id=? ORDER BY id").all(task.id).map((row) => ({ ...row, detail_json: parseJson(row.detail_json) })),
      auditLog: db.prepare("SELECT * FROM audit_logs WHERE task_id=? ORDER BY id").all(task.id).map((row) => ({ ...row, detail_json: parseJson(row.detail_json) })),
    };
    const codex = await exportCodexThread(task);
    const upstreamItems = codex.thread?.turns?.flatMap((turn) => turn.items || []) || [];
    const commands = upstreamItems.filter((item) => /command|shell/i.test(String(item.type || item.object || "")));
    const start = task.startedAt || task.createdAt;
    const end = task.finishedAt || now();
    const latestRateLimits = local.rateLimitSnapshots.at(-1)?.headers_json || {};
    const exportPayload = {
      schemaVersion: "budgetsight.session.v1",
      generatedAt: now(),
      report: {
        taskId: task.id,
        person: user,
        repository: { ...task.repository, snapshot: task.repoSnapshot },
        model: task.model,
        status: task.status,
        outcome: task.lastTurnOutcome,
        interruptionReason: task.interruptionReason,
        startedAt: start,
        finishedAt: task.finishedAt,
        durationMs: Math.max(0, new Date(end).getTime() - new Date(start).getTime()),
        budget: task.budget,
        pricingVersion: task.pricingVersion,
        pricing: PRICING[task.model],
        toolPricing: { unit: "usd_micros_per_completed_call", values: TOOL_PRICING },
        usage: task.usage,
        rateLimits: { scope: "organization_or_project", values: latestRateLimits },
        commands,
      },
      completeness: {
        taskStillRunning: ["connecting", "running"].includes(task.status),
        usagePending: Boolean(task.openaiSessionId && !task.usage),
        traceExportComplete: false,
        traceExportReason: "Codex app-server does not expose OTLP trace export through the thread protocol",
        upstreamErrors: codex.errors,
        eventStreamStartsAt: local.events[0]?.created_at || null,
      },
      local,
      codex,
    };
    if (req.query.download === "1") {
      res.setHeader("Content-Disposition", `attachment; filename="budgetsight-${task.id}.json"`);
      res.setHeader("Cache-Control", "private, no-store");
    }
    res.json(exportPayload);
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/admin/users", requireAdmin, (_req, res) => {
  const users = db.prepare(`
    SELECT u.*,COUNT(t.id) AS thread_count,COALESCE(SUM(t.estimated_cost_micros),0) AS estimated_spend_micros
    FROM users u LEFT JOIN tasks t ON t.user_id=u.id
    GROUP BY u.id ORDER BY u.display_name COLLATE NOCASE
  `).all().map((row) => ({
    ...publicUser(row),
    createdAt: row.created_at,
    threadCount: Number(row.thread_count),
    estimatedSpendUsd: Number(row.estimated_spend_micros) / 1_000_000,
  }));
  res.json({ users });
});

app.post("/api/v1/admin/users", requireAdmin, async (req, res, next) => {
  try {
    const input = z.object({
      name: z.string().trim().min(2).max(80),
      username: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,31}$/),
      password: z.string().min(10).max(128),
      role: z.enum(["user", "admin"]).default("user"),
    }).parse(req.body);
    if (db.prepare("SELECT 1 FROM users WHERE username=? COLLATE NOCASE").get(input.username)) {
      return res.status(409).json({ error: "username_taken", message: "That username is already in use." });
    }
    const id = crypto.randomUUID();
    const createdAt = now();
    const passwordHash = await bcrypt.hash(input.password, 12);
    db.prepare("INSERT INTO users(id,display_name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)")
      .run(id, input.name, input.username, passwordHash, input.role, createdAt);
    const user = publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id));
    audit({ userId: req.user.id, action: "user.create", detail: { createdUserId: id, username: user.username, role: user.role } });
    res.status(201).json({ user: { ...user, createdAt, threadCount: 0, estimatedSpendUsd: 0 } });
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/admin/tasks", requireAdmin, (req, res) => {
  const clauses = [];
  const values = [];
  for (const [queryKey, column] of [["userId", "user_id"], ["repositoryId", "repo_id"], ["status", "status"]]) {
    if (req.query[queryKey]) { clauses.push(`${column}=?`); values.push(req.query[queryKey]); }
  }
  if (req.query.from) { clauses.push("created_at>=?"); values.push(req.query.from); }
  if (req.query.to) { clauses.push("created_at<=?"); values.push(req.query.to); }
  const sql = `SELECT * FROM tasks ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY last_active_at DESC LIMIT 500`;
  res.json({ tasks: db.prepare(sql).all(...values).map(taskView) });
});

app.get("/api/v1/admin/reporting/turns", requireAdmin, (req, res, next) => {
  try {
    const filters = z.object({
      q: z.string().trim().max(100).optional(),
      userId: z.string().optional(),
      repositoryId: z.string().optional(),
      environmentKey: z.string().optional(),
      workload: z.enum(WORKLOAD_LABELS).optional(),
      outcome: z.enum(OUTCOME_STATUSES).optional(),
      runtimeStatus: z.string().optional(),
      semanticStatus: z.enum(["pending", "ready", "failed"]).optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      cursor: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }).parse(req.query);
    res.json(listReportingRows(filters));
  } catch (error) {
    next(error);
  }
});

app.get("/api/v1/admin/reporting/turns/:turnId", requireAdmin, (req, res) => {
  if (req.query.versions === "true") {
    const versions = getReportingRowVersions(req.params.turnId);
    if (!versions.length) return res.status(404).json({ error: "reporting_turn_not_found" });
    return res.json({ versions });
  }
  const result = getCurrentReportingRow(req.params.turnId);
  if (!result) return res.status(404).json({ error: "reporting_turn_not_found" });
  return res.json(result);
});

app.post("/api/v1/admin/reporting/turns/:turnId/retry", requireAdmin, (req, res, next) => {
  try {
    const job = retryTurnExtraction(req.params.turnId);
    if (!job) return res.status(404).json({ error: "reporting_turn_not_found" });
    audit({
      userId: req.user.id,
      taskId: job.task_id,
      action: "feature_extraction.retry",
      detail: { turnId: req.params.turnId, extractorVersion: job.extractor_version },
    });
    return res.status(202).json({
      job: {
        turnId: job.turn_id,
        extractorVersion: job.extractor_version,
        state: job.state,
        attemptCount: Number(job.attempt_count || 0),
        availableAt: job.available_at,
      },
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: "invalid_request", details: error.issues });
  if (error instanceof multer.MulterError) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.code, message: error.message });
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.code || "internal_error", message: error.message, taskId: error.taskId });
});

export { app };
