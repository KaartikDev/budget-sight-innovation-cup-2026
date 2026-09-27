import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  billableToolKind,
  estimateToolUsageMicros,
  estimateUsageMicros,
  normalizeUsage,
} from "@budgetsight/shared";
import { config } from "./config.js";
import { db, parseJson } from "./db.js";
import { captureEnvironmentFacts } from "./environment-facts.js";
import {
  EXTRACTOR_VERSION,
  PROMPT_VERSION,
  ROW_SCHEMA_VERSION,
  TAXONOMY_VERSION,
  TurnFeatureRowSchema,
  deriveToolIntentObservation,
  unknownSemantics,
} from "./feature-contract.js";

const USAGE_FIELDS = [
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningTokens",
  "totalTokens",
];

const TOOL_ITEM_TYPES = new Set([
  "commandExecution",
  "fileChange",
  "webSearch",
  "fileSearch",
  "mcpToolCall",
  "imageView",
  "dynamicToolCall",
]);

function sha256(value) {
  return crypto.createHash("sha256").update(String(value ?? "")).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function byteLength(value) {
  return Buffer.byteLength(String(value || ""), "utf8");
}

function countsBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function usageDelta(end, start) {
  const finish = normalizeUsage(end);
  const begin = normalizeUsage(start);
  if (!finish) return null;
  if (!begin) return finish;
  const delta = Object.fromEntries(USAGE_FIELDS.map((field) => [field, finish[field] - begin[field]]));
  return USAGE_FIELDS.every((field) => delta[field] >= 0) ? delta : finish;
}

function redactSecrets(value) {
  return String(value || "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD|AUTH|COOKIE)[A-Z0-9_]*)=([^\s]+)/gi, "$1=[REDACTED]")
    .replace(/(["']?(?:token|api[_-]?key|secret|password|authorization|cookie)["']?\s*[:=]\s*["']?)([^\s,"'}]+)/gi, "$1[REDACTED]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/(--(?:token|api[_-]?key|secret|password)\s+)([^\s]+)/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi, "$1[REDACTED]@")
    .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_TOKEN]")
    .replace(/\b[A-Za-z0-9_+/=-]{48,}\b/g, "[REDACTED_HIGH_ENTROPY_VALUE]");
}

function normalizePath(target, repositoryPath) {
  if (!target) return null;
  const text = redactSecrets(target);
  if (!path.isAbsolute(text)) return text.replaceAll("\\", "/");
  const resolved = path.resolve(text);
  const repo = repositoryPath ? path.resolve(repositoryPath) : null;
  if (repo && (resolved === repo || resolved.startsWith(`${repo}${path.sep}`))) {
    const relative = path.relative(repo, resolved).replaceAll("\\", "/");
    return relative ? `$REPO/${relative}` : "$REPO";
  }
  const home = os.homedir();
  if (resolved === home || resolved.startsWith(`${home}${path.sep}`)) {
    return resolved.replace(home, "$HOME").replaceAll("\\", "/");
  }
  return `$EXTERNAL/${path.basename(resolved)}#${sha256(resolved).slice(0, 12)}`;
}

function commandText(item) {
  return `${item.command || ""} ${(item.commandActions || []).map((action) => action.command || "").join(" ")}`.toLowerCase();
}

function isDependencyInstall(item) {
  return /\b(npm|pnpm|yarn|pip|pip3|uv|poetry|brew|apt|apt-get|cargo|gem|bundle)\s+(install|add|sync)\b/.test(commandText(item));
}

function isEnvironmentInspection(item) {
  return /\b(command -v|which|type -a|uname|sysctl|sw_vers|printenv|env\b|node --version|python(?:3)? --version|git --version|docker info)\b/.test(commandText(item));
}

function isTestOrValidation(item) {
  return /\b(test|pytest|unittest|vitest|jest|playwright|cypress|lint|typecheck|check|validate|verify|render|build|compile|tsc)\b/.test(commandText(item));
}

function redactedInvocation(command, repositoryPath) {
  let value = redactSecrets(command);
  if (repositoryPath) value = value.split(repositoryPath).join("$REPO");
  value = value.split(os.homedir()).join("$HOME");
  return value.replace(/\s+/g, " ").trim();
}

function executableName(item) {
  if (item.type !== "commandExecution") return item.name || item.tool || item.type;
  const actionCommand = item.commandActions?.[0]?.command || item.command || "";
  const stripped = actionCommand
    .replace(/^\s*(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S+)\s+)*/, "")
    .trim();
  const token = stripped.match(/^(?:['"]([^'"]+)['"]|([^\s|;&]+))/)?.slice(1).find(Boolean);
  return token ? path.basename(token) : "shell";
}

function deterministicIntent(item) {
  const command = commandText(item);
  const actionTypes = new Set((item.commandActions || []).map((action) => String(action.type || "").toLowerCase()));
  if (item.type === "fileChange") return { label: "code_editing", confidence: "high", source: "deterministic" };
  if (item.type === "webSearch") return { label: "web_searching", confidence: "high", source: "deterministic" };
  if (item.type === "fileSearch") return { label: "code_search", confidence: "high", source: "deterministic" };
  if (item.type === "imageView") return { label: "artifact_inspection", confidence: "high", source: "deterministic" };
  if (isDependencyInstall(item)) {
    return { label: "dependency_setup", confidence: "high", source: "deterministic" };
  }
  if (isEnvironmentInspection(item)) return { label: "environment_inspection", confidence: "high", source: "deterministic" };
  if (isTestOrValidation(item)) return { label: "test_validation", confidence: "high", source: "deterministic" };
  if (/\bgit\s+(?:status|diff|log|show|branch|rev-parse|remote|fetch|pull|push|add|commit|restore|checkout|switch)\b/.test(command)) {
    return { label: "version_control", confidence: "high", source: "deterministic" };
  }
  if (actionTypes.has("write") || /\b(apply_patch|sed -i|tee)\b/.test(command)) {
    return { label: "code_editing", confidence: "high", source: "deterministic" };
  }
  if (actionTypes.has("search") || /\b(rg|grep|git grep|ack|ag)\b/.test(command)) {
    return { label: "code_search", confidence: "high", source: "deterministic" };
  }
  if (actionTypes.has("list") || /\b(find|fd|ls|tree|pwd)\b/.test(command)) {
    return { label: "repo_exploration", confidence: "high", source: "deterministic" };
  }
  if (actionTypes.has("read") || /\b(cat|head|tail|less|sed -n)\b/.test(command)) {
    return { label: "file_reading", confidence: "high", source: "deterministic" };
  }
  if (item.type === "commandExecution") return { label: "command_execution", confidence: "medium", source: "deterministic" };
  return { label: "other", confidence: "low", source: "deterministic" };
}

function effectFor(item) {
  if (item.type === "fileChange") return "write";
  if (["webSearch", "fileSearch"].includes(item.type)) return "network";
  if (item.type === "imageView") return "read";
  const effects = new Set((item.commandActions || []).map((action) => {
    const type = String(action.type || "").toLowerCase();
    if (["read", "search", "list"].includes(type)) return "read";
    if (["write", "delete", "move", "create", "update"].includes(type)) return "write";
    return "process";
  }));
  if (effects.size > 1) return "mixed";
  return [...effects][0] || (item.type === "commandExecution" ? "process" : "unknown");
}

function targetsFor(item, repositoryPath) {
  const targets = [];
  for (const action of item.commandActions || []) {
    if (action.path) targets.push(normalizePath(action.path, repositoryPath));
    else if (action.name) targets.push(redactSecrets(action.name).slice(0, 160));
  }
  for (const change of item.changes || []) {
    const target = change.path || change.file;
    if (target) targets.push(normalizePath(target, repositoryPath));
  }
  return [...new Set(targets.filter(Boolean))].slice(0, 20);
}

function commandStatus(item) {
  if (item.status === "failed" || (item.exitCode != null && Number(item.exitCode) !== 0)) return "failed";
  if (["cancelled", "canceled", "interrupted"].includes(item.status)) return "cancelled";
  return item.status || "completed";
}

function fingerprintSubject(value) {
  return redactSecrets(String(value || "unknown"))
    .replace(/[^A-Za-z0-9._+-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "unknown";
}

function failureFingerprint(item) {
  const output = String(item.aggregatedOutput || "");
  const command = String(item.command || item.commandActions?.[0]?.command || "");
  let match = output.match(/ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/i);
  if (match) {
    const subject = fingerprintSubject(match[1]);
    return { category: "python_module_missing", subject, fingerprint: `python_module_missing:${subject}` };
  }
  match = output.match(/(?:command not found|not recognized as an internal or external command):?\s*([^\s]+)/i);
  if (match) {
    const subject = fingerprintSubject(match[1]);
    return { category: "command_not_found", subject, fingerprint: `command_not_found:${subject}` };
  }
  if (/(socket|bind|server_bind)[\s\S]{0,300}(operation not permitted|permission denied)/i.test(output)) {
    return { category: "socket_bind_permission_denied", subject: null, fingerprint: "socket_bind_permission_denied" };
  }
  if (/EADDRINUSE|address already in use/i.test(output)) return { category: "address_already_in_use", subject: null, fingerprint: "address_already_in_use" };
  match = output.match(/(?:ENOENT|FileNotFoundError)[\s\S]{0,200}['"]([^'"]+)['"]/i);
  match ||= output.match(/(?:No such file or directory|can't open file)[:\s]+['"]?([^'"\n]+)['"]?/i);
  if (match) {
    const subject = fingerprintSubject(path.basename(match[1].trim()));
    return { category: "file_not_found", subject, fingerprint: `file_not_found:${subject}` };
  }
  if (/EACCES|PermissionError|permission denied|operation not permitted/i.test(output)) {
    return { category: "permission_denied", subject: null, fingerprint: "permission_denied" };
  }
  const executable = executableName(item);
  if (/\b(pytest|unittest|vitest|jest|playwright|cypress|npm test|test)\b/i.test(command)) {
    const framework = command.match(/\b(pytest|unittest|vitest|jest|playwright|cypress|npm|pnpm|yarn|cargo)\b/i)?.[1]?.toLowerCase() || executable;
    return { category: "test_command_failed", subject: framework, fingerprint: `test_command_failed:${framework}` };
  }
  if (/\b(build|compile|tsc|vite build|webpack|cargo build)\b/i.test(command)) {
    const tool = command.match(/\b(tsc|vite|webpack|cargo|npm|pnpm|yarn|make|cmake|gradle|mvn)\b/i)?.[1]?.toLowerCase() || executable;
    return { category: "build_command_failed", subject: tool, fingerprint: `build_command_failed:${tool}` };
  }
  if (/\b(pip|pip3|npm|pnpm|yarn|brew|apt|cargo)\s+(install|add)\b/i.test(command)) {
    const ecosystem = command.match(/\b(pip|pip3|npm|pnpm|yarn|brew|apt|cargo)\s+(?:install|add)\b/i)?.[1]?.toLowerCase() || executable;
    return { category: "dependency_install_failed", subject: ecosystem, fingerprint: `dependency_install_failed:${ecosystem}` };
  }
  return { category: "process_exit", subject: executable, fingerprint: `process_exit:${executable}:${item.exitCode ?? "unknown"}` };
}

function changeKind(change) {
  return String(change.kind?.type || change.kind || change.type || "update").toLowerCase();
}

function diffCounts(diff, kind = "update") {
  let added = 0;
  let deleted = 0;
  const lines = String(diff || "").split("\n");
  for (const line of lines) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) deleted += 1;
  }
  const contentLines = lines.filter((line, index) => line || index < lines.length - 1).length;
  if (!added && !deleted && kind === "add") added = contentLines;
  if (!added && !deleted && kind === "delete") deleted = contentLines;
  return { added, deleted };
}

function snapshotFor(turn, phase) {
  const id = phase === "before" ? turn.before_repo_snapshot_id : turn.after_repo_snapshot_id;
  if (id) return parseJson(db.prepare("SELECT raw_json FROM repo_snapshots WHERE id=?").get(id)?.raw_json, {});
  const comparator = phase === "before" ? "<=" : ">=";
  const order = phase === "before" ? "DESC" : "ASC";
  const timestamp = phase === "before" ? turn.started_at : turn.completed_at;
  return parseJson(db.prepare(`
    SELECT raw_json FROM repo_snapshots WHERE task_id=? AND created_at ${comparator} ?
    ORDER BY created_at ${order} LIMIT 1
  `).get(turn.task_id, timestamp)?.raw_json, {});
}

function priorUsage(turn) {
  if (turn.usage_start_json) return parseJson(turn.usage_start_json);
  if (!turn.start_event_seq) return null;
  const row = db.prepare(`
    SELECT raw_json FROM agent_events
    WHERE task_id=? AND seq<? AND event_type='thread/tokenUsage/updated'
    ORDER BY seq DESC LIMIT 1
  `).get(turn.task_id, turn.start_event_seq);
  return parseJson(row?.raw_json, {})?.tokenUsage?.total || null;
}

function finalUsage(turn, events) {
  if (turn.usage_end_json) return parseJson(turn.usage_end_json);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].event_type !== "thread/tokenUsage/updated") continue;
    return parseJson(events[index].raw_json, {})?.tokenUsage?.total || null;
  }
  return null;
}

