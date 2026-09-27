import { reportingDb } from "./reporting-db.js";

const OUTCOMES = ["completed", "partial_completion", "failed", "unknown"];
const SUCCESS_STATUSES = new Set(["completed", "success"]);
const BUCKETS = new Set(["hour", "day", "week"]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value) {
  const parsed = Number(value);
  return value == null || !Number.isFinite(parsed) ? null : parsed;
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function bucketStart(value, bucket) {
  const date = asDate(value);
  if (!date) return null;
  date.setUTCMinutes(0, 0, 0);
  if (bucket === "day" || bucket === "week") date.setUTCHours(0, 0, 0, 0);
  if (bucket === "week") {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - mondayOffset);
  }
  return date.toISOString();
}

function incrementBucket(value, bucket) {
  const date = new Date(value);
  if (bucket === "hour") date.setUTCHours(date.getUTCHours() + 1);
  else if (bucket === "day") date.setUTCDate(date.getUTCDate() + 1);
  else date.setUTCDate(date.getUTCDate() + 7);
  return date.toISOString();
}

function inferBucket(filters, rows) {
  if (BUCKETS.has(filters.bucket)) return filters.bucket;
  const from = asDate(filters.from) || asDate(rows[0]?.row.timing.startedAt);
  const to = asDate(filters.to) || asDate(rows.at(-1)?.row.timing.startedAt) || new Date();
  const hours = from ? Math.max(0, (to - from) / 3_600_000) : 0;
  if (hours <= 48) return "hour";
  if (hours <= 24 * 62) return "day";
  return "week";
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function title(value) {
  return String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unique(values) {
  return [...new Set(values.filter((value) => value != null && value !== ""))];
}

function hydrateDatabaseRow(row) {
  return {
    rowId: row.row_id,
    stage: row.row_stage,
    semanticStatus: row.semantic_status,
    createdAt: row.created_at,
    row: JSON.parse(row.row_json),
  };
}

function selectWindowRows(filters = {}) {
  const clauses = ["is_current=1"];
  const values = [];
  if (filters.from) { clauses.push("started_at>=?"); values.push(filters.from); }
  if (filters.to) { clauses.push("started_at<=?"); values.push(filters.to); }
  return reportingDb.prepare(`
    SELECT row_id,row_stage,semantic_status,created_at,row_json
    FROM turn_feature_rows WHERE ${clauses.join(" AND ")}
    ORDER BY started_at ASC,seq ASC
  `).all(...values).map(hydrateDatabaseRow);
}

function facet(list, key, label) {
  return { value: key, label, count: list.length };
}

function makeFacets(items) {
  const group = (getKey, getLabel = getKey) => {
    const values = new Map();
    for (const item of items) {
      const key = getKey(item.row);
      if (!key) continue;
      const current = values.get(key) || [];
      current.push(item);
      values.set(key, current);
    }
    return [...values.entries()]
      .map(([key, list]) => facet(list, key, getLabel(list[0].row)))
      .sort((a, b) => a.label.localeCompare(b.label));
  };
  return {
    repositories: group((row) => row.repository.id || row.repository.name, (row) => row.repository.name || "No repository"),
    users: group((row) => row.actor.id, (row) => row.actor.name),
    models: group((row) => row.thread.model),
    workloads: group((row) => row.semantic.workload.primary, (row) => title(row.semantic.workload.primary)),
    outcomes: group((row) => row.semantic.outcome.status, (row) => title(row.semantic.outcome.status)),
  };
}

function matchesFilters(item, filters) {
  const row = item.row;
  const repositoryKey = row.repository.id || row.repository.name;
  return (!filters.repositoryId || repositoryKey === filters.repositoryId)
    && (!filters.userId || row.actor.id === filters.userId)
    && (!filters.model || row.thread.model === filters.model)
    && (!filters.workload || row.semantic.workload.primary === filters.workload)
    && (!filters.outcome || row.semantic.outcome.status === filters.outcome);
}

function makeSeries(items, filters, bucket) {
  const values = new Map();
  const ensure = (key) => {
    if (!values.has(key)) values.set(key, {
      bucketStart: key,
      spendMicros: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      uncachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      turns: 0,
      outcomes: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])),
      turnIds: [],
    });
    return values.get(key);
  };
  const from = bucketStart(filters.from || items[0]?.row.timing.startedAt, bucket);
  const to = bucketStart(filters.to || items.at(-1)?.row.timing.startedAt, bucket);
  if (from && to) {
    let cursor = from;
    for (let index = 0; cursor <= to && index < 400; index += 1) {
      ensure(cursor);
      cursor = incrementBucket(cursor, bucket);
    }
  }
  for (const item of items) {
    const row = item.row;
    const key = bucketStart(row.timing.startedAt, bucket);
    if (!key) continue;
    const point = ensure(key);
    const input = number(row.usage.inputTokens);
    const cached = Math.min(input, number(row.usage.cachedInputTokens));
    point.spendMicros += number(row.usage.estimatedCostMicros);
    point.inputTokens += input;
    point.cachedInputTokens += cached;
    point.uncachedInputTokens += Math.max(0, input - cached);
    point.outputTokens += number(row.usage.outputTokens);
    point.totalTokens += number(row.usage.totalTokens);
    point.turns += 1;
    point.outcomes[row.semantic.outcome.status] = (point.outcomes[row.semantic.outcome.status] || 0) + 1;
    point.turnIds.push(row.identity.turnId);
  }
  return [...values.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
}

