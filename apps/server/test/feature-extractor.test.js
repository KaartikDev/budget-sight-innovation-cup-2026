import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import request from "supertest";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "budgetsight-features-"));
const repositoryPath = path.join(tempRoot, "repo");
fs.mkdirSync(repositoryPath);
execFileSync("git", ["init", "--initial-branch=main", repositoryPath]);
process.env.DATA_DIR = path.join(tempRoot, "data");
process.env.REPORTING_DB_PATH = path.join(tempRoot, "reporting.db");
process.env.FEATURE_EXTRACTION_LOG_PATH = path.join(tempRoot, "feature-extraction.log");
process.env.REPO_ROOTS = tempRoot;
process.env.FEATURE_EXTRACTION_ENABLED = "true";

const { db, json } = await import("../src/db.js");
const { reportingDb, appendReportingRow, getCurrentReportingRow, getReportingRowVersions, listReportingRows } = await import("../src/reporting-db.js");
const { buildTurnFeatureRow, mergeSemanticExtension } = await import("../src/feature-builder.js");
const { TurnFeatureRowSchema, WorkloadLabelSchema } = await import("../src/feature-contract.js");
const { extractSemanticFeatures } = await import("../src/ollama-feature-extractor.js");
const { enqueueTurnExtraction, processNextFeatureJob, retryTurnExtraction } = await import("../src/feature-worker.js");
const { storeAgentEvent } = await import("../src/event-store.js");
const { app } = await import("../src/app.js");

test("workload schema accepts safe custom identifiers", () => {
  assert.equal(WorkloadLabelSchema.parse("security_review"), "security_review");
  assert.throws(() => WorkloadLabelSchema.parse("Security review"));
  assert.throws(() => WorkloadLabelSchema.parse("../unsafe"));
});

const userId = crypto.randomUUID();
const taskId = crypto.randomUUID();
const turnId = "turn-feature-fixture";
const startedAt = "2026-09-26T20:00:00.000Z";
const completedAt = "2026-09-26T20:00:03.000Z";

db.prepare("INSERT INTO users(id,display_name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)")
  .run(userId, "Feature Tester", "features", await bcrypt.hash("password", 4), "admin", startedAt);
db.prepare(`
  INSERT INTO tasks(
    id,user_id,title,repo_id,repo_name,repo_path,model,status,budget_micros,pricing_version,
    token_envelope,latest_tool_usage_json,openai_session_id,runtime_provider,created_at,last_active_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`).run(
  taskId, userId, "Fix the fixture", "repo-fixture", "repo", repositoryPath, "gpt-6-sol",
  "idle_completed", 1_000_000, "test-pricing", 100_000, json({ webSearchCalls: 0, fileSearchCalls: 0 }),
  "thread-fixture", "codex_app_server", startedAt, completedAt,
);

const beforeSnapshot = db.prepare("INSERT INTO repo_snapshots(task_id,phase,turn_id,raw_json,created_at) VALUES(?,?,?,?,?)")
  .run(taskId, "before_turn", turnId, json({ branch: "main", commit: "abc", dirty: false, remote: null }), startedAt);
const afterSnapshot = db.prepare("INSERT INTO repo_snapshots(task_id,phase,turn_id,raw_json,created_at) VALUES(?,?,?,?,?)")
  .run(taskId, "after_turn", turnId, json({ branch: "main", commit: "abc", dirty: true, remote: null }), completedAt);
db.prepare(`
  INSERT INTO task_turns(
    turn_id,task_id,status,started_at,completed_at,duration_ms,before_repo_snapshot_id,
    after_repo_snapshot_id,usage_start_json,usage_end_json,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
`).run(
  turnId, taskId, "completed", startedAt, completedAt, 3_000,
  Number(beforeSnapshot.lastInsertRowid), Number(afterSnapshot.lastInsertRowid),
  json({ inputTokens: 100, cachedInputTokens: 20, cacheWriteInputTokens: 0, outputTokens: 20, reasoningTokens: 5, totalTokens: 120 }),
  json({ inputTokens: 300, cachedInputTokens: 40, cacheWriteInputTokens: 10, outputTokens: 80, reasoningTokens: 20, totalTokens: 380 }),
  startedAt, completedAt,
);

