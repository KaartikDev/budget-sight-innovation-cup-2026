import test from "node:test";
import assert from "node:assert/strict";
import {
  billableToolKind,
  budgetState,
  budgetUsdToMicros,
  estimateGenerationMicros,
  estimateToolUsageMicros,
  estimateTokenCapacity,
  estimateUsageMicros,
  normalizeUsage,
  planningTokenRange,
  tokenEnvelope,
} from "@budgetsight/shared";
test("normalizes cached and reasoning usage", () => {
  assert.deepEqual(normalizeUsage({
    input_tokens: 5_000,
    input_tokens_details: { cached_tokens: 1_500 },
    output_tokens: 900,
    output_tokens_details: { reasoning_tokens: 200 },
    total_tokens: 5_900,
  }), {
    inputTokens: 5_000,
    cachedInputTokens: 1_500,
    cacheWriteInputTokens: 0,
    outputTokens: 900,
    reasoningTokens: 200,
    totalTokens: 5_900,
  });
});

test("uses Standard API-key rates and separate cache-write tokens", () => {
  const usage = {
    input_tokens: 1_000_000,
    input_tokens_details: { cached_tokens: 200_000, cache_write_tokens: 100_000 },
    output_tokens: 100_000,
    total_tokens: 1_100_000,
  };
  // Aggregate fallback: 700k input at $2/M + 200k cached at $.20/M
  // + 100k cache writes at $2.50/M + 100k output at $10/M.
  assert.equal(estimateUsageMicros("gpt-6-sol", usage), 2_690_000);
  assert.equal(budgetUsdToMicros("2.50"), 2_500_000);
});

test("prices each generation at its applicable context tier", () => {
  assert.equal(estimateGenerationMicros("gpt-6-sol", {
    inputTokens: 272_000,
    cachedInputTokens: 100_000,
    cacheWriteInputTokens: 50_000,
    outputTokens: 1_000,
  }), 399_000);
  assert.equal(estimateGenerationMicros("gpt-6-sol", {
    inputTokens: 272_001,
    cachedInputTokens: 100_000,
    cacheWriteInputTokens: 50_000,
    outputTokens: 1_000,
  }), 793_004);
});

test("adds separately billed hosted tool calls", () => {
  assert.equal(estimateToolUsageMicros({
    webSearchCalls: 1,
    fileSearchCalls: 2,
  }), 15_000);
  assert.equal(billableToolKind({ type: "webSearch", action: { type: "search" } }), "webSearch");
  assert.equal(billableToolKind({ type: "webSearch", action: { type: "openPage" } }), null);
  assert.equal(billableToolKind({ type: "fileSearch" }), "fileSearch");
  assert.equal(billableToolKind({ type: "mcpToolCall" }), null);
});

test("planning envelope is informational while estimated cost enforces the cap", () => {
  assert.equal(tokenEnvelope("gpt-6-sol", 1_000_000), 100_000);
  assert.deepEqual(planningTokenRange("gpt-6-sol", 1_000_000), {
    outputHeavy: 100_000,
    uncachedInput: 400_000,
  });
  const belowCap = budgetState("gpt-6-sol", 1_000_000, {
    input_tokens: 70_000,
    output_tokens: 0,
    total_tokens: 70_000,
  });
  assert.equal(belowCap.exhausted, false);

  const atCap = budgetState("gpt-6-sol", 1_000_000, {
    input_tokens: 400_000,
    input_tokens_details: { cache_write_tokens: 400_000 },
    output_tokens: 0,
    total_tokens: 400_000,
  });
  assert.equal(atCap.estimatedMicros, 1_000_000);
  assert.equal(atCap.exhausted, true);
  assert.equal(atCap.estimatedRemainingTokens, 0);
});

test("estimates token capacity from the observed token mix", () => {
  const usage = {
    input_tokens: 100_000,
    output_tokens: 0,
    total_tokens: 100_000,
  };
  assert.equal(estimateTokenCapacity("gpt-6-sol", 1_000_000, usage), 500_000);
  const state = budgetState("gpt-6-sol", 1_000_000, usage);
  assert.equal(state.estimatedTokenCapacity, 500_000);
  assert.equal(state.estimatedRemainingTokens, 400_000);
  assert.equal(state.enforcementBasis, "estimated_standard_api_cost");
});

test("null usage is pending rather than zero", () => {
  const state = budgetState("gpt-6-luna", 1_000_000, null);
  assert.equal(state.usage, null);
  assert.equal(state.estimatedMicros, null);
  assert.equal(state.exhausted, false);
});