function makeRunPoint(item) {
  const row = item.row;
  return {
    turnId: row.identity.turnId,
    taskId: row.identity.taskId,
    title: row.thread.title,
    promptSummary: row.thread.title,
    repositoryId: row.repository.id || row.repository.name,
    repositoryName: row.repository.name || "No repository",
    branch: row.repository.branchAfter || row.repository.branchBefore,
    commitBefore: row.repository.commitBefore,
    commitAfter: row.repository.commitAfter,
    dirtyBefore: row.repository.dirtyBefore,
    dirtyAfter: row.repository.dirtyAfter,
    userId: row.actor.id,
    userName: row.actor.name,
    model: row.thread.model,
    runtimeStatus: row.thread.runtimeStatus,
    errorReason: row.thread.errorReason,
    startedAt: row.timing.startedAt,
    durationMs: nullableNumber(row.timing.durationMs),
    spendMicros: nullableNumber(row.usage.estimatedCostMicros),
    inputTokens: nullableNumber(row.usage.inputTokens),
    cachedInputTokens: nullableNumber(row.usage.cachedInputTokens),
    outputTokens: nullableNumber(row.usage.outputTokens),
    totalTokens: nullableNumber(row.usage.totalTokens),
    toolCalls: number(row.metrics.toolCount),
    tools: (row.tools || []).slice(0, 100).map((tool) => ({
      ordinal: tool.ordinal,
      toolName: tool.toolName,
      itemType: tool.itemType,
      intent: tool.intent?.label || "other",
      status: tool.status,
      effect: tool.effect,
      durationMs: nullableNumber(tool.durationMs),
      exitCode: tool.exitCode,
      targets: (tool.targets || []).slice(0, 4),
    })),
    failures: (row.deterministicFailures || []).map((failure) => ({
      ordinal: failure.ordinal,
      toolOrdinal: failure.toolOrdinal,
      category: failure.category,
      subject: failure.subject,
      fingerprint: failure.fingerprint,
      exitCode: failure.exitCode,
    })),
    changedFileCount: number(row.metrics.changedFileCount),
    changedFiles: (row.files || []).filter((file) => file.adds + file.updates + file.deletes + file.moves > 0).slice(0, 30).map((file) => ({ path: file.path, linesAdded: file.linesAdded, linesDeleted: file.linesDeleted })),
    validationAfterLastModification: Boolean(row.metrics.validationAfterLastModification),
    validationActions: row.metrics.validationActionsAfterLastModification || [],
    conversation: {
      userMessages: number(row.conversation?.userMessageCount),
      assistantMessages: number(row.conversation?.assistantMessageCount),
      attachments: number(row.conversation?.attachmentCount),
    },
    outcome: row.semantic.outcome.status,
    workload: row.semantic.workload.primary,
  };
}