const uploadId = crypto.randomUUID();
db.prepare(`
  INSERT INTO uploads(id,task_id,relative_path,absolute_path,size_bytes,sha256,mime_type,created_at)
  VALUES(?,?,?,?,?,?,?,?)
`).run(uploadId, taskId, "notes.txt", path.join(repositoryPath, "notes.txt"), 12, "attachment-hash", "text/plain", startedAt);
db.prepare("INSERT INTO messages(id,task_id,turn_id,role,text,raw_json,created_at) VALUES(?,?,?,?,?,?,?)")
  .run(crypto.randomUUID(), taskId, turnId, "user", "Fix the importer PRIVATE_PROMPT", json({ attachmentIds: [uploadId] }), startedAt);

function addEvent(eventType, payload, offsetMs) {
  db.prepare("INSERT INTO agent_events(task_id,upstream_id,event_type,turn_id,raw_json,created_at) VALUES(?,?,?,?,?,?)")
    .run(taskId, payload.item?.id || null, eventType, turnId, json({ type: eventType, method: eventType, turnId, ...payload }), new Date(Date.parse(startedAt) + offsetMs).toISOString());
}

addEvent("item/completed", { item: { type: "userMessage", id: "user-upstream", text: "Fix the importer PRIVATE_PROMPT" } }, 10);
addEvent("item/completed", {
  item: {
    type: "commandExecution",
    id: "command-failed",
    command: "API_KEY=supersecret python import_data.py",
    status: "failed",
    exitCode: 1,
    commandActions: [{ type: "execute", command: "python import_data.py" }],
    aggregatedOutput: "ModuleNotFoundError: No module named 'pptx'\nsupersecret-output",
  },
}, 500);
addEvent("item/completed", {
  item: {
    type: "fileChange",
    id: "file-change",
    status: "completed",
    changes: [{ path: path.join(repositoryPath, "result.js"), kind: { type: "add" }, diff: "export const fixed = true;\n" }],
  },
}, 1_000);
addEvent("item/completed", {
  item: {
    type: "commandExecution",
    id: "command-test",
    command: "npm test",
    status: "completed",
    exitCode: 0,
    commandActions: [{ type: "execute", command: "npm test" }],
    aggregatedOutput: "1 test passed",
  },
}, 2_000);
addEvent("item/autoApprovalReview/completed", { itemId: "command-test" }, 2_100);
addEvent("item/completed", { item: { type: "agentMessage", id: "assistant-upstream", text: "Finished PRIVATE_RESPONSE" } }, 2_500);