function messageRecords(turnId, events) {
  const seen = new Set();
  const messages = [];
  for (const event of events) {
    if (event.event_type !== "item/completed") continue;
    const item = parseJson(event.raw_json, {})?.item;
    if (!["userMessage", "agentMessage"].includes(item?.type) || !item.text || seen.has(item.id)) continue;
    seen.add(item.id);
    messages.push({ id: item.id, role: item.type === "userMessage" ? "user" : "assistant", text: String(item.text), seq: event.seq, createdAt: event.created_at });
  }
  const matchedEvents = new Set();
  const stored = db.prepare("SELECT id,role,text,created_at FROM messages WHERE turn_id=? ORDER BY created_at,id").all(turnId);
  for (const message of stored) {
    if (seen.has(message.id)) continue;
    const matchingIndex = messages.findIndex((candidate, index) => (
      !matchedEvents.has(index) && candidate.role === message.role && candidate.text === message.text
    ));
    if (matchingIndex >= 0) {
      matchedEvents.add(matchingIndex);
      continue;
    }
    messages.push({ id: message.id, role: message.role, text: message.text, seq: null, createdAt: message.created_at });
  }
  return messages.sort((left, right) => {
    const byTime = String(left.createdAt || "").localeCompare(String(right.createdAt || ""));
    if (byTime) return byTime;
    return Number(left.seq || Number.MAX_SAFE_INTEGER) - Number(right.seq || Number.MAX_SAFE_INTEGER);
  });
}