function makeOverlap(items) {
  const groups = new Map();
  for (const item of items) {
    const row = item.row;
    const repositoryId = row.repository.id || row.repository.name || "no-repository";
    const repositoryName = row.repository.name || "No repository";
    for (const tool of row.tools || []) {
      const intent = tool.intent?.label || "other";
      const key = `${repositoryId}\u0000${intent}`;
      if (!groups.has(key)) groups.set(key, {
        repositoryId,
        repositoryName,
        intent,
        agents: new Map(),
        turnIds: new Set(),
        callCount: 0,
      });
      const value = groups.get(key);
      value.callCount += 1;
      value.agents.set(row.actor.id, row.actor.name);
      value.turnIds.add(row.identity.turnId);
    }
  }
  const cells = [...groups.values()].map((value) => ({
    repositoryId: value.repositoryId,
    repositoryName: value.repositoryName,
    intent: value.intent,
    agentCount: value.agents.size,
    agentNames: [...value.agents.values()].sort(),
    turnCount: value.turnIds.size,
    turnIds: [...value.turnIds],
    callCount: value.callCount,
  })).sort((a, b) => b.agentCount - a.agentCount || b.callCount - a.callCount);
  const repositoryTotals = new Map();
  const intentTotals = new Map();
  for (const cell of cells) {
    repositoryTotals.set(cell.repositoryId, (repositoryTotals.get(cell.repositoryId) || 0) + cell.callCount);
    intentTotals.set(cell.intent, (intentTotals.get(cell.intent) || 0) + cell.callCount);
  }
  return {
    repositories: unique(cells.map((cell) => cell.repositoryId)).map((id) => ({
      id,
      name: cells.find((cell) => cell.repositoryId === id)?.repositoryName || id,
      calls: repositoryTotals.get(id) || 0,
    })).sort((a, b) => b.calls - a.calls),
    intents: [...intentTotals.entries()].map(([intent, calls]) => ({ intent, calls })).sort((a, b) => b.calls - a.calls),
    cells,
  };
}

function makeWorkloadOutcomes(items) {
  const groups = new Map();
  for (const item of items) {
    const row = item.row;
    const workload = row.semantic.workload.primary;
    if (!groups.has(workload)) groups.set(workload, {
      workload,
      total: 0,
      outcomes: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, { count: 0, turnIds: [] }])),
    });
    const group = groups.get(workload);
    const outcome = row.semantic.outcome.status;
    group.total += 1;
    group.outcomes[outcome].count += 1;
    group.outcomes[outcome].turnIds.push(row.identity.turnId);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

function opportunityTrend(turnIds, series) {
  const selected = new Set(turnIds);
  return series.map((point) => point.turnIds.filter((id) => selected.has(id)).length);
}

