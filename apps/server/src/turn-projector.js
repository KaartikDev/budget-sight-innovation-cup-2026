import { db, json, now, parseJson } from "./db.js";
import { captureEnvironmentFacts } from "./environment-facts.js";

function turnEnvironment(task) {
  return captureEnvironmentFacts({
    runtimeProvider: task.runtimeProvider || task.runtime_provider || "codex_app_server",
    workspaceRoot: task.repository?.path || task.repo_path || null,
    workingDirectory: task.repository?.path || task.repo_path || null,
  });
}

function milliseconds(startedAt, completedAt, explicit = null) {
  if (explicit != null && Number.isFinite(Number(explicit))) return Math.max(0, Number(explicit));
  const start = Date.parse(startedAt || "");
  const end = Date.parse(completedAt || "");
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

function isoFromEpoch(value, fallback) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return new Date(number < 10_000_000_000 ? number * 1000 : number).toISOString();
}

export function projectTurnStarted(task, event, { beforeRepoSnapshotId = null } = {}) {
  if (!event.turnId) return null;
  const startedAt = isoFromEpoch(event.params.turn?.startedAt, event.createdAt);
  const createdAt = now();
  db.prepare(`
    INSERT INTO task_turns(
      turn_id,task_id,status,started_at,start_event_seq,before_repo_snapshot_id,
      usage_start_json,environment_json,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(turn_id) DO UPDATE SET
      status='running',started_at=COALESCE(task_turns.started_at,excluded.started_at),
      start_event_seq=COALESCE(task_turns.start_event_seq,excluded.start_event_seq),
      before_repo_snapshot_id=COALESCE(task_turns.before_repo_snapshot_id,excluded.before_repo_snapshot_id),
      usage_start_json=COALESCE(task_turns.usage_start_json,excluded.usage_start_json),
      environment_json=COALESCE(task_turns.environment_json,excluded.environment_json),
      updated_at=excluded.updated_at
  `).run(
    event.turnId,
    task.id,
    "running",
    startedAt,
    event.seq,
    beforeRepoSnapshotId,
    json(task.usage),
    json(turnEnvironment(task)),
    createdAt,
    createdAt,
  );
  return event.turnId;
}

export function ensureTurnRecord(task, turnId, details = {}) {
  if (!turnId) return null;
  const createdAt = now();
  db.prepare(`
    INSERT INTO task_turns(turn_id,task_id,status,started_at,before_repo_snapshot_id,usage_start_json,environment_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(turn_id) DO UPDATE SET
      before_repo_snapshot_id=COALESCE(task_turns.before_repo_snapshot_id,excluded.before_repo_snapshot_id),
      environment_json=COALESCE(task_turns.environment_json,excluded.environment_json),
      updated_at=excluded.updated_at
  `).run(
    turnId,
    task.id,
    details.status || "running",
    details.startedAt || createdAt,
    details.beforeRepoSnapshotId || null,
    json(details.usageStart ?? task.usage),
    json(turnEnvironment(task)),
    createdAt,
    createdAt,
  );
  return turnId;
}

export function projectTurnUsage(turnId, usage) {
  if (!turnId || !usage?.total) return;
  db.prepare("UPDATE task_turns SET usage_end_json=?,updated_at=? WHERE turn_id=?")
    .run(json(usage.total), now(), turnId);
}

export function projectTurnCompleted(task, event, status, reason = null, afterRepoSnapshotId = null) {
  if (!event.turnId) return null;
  ensureTurnRecord(task, event.turnId, { startedAt: event.params.turn?.startedAt });
  const stored = db.prepare("SELECT started_at FROM task_turns WHERE turn_id=?").get(event.turnId);
  const startedAt = isoFromEpoch(event.params.turn?.startedAt, stored?.started_at || null);
  const completedAt = isoFromEpoch(event.params.turn?.completedAt, event.createdAt);
  db.prepare(`
    UPDATE task_turns SET status=?,started_at=COALESCE(?,started_at),completed_at=?,duration_ms=?,
      end_event_seq=?,error_reason=?,after_repo_snapshot_id=?,updated_at=? WHERE turn_id=?
  `).run(
    status,
    startedAt,
    completedAt,
    milliseconds(startedAt, completedAt, event.params.turn?.durationMs),
    event.seq,
    reason,
    afterRepoSnapshotId,
    now(),
    event.turnId,
  );
  return event.turnId;
}

export function linkMessageToTurn(messageId, turnId) {
  if (!messageId || !turnId) return;
  db.prepare("UPDATE messages SET turn_id=? WHERE id=?").run(turnId, messageId);
}

