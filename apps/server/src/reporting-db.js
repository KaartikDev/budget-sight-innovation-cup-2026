import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { now } from "./db.js";
import { TurnFeatureRowSchema } from "./feature-contract.js";

fs.mkdirSync(path.dirname(config.reportingDbPath), { recursive: true });

export const reportingDb = new DatabaseSync(config.reportingDbPath);
reportingDb.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");

reportingDb.exec(`
CREATE TABLE IF NOT EXISTS turn_feature_rows (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  row_id TEXT NOT NULL UNIQUE,
  source_task_id TEXT NOT NULL,
  source_turn_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  row_schema_version TEXT NOT NULL,
  extractor_version TEXT NOT NULL,
  taxonomy_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  row_stage TEXT NOT NULL CHECK(row_stage IN ('draft','final','degraded')),
  semantic_status TEXT NOT NULL CHECK(semantic_status IN ('pending','ready','failed')),
  is_current INTEGER NOT NULL CHECK(is_current IN (0,1)),
  user_id TEXT NOT NULL,
  repository_id TEXT,
  environment_key TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  runtime_status TEXT NOT NULL,
  primary_workload TEXT NOT NULL,
  semantic_outcome TEXT NOT NULL,
  duration_ms INTEGER,
  total_tokens INTEGER,
  estimated_cost_micros INTEGER,
  tool_count INTEGER NOT NULL,
  failed_command_count INTEGER NOT NULL,
  changed_file_count INTEGER NOT NULL,
  row_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source_turn_id, source_hash, extractor_version, row_stage)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turn_feature_current
  ON turn_feature_rows(source_turn_id) WHERE is_current=1;
CREATE INDEX IF NOT EXISTS idx_turn_feature_time ON turn_feature_rows(is_current, started_at DESC, seq DESC);
CREATE INDEX IF NOT EXISTS idx_turn_feature_user ON turn_feature_rows(is_current, user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_turn_feature_repo ON turn_feature_rows(is_current, repository_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_turn_feature_environment ON turn_feature_rows(is_current, environment_key, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_turn_feature_workload ON turn_feature_rows(is_current, primary_workload, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_turn_feature_outcome ON turn_feature_rows(is_current, semantic_outcome, started_at DESC);
CREATE VIEW IF NOT EXISTS current_turn_feature_rows AS
  SELECT * FROM turn_feature_rows WHERE is_current=1;
`);

