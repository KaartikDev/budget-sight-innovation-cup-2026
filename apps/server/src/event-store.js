import crypto from "node:crypto";
import { db, json, now } from "./db.js";

export function storeAgentEvent(taskId, message) {
  const method = message.method || "unknown";
  const params = message.params || {};
  const turnId = params.turnId || params.turn?.id || null;
  const item = params.item || null;
  const payload = { type: method, method, ...params };
  const createdAt = now();
  const eventKey = item?.id && ["item/started", "item/completed"].includes(method)
    ? `${method}:${item.id}`
    : turnId && ["turn/started", "turn/completed"].includes(method)
      ? `${method}:${turnId}`
      : turnId && method === "error"
        ? `${method}:${turnId}:${crypto.createHash("sha256").update(json(params.error || params)).digest("hex").slice(0, 16)}`
      : null;
  const result = db.prepare(`
    INSERT OR IGNORE INTO agent_events(task_id,upstream_id,event_type,turn_id,event_key,raw_json,created_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(taskId, item?.id || null, method, turnId, eventKey, json(payload), createdAt);
  const duplicate = result.changes === 0;
  const seq = duplicate
    ? db.prepare("SELECT seq FROM agent_events WHERE task_id=? AND event_key=?").get(taskId, eventKey)?.seq
    : Number(result.lastInsertRowid);
  return {
    seq,
    method,
    params,
    turnId,
    item,
    payload,
    createdAt,
    duplicate,
  };
}
