export const MODELS = ["gpt-6-astra", "gpt-6-sol", "gpt-6-luna"];

export const TASK_STATUSES = [
  "draft",
  "connecting",
  "running",
  "idle_completed",
  "budget_interrupted",
  "user_interrupted",
  "failed",
];

export const PRICING_VERSION = "2026-09-26.standard-api-full-spend.v4";
export const LONG_CONTEXT_THRESHOLD = 272_000;

// Separately billed hosted API tools, expressed in micro-dollars per completed
// call. Local app-server commands, browser control, and MCP calls are not API
// tool charges and intentionally do not appear here.
export const TOOL_PRICING = Object.freeze({
  webSearch: 10_000,
  fileSearch: 2_500,
});

// Standard API list prices in USD per one million tokens. Long-context rates
// apply to an entire model call when that call contains more than 272K input
// tokens. Cache writes are a separate input category, not an added surcharge.
export const PRICING = Object.freeze({
  "gpt-6-astra": {
    input: 10,
    cachedInput: 1,
    cacheWrite: 12.5,
    output: 50,
    longContext: { input: 20, cachedInput: 2, cacheWrite: 25, output: 75 },
  },
  "gpt-6-sol": {
    input: 2,
    cachedInput: 0.2,
    cacheWrite: 2.5,
    output: 10,
    longContext: { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 15 },
  },
  "gpt-6-luna": {
    input: 0.1,
    cachedInput: 0.01,
    cacheWrite: 0.125,
    output: 0.5,
    longContext: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 },
  },
});

export function budgetUsdToMicros(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error("Budget must be greater than zero");
  return Math.round(number * 1_000_000);
}

export function microsToUsd(value) {
  return Number(value || 0) / 1_000_000;
}

function tokenCount(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function normalizeUsage(usage) {
  if (!usage) return null;
  const input = tokenCount(usage.input_tokens ?? usage.inputTokens);
  const cached = Math.min(input, tokenCount(usage.input_tokens_details?.cached_tokens ?? usage.cachedInputTokens));
  const cacheWrite = Math.min(
    Math.max(0, input - cached),
    tokenCount(usage.input_tokens_details?.cache_write_tokens ?? usage.cacheWriteInputTokens),
  );
  const output = tokenCount(usage.output_tokens ?? usage.outputTokens);
  const reasoning = tokenCount(
    usage.output_tokens_details?.reasoning_tokens
      ?? usage.reasoningOutputTokens
      ?? usage.reasoningTokens,
  );
  return {
    inputTokens: input,
    cachedInputTokens: cached,
    cacheWriteInputTokens: cacheWrite,
    outputTokens: output,
    reasoningTokens: Math.min(output, reasoning),
    totalTokens: tokenCount(usage.total_tokens ?? usage.totalTokens ?? input + output),
  };
}

function usageCostMicros(usage, rates) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return null;
  const uncached = Math.max(
    0,
    normalized.inputTokens - normalized.cachedInputTokens - normalized.cacheWriteInputTokens,
  );
  return Math.round(
    uncached * rates.input
      + normalized.cachedInputTokens * rates.cachedInput
      + normalized.cacheWriteInputTokens * rates.cacheWrite
      + normalized.outputTokens * rates.output,
  );
}

// Use this for one model response. The app-server's tokenUsage.last field is a
// per-response measurement and therefore supports the long-context price test.
export function estimateGenerationMicros(model, usage) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return null;
  const price = PRICING[model];
  if (!price) throw new Error(`Unsupported model: ${model}`);
  const rates = normalized.inputTokens > LONG_CONTEXT_THRESHOLD ? price.longContext : price;
  return usageCostMicros(normalized, rates);
}

// Aggregate usage does not reveal which individual calls crossed the long-
// context threshold. This fallback uses standard short-context list rates;
// live accounting uses estimateGenerationMicros for every reported call.
export function estimateUsageMicros(model, usage) {
  const price = PRICING[model];
  if (!price) throw new Error(`Unsupported model: ${model}`);
  return usageCostMicros(usage, price);
}

export function normalizeToolUsage(usage) {
  return {
    webSearchCalls: tokenCount(usage?.webSearchCalls),
    fileSearchCalls: tokenCount(usage?.fileSearchCalls),
  };
}

export function billableToolKind(item) {
  if (!item) return null;
  if (item.type === "fileSearch") return "fileSearch";
  if (item.type !== "webSearch") return null;
  const action = item.action?.type;
  return ["search", "imageSearch", "image_search"].includes(action) ? "webSearch" : null;
}

export function estimateToolUsageMicros(usage) {
  const normalized = normalizeToolUsage(usage);
  return Math.round(
    normalized.webSearchCalls * TOOL_PRICING.webSearch
      + normalized.fileSearchCalls * TOOL_PRICING.fileSearch,
  );
}

export function tokenEnvelope(model, budgetMicros) {
  return planningTokenRange(model, budgetMicros).outputHeavy;
}

export function planningTokenRange(model, budgetMicros) {
  const price = PRICING[model];
  if (!price) throw new Error(`Unsupported model: ${model}`);
  return {
    outputHeavy: Math.floor(Number(budgetMicros) / price.output),
    uncachedInput: Math.floor(Number(budgetMicros) / Math.max(price.input, price.cacheWrite)),
  };
}

export function estimateTokenCapacity(model, budgetMicros, usage, estimatedMicrosOverride = null) {
  const normalized = normalizeUsage(usage);
  const estimatedMicros = estimatedMicrosOverride ?? estimateUsageMicros(model, usage);
  if (!normalized || !estimatedMicros || normalized.totalTokens <= 0) return null;
  return Math.floor((Number(budgetMicros) / estimatedMicros) * normalized.totalTokens);
}

export function budgetState(model, budgetMicros, usage, options = {}) {
  const normalized = normalizeUsage(usage);
  const estimatedMicros = options.estimatedMicros ?? estimateUsageMicros(model, usage);
  const planningRange = planningTokenRange(model, budgetMicros);
  const envelope = planningRange.outputHeavy;
  const estimatedTokenCapacity = estimateTokenCapacity(model, budgetMicros, usage, estimatedMicros);
  const estimatedRemainingTokens = normalized && estimatedTokenCapacity != null
    ? Math.max(0, estimatedTokenCapacity - normalized.totalTokens)
    : null;
  const exhausted = Boolean(
    estimatedMicros != null && estimatedMicros >= Number(budgetMicros),
  );
  return {
    usage: normalized,
    estimatedMicros,
    tokenEnvelope: envelope,
    worstCaseTokens: envelope,
    planningTokenRange: planningRange,
    estimatedTokenCapacity,
    estimatedRemainingTokens,
    remainingTokens: estimatedRemainingTokens,
    enforcementBasis: "estimated_standard_api_cost",
    exhausted,
    overrunMicros: estimatedMicros == null ? 0 : Math.max(0, estimatedMicros - Number(budgetMicros)),
  };
}