export function reconcileCurrentReportingRows() {
  const stageRank = { draft: 1, degraded: 2, final: 3 };
  const winners = new Map();
  for (const row of reportingDb.prepare(`
    SELECT row_id,source_turn_id,extractor_version,row_stage,seq FROM turn_feature_rows ORDER BY seq DESC
  `).all()) {
    const current = winners.get(row.source_turn_id);
    const candidate = [versionRank(row.extractor_version), stageRank[row.row_stage] || 0, Number(row.seq)];
    const selected = current?.rank;
    if (!selected || candidate[0] > selected[0]
      || (candidate[0] === selected[0] && candidate[1] > selected[1])
      || (candidate[0] === selected[0] && candidate[1] === selected[1] && candidate[2] > selected[2])) {
      winners.set(row.source_turn_id, { rowId: row.row_id, rank: candidate });
    }
  }
  reportingDb.exec("BEGIN IMMEDIATE");
  try {
    reportingDb.prepare("UPDATE turn_feature_rows SET is_current=0 WHERE is_current=1").run();
    const select = reportingDb.prepare("UPDATE turn_feature_rows SET is_current=1 WHERE row_id=?");
    for (const winner of winners.values()) select.run(winner.rowId);
    reportingDb.exec("COMMIT");
  } catch (error) {
    try { reportingDb.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return winners.size;
}

reconcileCurrentReportingRows();

function indexedValues(row) {
  return {
    userId: row.actor.id,
    repositoryId: row.repository.id || null,
    environmentKey: row.environment.key,
    startedAt: row.timing.startedAt || null,
    completedAt: row.timing.completedAt || null,
    runtimeStatus: row.thread.runtimeStatus,
    primaryWorkload: row.semantic.workload.primary,
    semanticOutcome: row.semantic.outcome.status,
    durationMs: row.timing.durationMs ?? null,
    totalTokens: row.usage.totalTokens ?? null,
    estimatedCostMicros: row.usage.estimatedCostMicros ?? null,
    toolCount: row.metrics.toolCount || 0,
    failedCommandCount: row.metrics.failedCommandCount || 0,
    changedFileCount: row.metrics.changedFileCount || 0,
  };
}

function versionRank(value) {
  return Number(String(value || "").match(/\.v(\d+)$/)?.[1] || 0);
}

export function appendReportingRow(row, { stage, semanticStatus }) {
  const parsed = TurnFeatureRowSchema.parse(row);
  const fields = indexedValues(parsed);
  reportingDb.exec("BEGIN IMMEDIATE");
  try {
    const current = reportingDb.prepare(`
      SELECT row_stage,source_hash,extractor_version FROM turn_feature_rows
      WHERE source_turn_id=? AND is_current=1
    `).get(parsed.identity.turnId);
    if (current && versionRank(current.extractor_version) > versionRank(parsed.identity.extractorVersion)) {
      reportingDb.exec("COMMIT");
      return getCurrentReportingRow(parsed.identity.turnId);
    }
    if (
      stage === "draft"
      && ["final", "degraded"].includes(current?.row_stage)
      && current.source_hash === parsed.identity.sourceHash
      && current.extractor_version === parsed.identity.extractorVersion
    ) {
      reportingDb.exec("COMMIT");
      return getCurrentReportingRow(parsed.identity.turnId);
    }
    reportingDb.prepare("UPDATE turn_feature_rows SET is_current=0 WHERE source_turn_id=? AND is_current=1")
      .run(parsed.identity.turnId);
    const existing = reportingDb.prepare(`
      SELECT row_id FROM turn_feature_rows
      WHERE source_turn_id=? AND source_hash=? AND extractor_version=? AND row_stage=?
    `).get(parsed.identity.turnId, parsed.identity.sourceHash, parsed.identity.extractorVersion, stage);
    if (existing) {
      // Row contents are immutable. Idempotent replays only restore the existing
      // version as current; they never rewrite its JSON or creation timestamp.
      reportingDb.prepare("UPDATE turn_feature_rows SET is_current=1 WHERE row_id=?").run(existing.row_id);
    } else {
      reportingDb.prepare(`
      INSERT INTO turn_feature_rows(
        row_id,source_task_id,source_turn_id,source_hash,row_schema_version,extractor_version,
        taxonomy_version,prompt_version,row_stage,semantic_status,is_current,user_id,repository_id,
        environment_key,started_at,completed_at,runtime_status,primary_workload,semantic_outcome,
        duration_ms,total_tokens,estimated_cost_micros,tool_count,failed_command_count,
        changed_file_count,row_json,created_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      crypto.randomUUID(),
      parsed.identity.taskId,
      parsed.identity.turnId,
      parsed.identity.sourceHash,
      parsed.identity.schemaVersion,
      parsed.identity.extractorVersion,
      parsed.identity.taxonomyVersion,
      parsed.identity.promptVersion,
      stage,
      semanticStatus,
      1,
      fields.userId,
      fields.repositoryId,
      fields.environmentKey,
      fields.startedAt,
      fields.completedAt,
      fields.runtimeStatus,
      fields.primaryWorkload,
      fields.semanticOutcome,
      fields.durationMs,
      fields.totalTokens,
      fields.estimatedCostMicros,
      fields.toolCount,
      fields.failedCommandCount,
      fields.changedFileCount,
      JSON.stringify(parsed),
      now(),
    );
    }
    reportingDb.exec("COMMIT");
  } catch (error) {
    try { reportingDb.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return getCurrentReportingRow(parsed.identity.turnId);
}

function hydrate(row) {
  if (!row) return null;
  return {
    rowId: row.row_id,
    stage: row.row_stage,
    semanticStatus: row.semantic_status,
    isCurrent: Boolean(row.is_current),
    createdAt: row.created_at,
    row: JSON.parse(row.row_json),
  };
}

export function getCurrentReportingRow(turnId) {
  return hydrate(reportingDb.prepare(
    "SELECT * FROM current_turn_feature_rows WHERE source_turn_id=?",
  ).get(turnId));
}

export function getReportingRowVersions(turnId) {
  return reportingDb.prepare(
    "SELECT * FROM turn_feature_rows WHERE source_turn_id=? ORDER BY seq DESC",
  ).all(turnId).map(hydrate);
}

export function listReportingRows(filters = {}) {
  const clauses = ["is_current=1"];
  const values = [];
  if (filters.q?.trim()) {
    const query = filters.q.trim();
    clauses.push("(instr(lower(source_turn_id), lower(?)) > 0 OR instr(lower(row_json), lower(?)) > 0)");
    values.push(query, query);
  }
  const mappings = [
    ["userId", "user_id"],
    ["repositoryId", "repository_id"],
    ["environmentKey", "environment_key"],
    ["workload", "primary_workload"],
    ["outcome", "semantic_outcome"],
    ["runtimeStatus", "runtime_status"],
    ["semanticStatus", "semantic_status"],
  ];
  for (const [key, column] of mappings) {
    if (filters[key]) { clauses.push(`${column}=?`); values.push(filters[key]); }
  }
  if (filters.from) { clauses.push("started_at>=?"); values.push(filters.from); }
  if (filters.to) { clauses.push("started_at<=?"); values.push(filters.to); }
  if (filters.cursor) { clauses.push("seq<?"); values.push(Number(filters.cursor)); }
  const limit = Math.max(1, Math.min(100, Number(filters.limit || 50)));
  const rows = reportingDb.prepare(`
    SELECT * FROM turn_feature_rows WHERE ${clauses.join(" AND ")}
    ORDER BY seq DESC LIMIT ?
  `).all(...values, limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    rows: page.map(hydrate),
    nextCursor: hasMore ? String(page.at(-1).seq) : null,
  };
}
