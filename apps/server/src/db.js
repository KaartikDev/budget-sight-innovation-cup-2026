import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, "budgetsight.db"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','admin')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  repo_id TEXT,
  repo_name TEXT,
  repo_path TEXT,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  budget_micros INTEGER NOT NULL,
  pricing_version TEXT NOT NULL,
  token_envelope INTEGER NOT NULL,
  estimated_cost_micros INTEGER,
  estimated_token_cost_micros INTEGER,
  estimated_tool_cost_micros INTEGER NOT NULL DEFAULT 0,
  overrun_micros INTEGER NOT NULL DEFAULT 0,
  latest_usage_json TEXT,
  latest_tool_usage_json TEXT,
  openai_session_id TEXT,
  environment_id TEXT,
  remote_url TEXT,
  interruption_reason TEXT,
  last_turn_outcome TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  last_active_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id, last_active_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_repo_status ON tasks(repo_path, status);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  turn_id TEXT,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  raw_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  absolute_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  mime_type TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, relative_path)
);
CREATE TABLE IF NOT EXISTS agent_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  upstream_id TEXT,
  event_type TEXT NOT NULL,
  turn_id TEXT,
  event_key TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_task_seq ON agent_events(task_id, seq);
CREATE TABLE IF NOT EXISTS usage_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  usage_json TEXT,
  estimated_cost_micros INTEGER,
  token_envelope INTEGER NOT NULL,
  exhausted INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS budget_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  old_budget_micros INTEGER,
  new_budget_micros INTEGER,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS repo_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  phase TEXT NOT NULL,
  turn_id TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limit_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  headers_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS executor_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id),
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_turns (
  turn_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  start_event_seq INTEGER,
  end_event_seq INTEGER,
  error_reason TEXT,
  before_repo_snapshot_id INTEGER REFERENCES repo_snapshots(id) ON DELETE SET NULL,
  after_repo_snapshot_id INTEGER REFERENCES repo_snapshots(id) ON DELETE SET NULL,
  usage_start_json TEXT,
  usage_end_json TEXT,
  environment_json TEXT,
  extraction_state TEXT NOT NULL DEFAULT 'not_queued',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_turns_task_started ON task_turns(task_id, started_at);
CREATE INDEX IF NOT EXISTS idx_task_turns_status ON task_turns(status, completed_at);
CREATE TABLE IF NOT EXISTS feature_extraction_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL REFERENCES task_turns(turn_id) ON DELETE CASCADE,
  extractor_version TEXT NOT NULL,
  source_hash TEXT,
  idempotency_key TEXT,
  state TEXT NOT NULL CHECK(state IN ('queued','running','waiting_for_ollama','succeeded','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  locked_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(turn_id, extractor_version)
);
CREATE INDEX IF NOT EXISTS idx_feature_jobs_ready ON feature_extraction_jobs(state, available_at);
CREATE TABLE IF NOT EXISTS feature_extraction_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES feature_extraction_jobs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  turn_id TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  source_hash TEXT,
  model TEXT,
  status TEXT NOT NULL,
  input_truncated INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  output_tokens INTEGER,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feature_runs_turn ON feature_extraction_runs(turn_id, id DESC);
`);

for (const statement of [
  "ALTER TABLE tasks ADD COLUMN runtime_provider TEXT NOT NULL DEFAULT 'codex_app_server'",
  "ALTER TABLE tasks ADD COLUMN active_turn_id TEXT",
  "ALTER TABLE tasks ADD COLUMN estimated_token_cost_micros INTEGER",
  "ALTER TABLE tasks ADD COLUMN estimated_tool_cost_micros INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tasks ADD COLUMN latest_tool_usage_json TEXT",
  "ALTER TABLE messages ADD COLUMN turn_id TEXT",
  "ALTER TABLE agent_events ADD COLUMN event_key TEXT",
  "ALTER TABLE task_turns ADD COLUMN extraction_state TEXT NOT NULL DEFAULT 'not_queued'",
  "ALTER TABLE task_turns ADD COLUMN environment_json TEXT",
  "ALTER TABLE feature_extraction_jobs ADD COLUMN idempotency_key TEXT",
]) {
  try {
    db.exec(statement);
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) throw error;
  }
}

db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_feature_jobs_idempotency ON feature_extraction_jobs(idempotency_key) WHERE idempotency_key IS NOT NULL");
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_task_key ON agent_events(task_id,event_key) WHERE event_key IS NOT NULL");

export function now() {
  return new Date().toISOString();
}

export function parseJson(value, fallback = null) {
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function json(value) {
  return value == null ? null : JSON.stringify(value);
}

export function audit({ userId = null, taskId = null, action, detail = null }) {
  db.prepare(
    "INSERT INTO audit_logs(user_id, task_id, action, detail_json, created_at) VALUES(?,?,?,?,?)",
  ).run(userId, taskId, action, json(detail), now());
}

export function withTransaction(operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

export function publicUser(row) {
  if (!row) return null;
  return { id: row.id, name: row.display_name, username: row.username, role: row.role };
}

export function hydrateTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    repository: row.repo_id
      ? { id: row.repo_id, name: row.repo_name, path: row.repo_path }
      : null,
    model: row.model,
    status: row.status,
    budgetMicros: Number(row.budget_micros),
    pricingVersion: row.pricing_version,
    tokenEnvelope: Number(row.token_envelope),
    estimatedCostMicros: row.estimated_cost_micros == null ? null : Number(row.estimated_cost_micros),
    estimatedTokenCostMicros: row.estimated_token_cost_micros == null ? null : Number(row.estimated_token_cost_micros),
    estimatedToolCostMicros: Number(row.estimated_tool_cost_micros || 0),
    overrunMicros: Number(row.overrun_micros || 0),
    usage: parseJson(row.latest_usage_json),
    toolUsage: parseJson(row.latest_tool_usage_json, { webSearchCalls: 0, fileSearchCalls: 0 }),
    openaiSessionId: row.openai_session_id,
    codexThreadId: row.openai_session_id,
    runtimeProvider: row.runtime_provider || "codex_app_server",
    activeTurnId: row.active_turn_id,
    environmentId: row.environment_id,
    remoteUrl: row.remote_url,
    interruptionReason: row.interruption_reason,
    lastTurnOutcome: row.last_turn_outcome,
    createdAt: row.created_at,
    startedAt: row.started_at,
    lastActiveAt: row.last_active_at,
    finishedAt: row.finished_at,
  };
}
