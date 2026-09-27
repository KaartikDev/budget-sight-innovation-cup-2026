import test from "node:test";
import assert from "node:assert/strict";
import { buildReportingInsights } from "../src/reporting-insights.js";

function reportingRow({
  turnId,
  startedAt,
  actorId = "actor-1",
  actorName = "Maya Chen",
  repositoryId = "repo-1",
  repositoryName = "budget-app",
  outcome = "completed",
  workload = "code_generation",
  inputTokens = 1_000,
  cachedInputTokens = 750,
  outputTokens = 200,
  costMicros = 2_000,
  tools = [],
  changedFileCount = 0,
  validationAfterLastModification = false,
  failures = [],
  sourceComplete = true,
  semanticStatus = "ready",
  commit = "abc123",
  dirty = false,
}) {
  return {
    semanticStatus,
    row: {
      identity: { turnId },
      actor: { id: actorId, name: actorName },
      thread: { title: `Turn ${turnId}`, model: "gpt-6-sol" },
      repository: { id: repositoryId, name: repositoryName, commitBefore: commit, dirtyBefore: dirty, dirtyAfter: dirty },
      timing: { startedAt, durationMs: 60_000 },
      usage: { inputTokens, cachedInputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimatedCostMicros: costMicros },
      metrics: {
        toolCount: tools.length,
        changedFileCount,
        validationAfterLastModification,
        exactRepeatedCommandCount: 0,
        failedCommandCount: 0,
        timeoutCount: 0,
      },
      tools,
      deterministicFailures: failures,
      semantic: { workload: { primary: workload }, outcome: { status: outcome } },
      quality: { sourceComplete },
    },
  };
}

function tool({ effect = "read", inputHash = "input-1", outputHash = "output-1", status = "completed", outputBytes = 4_000 } = {}) {
  return { effect, inputHash, outputHash, status, outputBytes, toolName: "cat", intent: { label: "file_reading" } };
}

test("builds UTC buckets, summary totals, facets, and filtered results", () => {
  const items = [
    reportingRow({ turnId: "turn-1", startedAt: "2026-09-26T23:30:00.000Z", actorId: "actor-1" }),
    reportingRow({ turnId: "turn-2", startedAt: "2026-09-27T01:15:00.000Z", actorId: "actor-2", actorName: "Jordan Patel", outcome: "failed", costMicros: 8_000 }),
  ];
  const result = buildReportingInsights(items, {
    from: "2026-09-26T23:00:00.000Z",
    to: "2026-09-27T02:00:00.000Z",
    bucket: "hour",
    userId: "actor-1",
  });
  assert.equal(result.summary.turns, 1);
  assert.equal(result.summary.cacheRate, 0.75);
  assert.deepEqual(result.series.map((point) => point.bucketStart), [
    "2026-09-26T23:00:00.000Z",
    "2026-09-27T00:00:00.000Z",
    "2026-09-27T01:00:00.000Z",
    "2026-09-27T02:00:00.000Z",
  ]);
  assert.equal(result.series[0].turns, 1);
  assert.equal(result.series[1].turns, 0);
  assert.equal(result.facets.users.length, 2);
});

test("only recommends stable cross-turn read results as reusable", () => {
  const stableRead = tool();
  const items = [
    reportingRow({ turnId: "turn-1", startedAt: "2026-09-26T10:00:00.000Z", tools: [stableRead, tool({ effect: "write", inputHash: "write" })] }),
    reportingRow({ turnId: "turn-2", startedAt: "2026-09-26T11:00:00.000Z", tools: [stableRead, tool({ effect: "write", inputHash: "write" })] }),
    reportingRow({ turnId: "turn-3", startedAt: "2026-09-26T12:00:00.000Z", tools: [tool({ inputHash: "unstable", outputHash: "a" }), tool({ inputHash: "same-turn" }), tool({ inputHash: "same-turn" })] }),
    reportingRow({ turnId: "turn-4", startedAt: "2026-09-26T13:00:00.000Z", tools: [tool({ inputHash: "unstable", outputHash: "b" })] }),
  ];
  const result = buildReportingInsights(items, { bucket: "hour" });
  const reuse = result.opportunities.find((item) => item.type === "stable_tool_reuse");
  assert.ok(reuse);
  assert.equal(reuse.confidence, "high");
  assert.match(reuse.summary, /^1 exact read pattern/);
  assert.equal(reuse.impact.kind, "estimated");
  assert.deepEqual(reuse.turnIds.sort(), ["turn-1", "turn-2"]);
});

test("surfaces validation gaps, overlap, recurring failures, and data quality", () => {
  const repeatedFailure = { fingerprint: "failure-1", category: "test_command_failed" };
  const items = [
    reportingRow({ turnId: "turn-1", startedAt: "2026-09-26T10:00:00.000Z", actorId: "actor-1", tools: [tool()], changedFileCount: 2, failures: [repeatedFailure] }),
    reportingRow({ turnId: "turn-2", startedAt: "2026-09-26T11:00:00.000Z", actorId: "actor-2", actorName: "Jordan Patel", tools: [tool()], changedFileCount: 1, failures: [repeatedFailure], outcome: "unknown", sourceComplete: false, semanticStatus: "pending" }),
  ];
  const result = buildReportingInsights(items, { bucket: "hour" });
  assert.ok(result.opportunities.some((item) => item.type === "validation_gap"));
  assert.ok(result.opportunities.some((item) => item.type === "cross_agent_overlap"));
  assert.ok(result.opportunities.some((item) => item.type === "recurring_failures"));
  assert.ok(result.opportunities.some((item) => item.type === "data_confidence"));
  assert.deepEqual(result.opportunities.slice(0, 3).map((item) => item.type), ["stable_tool_reuse", "recurring_failures", "cross_agent_overlap"]);
  assert.equal(result.overlap.cells[0].agentCount, 2);
  assert.equal(result.dataQuality.unknownOutcomes, 1);
  assert.equal(result.dataQuality.incompleteSources, 1);
  assert.equal(result.dataQuality.pendingExtraction, 1);
});