function buildOpportunities(items, series, overlap, workloadOutcomes, dataQuality) {
  const opportunities = [];
  const byTurnId = new Map(items.map((item) => [item.row.identity.turnId, item]));
  const totalUsers = new Set(items.map((item) => item.row.actor.id).filter(Boolean));
  const confidenceScore = { high: 1, medium: 0.65, low: 0.35 };
  const add = (opportunity) => {
    const affectedUsers = unique(opportunity.turnIds.map((turnId) => byTurnId.get(turnId)?.row.actor.id));
    const affectedUserRatio = totalUsers.size ? affectedUsers.length / totalUsers.size : 0;
    const affectedTurnRatio = items.length ? opportunity.turnIds.length / items.length : 0;
    const basePriority = Number(opportunity.priority) || 0;
    const confidence = confidenceScore[opportunity.confidence] || 0.35;
    const rankScore = Math.round(
      (basePriority * 0.45)
      + (affectedUserRatio * 100 * 0.3)
      + (affectedTurnRatio * 100 * 0.15)
      + (confidence * 100 * 0.1),
    );
    opportunities.push({
      ...opportunity,
      affectedUserIds: affectedUsers,
      affectedUserCount: affectedUsers.length,
      affectedUserRatio,
      rankScore,
      trend: opportunityTrend(opportunity.turnIds, series),
    });
  };

  const incomplete = items.filter((item) => ["partial_completion", "failed"].includes(item.row.semantic.outcome.status));
  const totalSpend = items.reduce((sum, item) => sum + number(item.row.usage.estimatedCostMicros), 0);
  const incompleteSpend = incomplete.reduce((sum, item) => sum + number(item.row.usage.estimatedCostMicros), 0);
  if (incomplete.length && totalSpend > 0) {
    const share = incompleteSpend / totalSpend;
    add({
      id: "outcome-efficiency",
      type: "outcome_efficiency",
      priority: share >= 0.4 ? 78 : 68,
      confidence: items.length >= 5 ? "high" : "medium",
      title: "Incomplete runs hold a large share of spend",
      summary: `${incomplete.length} partial or failed turn${incomplete.length === 1 ? "" : "s"} consumed ${(share * 100).toFixed(1)}% of measured spend.`,
      evidence: [`$${(incompleteSpend / 1_000_000).toFixed(3)} measured spend`, `${incomplete.reduce((sum, item) => sum + number(item.row.metrics.toolCount), 0)} tool calls`],
      impact: { kind: "measured", label: "Spend to review", value: incompleteSpend, unit: "micros" },
      turnIds: incomplete.map((item) => item.row.identity.turnId),
      repositories: unique(incomplete.map((item) => item.row.repository.name)),
    });
  }

  const validationGaps = items.filter((item) => item.row.metrics.changedFileCount > 0 && !item.row.metrics.validationAfterLastModification);
  if (validationGaps.length) {
    add({
      id: "validation-gaps",
      type: "validation_gap",
      priority: 84,
      confidence: "high",
      title: "Edits often finish without final validation",
      summary: `${validationGaps.length} turn${validationGaps.length === 1 ? "" : "s"} changed files without validation after the last modification.`,
      evidence: [`${validationGaps.reduce((sum, item) => sum + number(item.row.metrics.changedFileCount), 0)} changed files`, "Measured after the final edit"],
      impact: { kind: "measured", label: "Turns missing final validation", value: validationGaps.length, unit: "turns" },
      turnIds: validationGaps.map((item) => item.row.identity.turnId),
      repositories: unique(validationGaps.map((item) => item.row.repository.name)),
    });
  }

  const churnRows = items.filter((item) => number(item.row.metrics.exactRepeatedCommandCount) + number(item.row.metrics.failedCommandCount) + number(item.row.metrics.timeoutCount) > 0);
  const repeatedCommands = churnRows.reduce((sum, item) => sum + number(item.row.metrics.exactRepeatedCommandCount), 0);
  const failedCommands = churnRows.reduce((sum, item) => sum + number(item.row.metrics.failedCommandCount), 0);
  const timeouts = churnRows.reduce((sum, item) => sum + number(item.row.metrics.timeoutCount), 0);
  if (repeatedCommands + failedCommands + timeouts > 0) {
    add({
      id: "command-churn",
      type: "command_churn",
      priority: 82,
      confidence: "high",
      title: "Repeated and failed commands add execution churn",
      summary: `${repeatedCommands} exact repeats, ${failedCommands} failed commands, and ${timeouts} timeouts were observed.`,
      evidence: [`${churnRows.length} affected turns`, "Exact command and runtime evidence"],
      impact: { kind: "measured", label: "Churn events", value: repeatedCommands + failedCommands + timeouts, unit: "events" },
      turnIds: churnRows.map((item) => item.row.identity.turnId),
      repositories: unique(churnRows.map((item) => item.row.repository.name)),
    });
  }

  const failureGroups = new Map();
  for (const item of items) {
    for (const failure of item.row.deterministicFailures || []) {
      if (!failure.fingerprint) continue;
      const key = `${item.row.repository.id || item.row.repository.name}\u0000${failure.fingerprint}`;
      if (!failureGroups.has(key)) failureGroups.set(key, { category: failure.category, occurrences: 0, turnIds: new Set(), repositories: new Set() });
      const group = failureGroups.get(key);
      group.occurrences += 1;
      group.turnIds.add(item.row.identity.turnId);
      group.repositories.add(item.row.repository.name);
    }
  }
  const recurring = [...failureGroups.values()].filter((group) => group.turnIds.size > 1).sort((a, b) => b.occurrences - a.occurrences);
  if (recurring.length) {
    const turnIds = unique(recurring.flatMap((group) => [...group.turnIds]));
    add({
      id: "recurring-failures",
      type: "recurring_failures",
      priority: 98,
      confidence: "high",
      title: "The same failures recur across turns",
      summary: `${recurring.length} failure fingerprint${recurring.length === 1 ? "" : "s"} appeared in more than one turn.`,
      evidence: recurring.slice(0, 3).map((group) => `${title(group.category)} · ${group.occurrences} occurrences`),
      impact: { kind: "measured", label: "Recurring failure events", value: recurring.reduce((sum, group) => sum + group.occurrences, 0), unit: "events" },
      turnIds,
      repositories: unique(recurring.flatMap((group) => [...group.repositories])),
    });
  }

  const cacheGroups = new Map();
  for (const item of items) {
    const row = item.row;
    const repositoryKey = row.repository.id || row.repository.name;
    if (!repositoryKey) continue;
    for (const tool of row.tools || []) {
      if (tool.effect !== "read" || !SUCCESS_STATUSES.has(tool.status) || !tool.inputHash || !tool.outputHash) continue;
      const key = `${repositoryKey}\u0000${tool.toolName}\u0000${tool.inputHash}`;
      if (!cacheGroups.has(key)) cacheGroups.set(key, { calls: [], outputHashes: new Set(), turnIds: new Set(), repositories: new Set() });
      const group = cacheGroups.get(key);
      group.calls.push({ item, tool });
      group.outputHashes.add(tool.outputHash);
      group.turnIds.add(row.identity.turnId);
      group.repositories.add(row.repository.name);
    }
  }
  const cacheCandidates = [...cacheGroups.values()].filter((group) => group.turnIds.size > 1 && group.outputHashes.size === 1);
  if (cacheCandidates.length) {
    const turnIds = unique(cacheCandidates.flatMap((group) => [...group.turnIds]));
    const avoidableCalls = cacheCandidates.reduce((sum, group) => sum + group.calls.length - 1, 0);
    const avoidableBytes = cacheCandidates.reduce((sum, group) => {
      const average = group.calls.reduce((total, call) => total + number(call.tool.outputBytes), 0) / group.calls.length;
      return sum + average * (group.calls.length - 1);
    }, 0);
    const allCleanSameCommit = cacheCandidates.every((group) => {
      const commits = unique(group.calls.map(({ item }) => item.row.repository.commitBefore));
      return commits.length === 1 && commits[0] && group.calls.every(({ item }) => item.row.repository.dirtyBefore === false && item.row.repository.dirtyAfter === false);
    });
    add({
      id: "stable-read-reuse",
      type: "stable_tool_reuse",
      priority: 100,
      confidence: allCleanSameCommit ? "high" : "medium",
      title: "Stable read-only results may be reusable",
      summary: `${cacheCandidates.length} exact read pattern${cacheCandidates.length === 1 ? "" : "s"} returned stable output across multiple turns.`,
      evidence: [`${avoidableCalls} repeat calls after the first result`, `${Math.round(avoidableBytes / 1024)} KB of repeated output`],
      impact: { kind: "estimated", label: "Potential context avoided", value: Math.round(avoidableBytes / 4), unit: "tokens" },
      turnIds,
      repositories: unique(cacheCandidates.flatMap((group) => [...group.repositories])),
    });
  }

  const overlapCells = overlap.cells.filter((cell) => cell.agentCount > 1);
  if (overlapCells.length) {
    const turnIds = unique(overlapCells.flatMap((cell) => cell.turnIds));
    add({
      id: "cross-agent-overlap",
      type: "cross_agent_overlap",
      priority: 96,
      confidence: "high",
      title: "Agents repeat the same classes of repository work",
      summary: `${overlapCells.length} repository-intent area${overlapCells.length === 1 ? "" : "s"} involved more than one agent. This is coordination overlap, not automatically cache waste.`,
      evidence: overlapCells.slice(0, 3).map((cell) => `${cell.repositoryName} · ${title(cell.intent)} · ${cell.agentCount} agents`),
      impact: { kind: "measured", label: "Calls in overlap areas", value: overlapCells.reduce((sum, cell) => sum + cell.callCount, 0), unit: "calls" },
      turnIds,
      repositories: unique(overlapCells.map((cell) => cell.repositoryName)),
    });
  }

  for (const group of workloadOutcomes) {
    const completedIds = group.outcomes.completed.turnIds;
    const incompleteIds = [...group.outcomes.partial_completion.turnIds, ...group.outcomes.failed.turnIds];
    if (completedIds.length < 3 || incompleteIds.length < 3) continue;
    const completedTokens = median(completedIds.map((id) => number(byTurnId.get(id)?.row.usage.totalTokens)));
    const incompleteTokens = median(incompleteIds.map((id) => number(byTurnId.get(id)?.row.usage.totalTokens)));
    if (!completedTokens || incompleteTokens < completedTokens * 1.5) continue;
    const ratio = incompleteTokens / completedTokens;
    add({
      id: `workload-efficiency-${group.workload}`,
      type: "workload_efficiency",
      priority: 72,
      confidence: "medium",
      title: `${title(group.workload)} has an incomplete-run efficiency gap`,
      summary: `The median incomplete turn used ${ratio.toFixed(1)}× the tokens of a completed turn in this workload.`,
      evidence: [`${completedIds.length} completed samples`, `${incompleteIds.length} partial or failed samples`],
      impact: { kind: "measured", label: "Median token ratio", value: Number(ratio.toFixed(1)), unit: "ratio" },
      turnIds: [...completedIds, ...incompleteIds],
      repositories: unique([...completedIds, ...incompleteIds].map((id) => byTurnId.get(id)?.row.repository.name)),
    });
  }

  const qualityIssues = dataQuality.unknownOutcomes + dataQuality.missingUsage + dataQuality.incompleteSources + dataQuality.pendingExtraction + dataQuality.failedExtraction;
  if (qualityIssues) {
    add({
      id: "data-confidence",
      type: "data_confidence",
      priority: 52,
      confidence: "high",
      title: "Some turns limit confidence in aggregate conclusions",
      summary: `${qualityIssues} data-quality signal${qualityIssues === 1 ? "" : "s"} need attention before broader optimization claims.`,
      evidence: [`${dataQuality.unknownOutcomes} unknown outcomes`, `${dataQuality.missingUsage} turns without usage`, `${dataQuality.pendingExtraction + dataQuality.failedExtraction} extraction issues`],
      impact: { kind: "measured", label: "Quality signals", value: qualityIssues, unit: "signals" },
      turnIds: items.filter((item) => item.row.semantic.outcome.status === "unknown" || item.row.usage.totalTokens == null || !item.row.quality.sourceComplete || item.semanticStatus !== "ready").map((item) => item.row.identity.turnId),
      repositories: [],
    });
  }

  return opportunities.sort((a, b) => b.rankScore - a.rankScore || b.priority - a.priority).slice(0, 8);
}