export function linkRepoSnapshotToTurn(snapshotId, turnId) {
  if (!snapshotId || !turnId) return;
  db.prepare("UPDATE repo_snapshots SET turn_id=? WHERE id=?").run(turnId, snapshotId);
  db.prepare("UPDATE task_turns SET before_repo_snapshot_id=COALESCE(before_repo_snapshot_id,?),updated_at=? WHERE turn_id=?")
    .run(snapshotId, now(), turnId);
}

export function markActiveTurnsOrphaned() {
  const active = db.prepare(`
    SELECT tt.*,t.latest_usage_json FROM task_turns tt JOIN tasks t ON t.id=tt.task_id
    WHERE tt.status='running' AND tt.completed_at IS NULL
  `).all();
  const endedAt = now();
  for (const turn of active) {
    db.prepare(`
      UPDATE task_turns SET status='orphaned',completed_at=?,duration_ms=?,error_reason='server_restarted',
        usage_end_json=COALESCE(usage_end_json,?),updated_at=? WHERE turn_id=?
    `).run(
      endedAt,
      milliseconds(turn.started_at, endedAt),
      turn.latest_usage_json,
      endedAt,
      turn.turn_id,
    );
  }
  return active.map((turn) => turn.turn_id);
}

export function rebuildTurnIndexFromEvents() {
  const tasks = new Map(db.prepare("SELECT * FROM tasks").all().map((row) => [row.id, row]));
  const events = db.prepare(`
    SELECT seq,task_id,event_type,turn_id,raw_json,created_at FROM agent_events
    WHERE turn_id IS NOT NULL AND event_type IN ('turn/started','turn/completed','thread/tokenUsage/updated','error')
    ORDER BY seq
  `).all();
  for (const row of events) {
    const task = tasks.get(row.task_id);
    if (!task) continue;
    const payload = parseJson(row.raw_json, {});
    const event = {
      seq: row.seq,
      method: row.event_type,
      turnId: row.turn_id,
      params: payload,
      createdAt: row.created_at,
    };
    if (row.event_type === "turn/started") {
      projectTurnStarted({ ...task, id: row.task_id, usage: null }, event);
    } else if (row.event_type === "thread/tokenUsage/updated") {
      projectTurnUsage(row.turn_id, payload.tokenUsage);
    } else if (row.event_type === "turn/completed") {
      const status = payload.turn?.status || "completed";
      projectTurnCompleted({ id: row.task_id, usage: parseJson(task.latest_usage_json) }, event, status, payload.turn?.error?.message || null);
    } else {
      projectTurnCompleted({ id: row.task_id, usage: parseJson(task.latest_usage_json) }, event, "failed", payload.error?.message || "codex_error");
    }
  }

  const completedMessages = db.prepare(`
    SELECT task_id,turn_id,raw_json,created_at FROM agent_events
    WHERE turn_id IS NOT NULL AND event_type='item/completed' ORDER BY seq
  `).all();
  for (const row of completedMessages) {
    const item = parseJson(row.raw_json, {})?.item;
    if (!item?.id || !["userMessage", "agentMessage"].includes(item.type)) continue;
    const role = item.type === "userMessage" ? "user" : "assistant";
    let message = db.prepare("SELECT id FROM messages WHERE id=?").get(item.id);
    if (!message && item.text) {
      message = db.prepare(`
        SELECT id FROM messages
        WHERE task_id=? AND role=? AND text=? AND turn_id IS NULL
        ORDER BY ABS(julianday(created_at)-julianday(?)) LIMIT 1
      `).get(row.task_id, role, item.text, row.created_at);
    }
    if (message) linkMessageToTurn(message.id, row.turn_id);
  }

  const turns = db.prepare(`
    SELECT turn_id,task_id,started_at,completed_at,before_repo_snapshot_id,after_repo_snapshot_id
    FROM task_turns
  `).all();
  for (const turn of turns) {
    const beforeId = turn.before_repo_snapshot_id || db.prepare(`
      SELECT id FROM repo_snapshots WHERE task_id=? AND created_at<=?
      ORDER BY created_at DESC,id DESC LIMIT 1
    `).get(turn.task_id, turn.started_at)?.id || null;
    const afterId = turn.after_repo_snapshot_id || db.prepare(`
      SELECT id FROM repo_snapshots WHERE task_id=? AND created_at>=?
      ORDER BY created_at,id LIMIT 1
    `).get(turn.task_id, turn.completed_at)?.id || null;
    db.prepare(`
      UPDATE task_turns SET before_repo_snapshot_id=?,after_repo_snapshot_id=?,updated_at=? WHERE turn_id=?
    `).run(beforeId, afterId, now(), turn.turn_id);
  }
  return db.prepare("SELECT COUNT(*) AS count FROM task_turns").get().count;
}