function attachmentRecords(turnId) {
  const messages = db.prepare("SELECT raw_json FROM messages WHERE turn_id=? AND role='user' ORDER BY created_at,id").all(turnId);
  const ids = [];
  for (const message of messages) {
    for (const id of parseJson(message.raw_json, {})?.attachmentIds || []) if (!ids.includes(id)) ids.push(id);
  }
  if (!ids.length) return [];
  const rows = db.prepare(`
    SELECT id,relative_path,size_bytes,sha256,mime_type
    FROM uploads WHERE id IN (${ids.map(() => "?").join(",")})
  `).all(...ids);
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    return [{
      path: normalizePath(row.relative_path, null),
      sizeBytes: Number(row.size_bytes),
      sha256: row.sha256,
      mimeType: row.mime_type || null,
    }];
  });
}

function repoAgentsFiles(repositoryPath, tools) {
  const found = [];
  const relativePaths = new Set();
  if (repositoryPath) {
    try {
      const tracked = execFileSync("git", ["-C", repositoryPath, "ls-files", "AGENTS.md", "*/AGENTS.md", "**/AGENTS.md"], {
        encoding: "utf8",
        timeout: 2_000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const value of tracked.split("\n").filter(Boolean)) relativePaths.add(value);
    } catch {}
    if (fs.existsSync(path.join(repositoryPath, "AGENTS.md"))) relativePaths.add("AGENTS.md");
  }
  for (const relative of [...relativePaths].sort()) {
    try {
      const contents = fs.readFileSync(path.join(repositoryPath, relative));
      found.push({ path: `$REPO/${relative.replaceAll("\\", "/")}`, read: false, sha256: sha256(contents) });
    } catch {}
  }
  for (const tool of tools) {
    for (const target of tool.targets || []) {
      if (!target.startsWith("$REPO/") || !/(^|\/)AGENTS\.md$/i.test(target)) continue;
      const existing = found.find((entry) => entry.path === target);
      if (existing) existing.read = true;
      else found.push({ path: target, read: true, sha256: null });
    }
  }
  return found;
}

function compactExcerpt(value, max = 1800) {
  const text = redactSecrets(value);
  if (text.length <= max) return text;
  const half = Math.floor(max / 2);
  return `${text.slice(0, half)}\n…[truncated]…\n${text.slice(-half)}`;
}

export function buildTurnFeatureRow(turnId) {
  const turn = db.prepare(`
    SELECT tt.*,t.user_id,t.title,t.repo_id,t.repo_name,t.repo_path,t.model,t.status AS task_status,
      t.openai_session_id,t.runtime_provider,u.display_name,u.role
    FROM task_turns tt JOIN tasks t ON t.id=tt.task_id JOIN users u ON u.id=t.user_id
    WHERE tt.turn_id=?
  `).get(turnId);
  if (!turn) throw Object.assign(new Error(`Unknown turn: ${turnId}`), { code: "turn_not_found" });

  const events = db.prepare(`
    SELECT seq,event_type,turn_id,raw_json,created_at FROM agent_events WHERE turn_id=? ORDER BY seq
  `).all(turnId);
  const completedItems = [];
  const seenItems = new Set();
  for (const event of events) {
    if (event.event_type !== "item/completed") continue;
    const item = parseJson(event.raw_json, {})?.item;
    if (!item?.type || !TOOL_ITEM_TYPES.has(item.type)) continue;
    const key = item.id || `${item.type}:${event.seq}`;
    if (seenItems.has(key)) continue;
    seenItems.add(key);
    completedItems.push({ event, item });
  }

  const repositoryPath = turn.repo_path;
  const tools = completedItems.map(({ event, item }, index) => {
    const invocation = redactedInvocation(item.command || item.commandActions?.map((action) => action.command).filter(Boolean).join(" && ") || stableJson(item.action || item.arguments || {}), repositoryPath);
    const rawOutput = item.aggregatedOutput ?? item.output ?? "";
    const output = typeof rawOutput === "string" ? rawOutput : stableJson(rawOutput);
    return {
      ordinal: `tool_${index + 1}`,
      eventSeq: event.seq,
      itemType: item.type,
      toolName: executableName(item),
      commandActionTypes: [...new Set((item.commandActions || []).map((action) => action.type || "unknown"))],
      targets: targetsFor(item, repositoryPath),
      inputHash: sha256(invocation),
      outputHash: output ? sha256(output) : null,
      outputBytes: byteLength(output),
      status: commandStatus(item),
      exitCode: item.exitCode ?? null,
      durationMs: item.durationMs ?? null,
      effect: effectFor(item),
      billableKind: billableToolKind(item),
      intent: deterministicIntent(item),
    };
  });

  const failureSource = [];
  completedItems.forEach(({ item }, index) => {
    if (item.type !== "commandExecution" || commandStatus(item) !== "failed") return;
    const normalized = failureFingerprint(item);
    failureSource.push({
      ordinal: `failure_${failureSource.length + 1}`,
      toolOrdinal: `tool_${index + 1}`,
      ...normalized,
      exitCode: item.exitCode ?? null,
      outputHash: item.aggregatedOutput ? sha256(item.aggregatedOutput) : null,
    });
  });

  const fileMap = new Map();
  function fileEntry(target) {
    if (!fileMap.has(target)) fileMap.set(target, { path: target, reads: 0, adds: 0, updates: 0, deletes: 0, moves: 0, linesAdded: 0, linesDeleted: 0 });
    return fileMap.get(target);
  }
  completedItems.forEach(({ item }, itemIndex) => {
    const toolOrdinal = `tool_${itemIndex + 1}`;
    for (const action of item.commandActions || []) {
      if (action.type === "read" && action.path) fileEntry(normalizePath(action.path, repositoryPath)).reads += 1;
    }
    for (const change of item.changes || []) {
      const target = normalizePath(change.path || change.file, repositoryPath);
      if (!target) continue;
      const entry = fileEntry(target);
      entry.firstModificationTool ||= toolOrdinal;
      entry.lastModificationTool = toolOrdinal;
      const kind = changeKind(change);
      if (kind === "add" || kind === "create") entry.adds += 1;
      else if (kind === "delete" || kind === "remove") entry.deletes += 1;
      else if (kind === "move" || change.kind?.move_path) entry.moves += 1;
      else entry.updates += 1;
      const counts = diffCounts(change.diff, kind);
      entry.linesAdded += counts.added;
      entry.linesDeleted += counts.deleted;
    }
  });
  const files = [...fileMap.values()].map((entry) => ({ ...entry, extension: path.extname(entry.path).toLowerCase() || null }));

  const messages = messageRecords(turnId, events);
  const attachments = attachmentRecords(turnId);
  const startUsage = priorUsage(turn);
  const endUsage = finalUsage(turn, events);
  const usage = usageDelta(endUsage, startUsage);
  const billable = { webSearchCalls: 0, fileSearchCalls: 0 };
  for (const tool of tools) if (tool.billableKind) billable[`${tool.billableKind}Calls`] += 1;
  const tokenCost = usage ? estimateUsageMicros(turn.model, usage) : null;
  const toolCost = estimateToolUsageMicros(billable);
  const before = snapshotFor(turn, "before");
  const after = snapshotFor(turn, "after");
  const commandInputs = tools.filter((tool) => tool.itemType === "commandExecution").map((tool) => tool.inputHash);
  const repeatCount = commandInputs.length - new Set(commandInputs).size;
  const modificationOrdinals = tools.filter((tool) => tool.effect === "write").map((tool) => Number(tool.ordinal.slice(5)));
  const lastModification = modificationOrdinals.length ? Math.max(...modificationOrdinals) : null;
  const validationAfterModification = lastModification != null && tools.some((tool) => Number(tool.ordinal.slice(5)) > lastModification && tool.intent.label === "test_validation" && tool.status === "completed");
  const validationActionsAfterModification = lastModification == null ? [] : tools
    .filter((tool) => Number(tool.ordinal.slice(5)) > lastModification && tool.intent.label === "test_validation")
    .map((tool) => tool.ordinal);
  const capturedEnvironment = parseJson(turn.environment_json) || captureEnvironmentFacts({
    runtimeProvider: turn.runtime_provider || "codex_app_server",
    workspaceRoot: repositoryPath || null,
    workingDirectory: repositoryPath || null,
  });
  const environment = {
    key: sha256(stableJson({
      hostname: capturedEnvironment.hostname,
      platform: capturedEnvironment.platform,
      release: capturedEnvironment.release,
      architecture: capturedEnvironment.architecture,
      hardwareModel: capturedEnvironment.hardwareModel,
      chip: capturedEnvironment.chip,
      memoryBytes: capturedEnvironment.memoryBytes,
      runtimeProvider: capturedEnvironment.runtimeProvider,
      sandboxMode: capturedEnvironment.sandboxMode,
    })).slice(0, 24),
    ...capturedEnvironment,
  };

  const agentsFiles = repoAgentsFiles(repositoryPath, tools);
  const sourceMaterial = {
    turn: {
      turnId,
      status: turn.status,
      startedAt: turn.started_at,
      completedAt: turn.completed_at,
      errorReason: turn.error_reason,
    },
    messages: messages.map((message) => ({ role: message.role, hash: sha256(message.text) })),
    attachments: attachments.map((attachment) => ({ path: attachment.path, sha256: attachment.sha256, sizeBytes: attachment.sizeBytes })),
    tools: tools.map((tool) => ({
      itemType: tool.itemType,
      toolName: tool.toolName,
      inputHash: tool.inputHash,
      outputHash: tool.outputHash,
      status: tool.status,
      exitCode: tool.exitCode,
      effect: tool.effect,
      targets: tool.targets,
    })),
    failures: failureSource.map((failure) => ({ fingerprint: failure.fingerprint, toolOrdinal: failure.toolOrdinal })),
    files,
    usage,
    repository: {
      remoteBefore: before.remote || null,
      remoteAfter: after.remote || null,
      branchBefore: before.branch || null,
      branchAfter: after.branch || null,
      commitBefore: before.commit || null,
      commitAfter: after.commit || null,
      dirtyBefore: before.dirty ?? null,
      dirtyAfter: after.dirty ?? null,
      agentsFiles,
    },
    approvalCount: events.filter((event) => /approval.*(?:completed|resolved)|request.*approval/i.test(event.event_type)).length,
  };
  const sourceHash = sha256(stableJson(sourceMaterial));
  const changedFileCount = files.filter((file) => file.adds + file.updates + file.deletes + file.moves > 0).length;
  const failedCommandCount = tools.filter((tool) => tool.itemType === "commandExecution" && tool.status === "failed").length;

  const row = {
    identity: {
      schemaVersion: ROW_SCHEMA_VERSION,
      extractorVersion: EXTRACTOR_VERSION,
      taxonomyVersion: TAXONOMY_VERSION,
      promptVersion: PROMPT_VERSION,
      taskId: turn.task_id,
      threadId: turn.openai_session_id || null,
      turnId,
      sourceHash,
    },
    actor: { id: turn.user_id, name: turn.display_name, role: turn.role },
    thread: {
      title: turn.title,
      model: turn.model,
      runtimeProvider: turn.runtime_provider || "codex_app_server",
      runtimeStatus: turn.status,
      taskStatus: turn.task_status,
      errorReason: turn.error_reason || null,
    },
    environment,
    repository: {
      id: turn.repo_id || null,
      name: turn.repo_name || null,
      path: repositoryPath || null,
      remote: after.remote || before.remote || null,
      remoteBefore: before.remote || null,
      remoteAfter: after.remote || null,
      branchBefore: before.branch || null,
      branchAfter: after.branch || null,
      commitBefore: before.commit || null,
      commitAfter: after.commit || null,
      dirtyBefore: before.dirty ?? null,
      dirtyAfter: after.dirty ?? null,
      agentsFiles,
    },
    timing: {
      startedAt: turn.started_at || null,
      completedAt: turn.completed_at || null,
      durationMs: turn.duration_ms ?? null,
    },
    usage: {
      ...(usage || Object.fromEntries(USAGE_FIELDS.map((field) => [field, null]))),
      estimatedTokenCostMicros: tokenCost,
      estimatedToolCostMicros: toolCost,
      estimatedCostMicros: tokenCost == null && toolCost === 0 ? null : (tokenCost || 0) + toolCost,
      webSearchCalls: billable.webSearchCalls,
      fileSearchCalls: billable.fileSearchCalls,
    },
    conversation: {
      userMessageCount: messages.filter((message) => message.role === "user").length,
      assistantMessageCount: messages.filter((message) => message.role === "assistant").length,
      userCharacterCount: messages.filter((message) => message.role === "user").reduce((sum, message) => sum + message.text.length, 0),
      assistantCharacterCount: messages.filter((message) => message.role === "assistant").reduce((sum, message) => sum + message.text.length, 0),
      messageHashes: messages.map((message, index) => ({ ordinal: `message_${index + 1}`, role: message.role, sha256: sha256(message.text) })),
      attachments,
      attachmentCount: attachments.length,
    },
    metrics: {
      toolCount: tools.length,
      toolCountsByType: countsBy(tools.map((tool) => tool.itemType)),
      toolCountsByStatus: countsBy(tools.map((tool) => tool.status)),
      commandCount: tools.filter((tool) => tool.itemType === "commandExecution").length,
      failedCommandCount,
      cancelledToolCount: tools.filter((tool) => tool.status === "cancelled").length,
      timeoutCount: completedItems.filter(({ item }) => /timed?\s*out/i.test(String(item.aggregatedOutput || ""))).length,
      approvalCount: events.filter((event) => /approval.*(?:completed|resolved)|request.*approval/i.test(event.event_type)).length,
      exactRepeatedCommandCount: repeatCount,
      environmentInspectionCount: completedItems.filter(({ item }) => isEnvironmentInspection(item)).length,
      dependencyInstallAttemptCount: completedItems.filter(({ item }) => isDependencyInstall(item)).length,
      changedFileCount,
      uniqueFileReadCount: files.filter((file) => file.reads > 0).length,
      addedFileCount: files.filter((file) => file.adds > 0).length,
      updatedFileCount: files.filter((file) => file.updates > 0).length,
      deletedFileCount: files.filter((file) => file.deletes > 0).length,
      movedFileCount: files.filter((file) => file.moves > 0).length,
      linesAdded: files.reduce((sum, file) => sum + file.linesAdded, 0),
      linesDeleted: files.reduce((sum, file) => sum + file.linesDeleted, 0),
      fileExtensions: Object.fromEntries([...new Set(files.map((file) => file.extension || "[none]"))].sort().map((extension) => [
        extension,
        files.filter((file) => (file.extension || "[none]") === extension).length,
      ])),
      outputBytes: tools.reduce((sum, tool) => sum + tool.outputBytes, 0),
      firstModificationTool: modificationOrdinals.length ? `tool_${Math.min(...modificationOrdinals)}` : null,
      lastModificationTool: lastModification == null ? null : `tool_${lastModification}`,
      validationAfterLastModification: validationAfterModification,
      validationActionsAfterLastModification: validationActionsAfterModification,
      deliverablePaths: files.filter((file) => file.adds + file.updates + file.moves > 0).map((file) => file.path),
      deliverableExtensions: [...new Set(files.filter((file) => file.adds + file.updates + file.moves > 0).map((file) => file.extension).filter(Boolean))].sort(),
    },
    files,
    tools,
    deterministicFailures: failureSource,
    semantic: unknownSemantics(tools, failureSource),
    quality: {
      sourceEventCount: events.length,
      sourceComplete: Boolean(turn.completed_at),
      usageAvailable: Boolean(usage),
      repositoryBeforeAvailable: Boolean(Object.keys(before).length),
      repositoryAfterAvailable: Boolean(Object.keys(after).length),
      semanticInputTruncated: false,
    },
    extraction: {
      model: config.featureExtractorModel,
      semanticStatus: "pending",
      attempt: 0,
      durationMs: null,
      promptTokens: null,
      outputTokens: null,
    },
  };

  const semanticTools = completedItems.map(({ item }, index) => ({
    evidence: `tool_${index + 1}`,
    itemType: item.type,
    toolName: executableName(item),
    actionTypes: (item.commandActions || []).map((action) => action.type || "unknown"),
    targets: targetsFor(item, repositoryPath),
    status: commandStatus(item),
    exitCode: item.exitCode ?? null,
    deterministicIntent: tools[index].intent,
    needsSemanticAction: tools[index].intent.confidence !== "high",
    failureOutput: commandStatus(item) === "failed" ? compactExcerpt(item.aggregatedOutput, 1_200) : null,
  }));
  const semanticInput = {
    turn: {
      runtimeStatus: turn.status,
      durationMs: turn.duration_ms,
      repository: turn.repo_name,
      changedFileCount,
    },
    messages: messages.map((message, index) => ({
      evidence: `message_${index + 1}`,
      role: message.role,
      text: compactExcerpt(message.text, message.role === "user" ? 6_000 : 4_000),
    })),
    tools: semanticTools.slice(0, 100),
    actionCandidates: semanticTools.filter((tool) => tool.needsSemanticAction).map(({ failureOutput: _ignored, ...tool }) => tool),
    failures: failureSource,
    files: files.slice(0, 100),
  };
  const summaryLength = () => {
    const { actionCandidates: _ignored, ...summary } = semanticInput;
    return JSON.stringify(summary).length;
  };
  let semanticInputTruncated = completedItems.length > 100 || files.length > 100;
  while (summaryLength() > 24_000 && semanticInput.tools.length > 10) {
    semanticInput.tools.pop();
    semanticInputTruncated = true;
  }
  while (summaryLength() > 24_000 && semanticInput.messages.length > 2) {
    semanticInput.messages.splice(1, 1);
    semanticInputTruncated = true;
  }
  while (summaryLength() > 24_000 && semanticInput.tools.length) {
    semanticInput.tools.pop();
    semanticInputTruncated = true;
  }
  while (summaryLength() > 24_000 && semanticInput.files.length > 10) {
    semanticInput.files.pop();
    semanticInputTruncated = true;
  }
  if (summaryLength() > 24_000 && semanticInput.messages.length) {
    for (const message of semanticInput.messages) message.text = compactExcerpt(message.text, 1_500);
    semanticInputTruncated = true;
  }
  while (summaryLength() > 24_000 && semanticInput.files.length) {
    semanticInput.files.pop();
    semanticInputTruncated = true;
  }
  while (summaryLength() > 24_000 && semanticInput.failures.length > 1) {
    semanticInput.failures.pop();
    semanticInputTruncated = true;
  }
  row.quality.semanticInputTruncated = semanticInputTruncated;
  row.quality.semanticInputSummaryChars = summaryLength();
  row.quality.semanticMessagesSent = semanticInput.messages.length;
  row.quality.semanticToolsSent = semanticInput.tools.length;
  row.quality.semanticFailuresSent = semanticInput.failures.length;
  row.quality.semanticActionCandidates = semanticInput.actionCandidates.length;

  return {
    row: TurnFeatureRowSchema.parse(row),
    semanticInput,
    sourceHash,
  };
}

export function mergeSemanticExtension(draft, extension, metadata = {}) {
  const knownTools = new Set(draft.tools.map((tool) => tool.ordinal));
  const knownFailures = new Set(draft.deterministicFailures.map((failure) => failure.ordinal));
  const knownEvidence = new Set([
    ...knownTools,
    ...knownFailures,
    ...draft.conversation.messageHashes.map((message) => message.ordinal),
  ]);
  const evidence = (values = []) => [...new Set(values.filter((value) => knownEvidence.has(value)))];
  const assistantEvidence = new Set(draft.conversation.messageHashes
    .filter((message) => message.role === "assistant")
    .map((message) => message.ordinal));
  const actions = new Map(draft.semantic.actions.map((action) => [action.source, action]));
  for (const action of extension.actions) {
    const existing = actions.get(action.source);
    if (knownTools.has(action.source) && existing?.confidence !== "high") actions.set(action.source, action);
  }
  const failures = new Map(draft.semantic.failures.map((failure) => [failure.source, failure]));
  for (const failure of extension.failures) {
    if (!knownFailures.has(failure.source)) continue;
    failures.set(failure.source, { ...failure, evidence: evidence([failure.source, ...failure.evidence]) });
  }
  const row = structuredClone(draft);
  const secondaryWorkloads = [...new Set(extension.workload.secondary)]
    .filter((label) => label !== extension.workload.primary)
    .slice(0, 2);
  const outcomeEvidence = evidence(extension.outcome.evidence);
  const hasOutcomeResultEvidence = outcomeEvidence.some((source) => knownTools.has(source) || assistantEvidence.has(source));
  const outcomeStatus = extension.outcome.status !== "unknown" && !hasOutcomeResultEvidence
    ? "unknown"
    : extension.outcome.status;
  const validationTools = draft.tools.filter((tool) => tool.intent.label === "test_validation");
  const passedValidation = validationTools.some((tool) => tool.status === "completed");
  const failedValidation = validationTools.some((tool) => tool.status === "failed");
  let validation = extension.outcome.validation;
  if (validation === "passed" && !passedValidation && !hasOutcomeResultEvidence) validation = failedValidation ? "failed" : validationTools.length ? "attempted" : "none";
  if (validation === "failed" && !failedValidation && !hasOutcomeResultEvidence) validation = validationTools.length ? "attempted" : "none";
  if (validation === "attempted" && !validationTools.length && !hasOutcomeResultEvidence) validation = "none";
  const normalizedUnmetGoal = extension.outcome.unmetGoal && !/^(?:none|null|n\/a)$/i.test(extension.outcome.unmetGoal.trim())
    ? extension.outcome.unmetGoal
    : null;
  row.semantic = {
    workload: { ...extension.workload, secondary: secondaryWorkloads, evidence: evidence(extension.workload.evidence) },
    actions: [...actions.values()],
    failures: [...failures.values()],
    outcome: {
      ...extension.outcome,
      status: outcomeStatus,
      validation,
      unmetGoal: outcomeStatus === "completed" ? null : normalizedUnmetGoal,
      confidence: outcomeStatus === "unknown" && extension.outcome.status !== "unknown" ? "low" : extension.outcome.confidence,
      evidence: outcomeEvidence,
    },
    observations: deriveToolIntentObservation([...actions.values()]),
  };
  row.extraction = {
    ...row.extraction,
    semanticStatus: "ready",
    attempt: metadata.attempt || 1,
    durationMs: metadata.durationMs ?? null,
    promptTokens: metadata.promptTokens ?? null,
    outputTokens: metadata.outputTokens ?? null,
    repairAttempts: metadata.repairAttempts ?? 0,
    semanticCallCount: metadata.callCount ?? 1,
  };
  return TurnFeatureRowSchema.parse(row);
}
