import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, "budgetsight.db"));
db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");

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
`);

for (const statement of [
  "ALTER TABLE tasks ADD COLUMN runtime_provider TEXT NOT NULL DEFAULT 'codex_app_server'",
  "ALTER TABLE tasks ADD COLUMN active_turn_id TEXT",
  "ALTER TABLE tasks ADD COLUMN estimated_token_cost_micros INTEGER",
  "ALTER TABLE tasks ADD COLUMN estimated_tool_cost_micros INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tasks ADD COLUMN latest_tool_usage_json TEXT",
]) {
  try {
    db.exec(statement);
  } catch (error) {
    if (!String(error.message).includes("duplicate column name")) throw error;
  }
}

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