after(() => {
  reportingDb.close();
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("builds a complete deterministic draft without storing raw session text", () => {
  const built = buildTurnFeatureRow(turnId);
  assert.doesNotThrow(() => TurnFeatureRowSchema.parse(built.row));
  assert.equal(built.row.identity.turnId, turnId);
  assert.equal(built.row.environment.workspaceRoot, repositoryPath);
  assert.equal(built.row.semantic.workload.primary, "unknown");
  assert.equal(built.row.metrics.toolCount, 3);
  assert.equal(built.row.metrics.failedCommandCount, 1);
  assert.equal(built.row.metrics.approvalCount, 1);
  assert.equal(built.row.metrics.changedFileCount, 1);
  assert.equal(built.row.metrics.linesAdded, 1);
  assert.equal(built.row.metrics.validationAfterLastModification, true);
  assert.deepEqual(built.row.metrics.validationActionsAfterLastModification, ["tool_3"]);
  assert.equal(built.row.conversation.attachments[0].sha256, "attachment-hash");
  assert.equal(built.row.deterministicFailures[0].fingerprint, "python_module_missing:pptx");
  assert.equal(built.row.usage.totalTokens, 260);
  const serialized = JSON.stringify(built.row);
  for (const forbidden of ["PRIVATE_PROMPT", "PRIVATE_RESPONSE", "supersecret", "npm test", "1 test passed"]) {
    assert.equal(serialized.includes(forbidden), false, `reporting row leaked ${forbidden}`);
  }
  assert.equal(JSON.stringify(built.semanticInput).includes("PRIVATE_PROMPT"), true);
});

test("semantic merge preserves deterministic facts and evidence integrity", () => {
  const { row: draft } = buildTurnFeatureRow(turnId);
  const finalRow = mergeSemanticExtension(draft, {
    workload: { primary: "debugging", secondary: ["testing"], confidence: "high", evidence: ["message_1", "made_up"] },
    actions: [
      { source: "tool_1", label: "repo_exploration", confidence: "medium" },
      { source: "tool_2", label: "web_searching", confidence: "high" },
    ],
    failures: [{ source: "failure_1", state: "recovered", confidence: "high", evidence: ["tool_3", "made_up"] }],
    outcome: { status: "completed", validation: "passed", unmetGoal: null, confidence: "high", evidence: ["tool_3"] },
  }, { attempt: 1, repairAttempts: 0, callCount: 2 });
  assert.equal(finalRow.semantic.actions.find((action) => action.source === "tool_1").label, "repo_exploration");
  assert.equal(finalRow.semantic.actions.find((action) => action.source === "tool_2").label, "code_editing");
  assert.deepEqual(finalRow.semantic.workload.evidence, ["message_1"]);
  assert.deepEqual(finalRow.semantic.failures[0].evidence, ["failure_1", "tool_3"]);
  assert.equal(finalRow.semantic.observations.mostRepeatedToolIntent, "repo_exploration");
  assert.equal(finalRow.semantic.observations.toolCallCount, 1);
  assert.equal(finalRow.semantic.observations.isRepeated, false);
});

test("Ollama annotator chunks ambiguous actions and repairs invalid structured output once", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let returnedInvalid = false;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const actionCall = body.messages[0].content.includes("ambiguous tool items");
    if (actionCall && !returnedInvalid) {
      returnedInvalid = true;
      return new Response(JSON.stringify({ message: { content: "not-json" }, prompt_eval_count: 3, eval_count: 1, model: "qwen3:4b-instruct" }), { status: 200 });
    }
    let content;
    if (actionCall) {
      const match = body.messages[1].content.match(/\{[\s\S]*\}$/);
      const tools = JSON.parse(match[0]).tools;
      content = { actions: tools.map((tool) => ({ source: tool.evidence, label: "command_execution", confidence: "medium" })) };
    } else {
      content = {
        workload: { primary: "code_generation", secondary: [], confidence: "high", evidence: ["message_1"] },
        failures: [],
        outcome: { status: "completed", validation: "none", unmetGoal: null, confidence: "medium", evidence: [] },
      };
    }
    return new Response(JSON.stringify({ message: { content: JSON.stringify(content) }, prompt_eval_count: 5, eval_count: 2, model: "qwen3:4b-instruct" }), { status: 200 });
  };
  try {
    const tools = Array.from({ length: 41 }, (_value, index) => ({
      evidence: `tool_${index + 1}`,
      itemType: "mcpToolCall",
      toolName: "ambiguous",
      deterministicIntent: { label: "other", confidence: "low", source: "deterministic" },
      needsSemanticAction: true,
    }));
    const result = await extractSemanticFeatures({ turn: {}, messages: [], tools, failures: [], files: [] });
    assert.equal(result.semantic.actions.length, 41);
    assert.equal(result.metadata.callCount, 4);
    assert.equal(result.metadata.repairAttempts, 1);
    assert.equal(requests.length, 5);
    assert.ok(requests.every((body) => body.model === "qwen3:4b-instruct" && body.stream === false && body.think === false));
    assert.ok(requests.every((body) => body.options.num_ctx === 8_192 && body.options.num_predict === 768));
    assert.ok(requests.every((body) => body.format.$schema === undefined));
    assert.ok(requests.every((body) => !JSON.stringify(body.format).includes('"pattern"')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("worker persists a complete draft and defers semantics when Ollama is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError("connection refused"); };
  try {
    enqueueTurnExtraction(taskId, turnId, { delayMs: 0 });
    const result = await processNextFeatureJob();
    assert.equal(result, null);
    const current = getCurrentReportingRow(turnId);
    assert.equal(current.stage, "draft");
    assert.equal(current.semanticStatus, "pending");
    assert.doesNotThrow(() => TurnFeatureRowSchema.parse(current.row));
    const job = db.prepare("SELECT state,attempt_count FROM feature_extraction_jobs WHERE turn_id=?").get(turnId);
    assert.equal(job.state, "waiting_for_ollama");
    assert.equal(job.attempt_count, 1);
    assert.equal(db.prepare("SELECT extraction_state FROM task_turns WHERE turn_id=?").get(turnId).extraction_state, "waiting_for_ollama");
    const log = fs.readFileSync(process.env.FEATURE_EXTRACTION_LOG_PATH, "utf8");
    assert.match(log, /"event":"failed"/);
    assert.match(log, /"errorCode":"ollama_unavailable"/);
    assert.equal(log.includes("PRIVATE_PROMPT"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reporting rows are immutable, current, filterable versions", () => {
  const { row: draft } = buildTurnFeatureRow(turnId);
  appendReportingRow(draft, { stage: "draft", semanticStatus: "pending" });
  appendReportingRow(draft, { stage: "draft", semanticStatus: "pending" });
  assert.equal(getReportingRowVersions(turnId).length, 1);

  const finalRow = mergeSemanticExtension(draft, {
    workload: { primary: "debugging", secondary: ["testing"], confidence: "high", evidence: ["message_1"] },
    actions: [],
    failures: [{ source: "failure_1", state: "recovered", confidence: "high", evidence: ["failure_1", "tool_3"] }],
    outcome: { status: "completed", validation: "passed", unmetGoal: null, confidence: "high", evidence: ["tool_3"] },
  });
  appendReportingRow(finalRow, { stage: "final", semanticStatus: "ready" });
  assert.equal(getCurrentReportingRow(turnId).stage, "final");
  appendReportingRow(draft, { stage: "draft", semanticStatus: "pending" });
  assert.equal(getCurrentReportingRow(turnId).stage, "final");
  const versions = getReportingRowVersions(turnId);
  assert.equal(versions.length, 2);
  assert.equal(versions.find((version) => version.stage === "draft").semanticStatus, "pending");
  const listing = listReportingRows({ workload: "debugging", outcome: "completed", limit: 10 });
  assert.equal(listing.rows.length, 1);
  assert.equal(listing.rows[0].row.identity.turnId, turnId);
  assert.equal(listReportingRows({ model: "gpt-6-sol" }).rows.length, 1);
  assert.equal(listReportingRows({ model: "gpt-6-luna" }).rows.length, 0);
  assert.equal(listReportingRows({ from: "2026-09-27T00:00:00.000Z" }).rows.length, 0);
  assert.equal(listReportingRows({ q: "Feature Tester" }).rows.length, 1);
  assert.equal(listReportingRows({ q: "does-not-exist" }).rows.length, 0);
  const storedJson = reportingDb.prepare("SELECT row_json FROM turn_feature_rows").all().map((row) => row.row_json).join("\n");
  assert.equal(storedJson.includes("PRIVATE_PROMPT"), false);
  assert.equal(storedJson.includes("supersecret-output"), false);
});

test("manual retry durably requeues an unsuccessful extraction", () => {
  const retried = retryTurnExtraction(turnId);
  assert.equal(retried.state, "queued");
  assert.equal(retried.attempt_count, 0);
});

test("admin reporting endpoints expose current and historical complete rows", async () => {
  await request(app).get("/api/v1/admin/reporting/turns").expect(401);
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username: "features", password: "password" }).expect(200);
  const listing = await agent.get("/api/v1/admin/reporting/turns").query({ workload: "debugging", limit: 10 }).expect(200);
  assert.equal(listing.body.rows[0].row.identity.turnId, turnId);
  const scoped = await agent.get("/api/v1/admin/reporting/turns").query({ model: "gpt-6-sol", from: "2026-09-26T00:00:00.000Z", to: "2026-09-27T00:00:00.000Z" }).expect(200);
  assert.equal(scoped.body.rows.length, 1);
  const searched = await agent.get("/api/v1/admin/reporting/turns").query({ q: "repo" }).expect(200);
  assert.equal(searched.body.rows.length, 1);
  const current = await agent.get(`/api/v1/admin/reporting/turns/${turnId}`).expect(200);
  assert.equal(current.body.stage, "final");
  const historical = await agent.get(`/api/v1/admin/reporting/turns/${turnId}`).query({ versions: "true" }).expect(200);
  assert.equal(historical.body.versions.length, 2);
});

test("raw lifecycle events are persisted once by stable upstream item key", () => {
  const message = {
    method: "item/completed",
    params: { turnId, item: { type: "reasoning", id: "deduplicated-item", summary: [] } },
  };
  const first = storeAgentEvent(taskId, message);
  const second = storeAgentEvent(taskId, message);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(first.seq, second.seq);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM agent_events WHERE event_key=?").get("item/completed:deduplicated-item").count, 1);
});

test("telemetry noise does not change the deterministic source hash", () => {
  const before = buildTurnFeatureRow(turnId).sourceHash;
  addEvent("item/agentMessage/delta", { itemId: "assistant-upstream", delta: "streaming-noise" }, 2_700);
  const afterNoise = buildTurnFeatureRow(turnId).sourceHash;
  assert.equal(afterNoise, before);
});