export function buildReportingInsights(items, filters = {}) {
  const normalized = items.map((item) => item.row ? item : { row: item, semanticStatus: item.extraction?.semanticStatus || "ready" });
  const facets = makeFacets(normalized);
  const filtered = normalized.filter((item) => matchesFilters(item, filters));
  const bucket = inferBucket(filters, filtered);
  const series = makeSeries(filtered, filters, bucket);
  const overlap = makeOverlap(filtered);
  const workloadOutcomes = makeWorkloadOutcomes(filtered);
  const dataQuality = {
    unknownOutcomes: filtered.filter((item) => item.row.semantic.outcome.status === "unknown").length,
    missingUsage: filtered.filter((item) => item.row.usage.totalTokens == null).length,
    incompleteSources: filtered.filter((item) => !item.row.quality.sourceComplete).length,
    pendingExtraction: filtered.filter((item) => item.semanticStatus === "pending").length,
    failedExtraction: filtered.filter((item) => item.semanticStatus === "failed").length,
  };
  const summary = filtered.reduce((value, item) => {
    const row = item.row;
    value.turns += 1;
    value.spendMicros += number(row.usage.estimatedCostMicros);
    value.inputTokens += number(row.usage.inputTokens);
    value.cachedInputTokens += number(row.usage.cachedInputTokens);
    value.outputTokens += number(row.usage.outputTokens);
    value.totalTokens += number(row.usage.totalTokens);
    value.toolCalls += number(row.metrics.toolCount);
    value.outcomes[row.semantic.outcome.status] = (value.outcomes[row.semantic.outcome.status] || 0) + 1;
    return value;
  }, {
    turns: 0,
    spendMicros: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    toolCalls: 0,
    outcomes: Object.fromEntries(OUTCOMES.map((outcome) => [outcome, 0])),
  });
  summary.uncachedInputTokens = Math.max(0, summary.inputTokens - summary.cachedInputTokens);
  summary.cacheRate = summary.inputTokens ? summary.cachedInputTokens / summary.inputTokens : null;
  const runPoints = filtered.map(makeRunPoint);
  const opportunities = buildOpportunities(filtered, series, overlap, workloadOutcomes, dataQuality);
  return {
    window: {
      from: filters.from || filtered[0]?.row.timing.startedAt || null,
      to: filters.to || filtered.at(-1)?.row.timing.startedAt || null,
      bucket,
      dataAsOf: new Date().toISOString(),
    },
    summary,
    series,
    runPoints,
    overlap,
    workloadOutcomes,
    opportunities,
    dataQuality,
    facets,
  };
}

export function getReportingInsights(filters = {}) {
  return buildReportingInsights(selectWindowRows(filters), filters);
}
