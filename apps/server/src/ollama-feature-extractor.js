import { z } from "zod";
import { config } from "./config.js";
import {
  ACTION_LABELS,
  CONFIDENCE_LEVELS,
  SemanticExtensionSchema,
  SemanticFailureSchema,
  SemanticSummarySchema,
} from "./feature-contract.js";

const SYSTEM_PROMPT = `You are a factual feature classifier for coding-agent turns.
Return only data matching the supplied JSON schema.
Describe what happened. Do not judge waste, importance, savings, quality, or what anyone should change.
Use only the provided evidence identifiers. Never invent tools, failures, or facts.
Use the small controlled label sets exactly as defined by the schema.
Task workload labels: code_generation creates or changes implementation code; debugging diagnoses or fixes a defect; testing primarily creates or runs tests; repo_exploration maps or understands a repository; web_research gathers external information; artifact_generation creates documents, media, or reports; environment_setup installs or configures dependencies; deployment_operations ships or operates a service; analysis_planning produces analysis or a plan without another primary deliverable; other is none of these.
Tool intent labels: repo_exploration lists or maps repository structure; code_search locates symbols or text in code; file_reading reads file contents; code_editing changes files; test_validation tests, builds, renders, or verifies output; command_execution runs another process; environment_inspection checks runtime or machine capabilities; dependency_setup installs or configures dependencies; web_searching searches or reads the web; version_control inspects or changes Git state; artifact_inspection views a generated artifact; other is none of these.
Failure states: benign_expected was an intentional probe; recovered was followed by a successful workaround; blocking prevented the turn goal; unresolved remained at the end; unknown lacks evidence.
Outcome completed means the requested goal was delivered, partial_completion means only part was delivered, and failed means it was not delivered. Validation passed only with successful verification evidence; attempted means verification ran without a clear pass.
Do not return observations. The service derives the dominant repeated tool intent from the per-tool classifications.
If evidence is insufficient, use unknown fields.`;

const ACTION_PROMPT = `${SYSTEM_PROMPT}
Classify only the supplied ambiguous tool items. Return one action for each supplied tool evidence identifier and no others.`;

function ollamaError(message, code, cause = null) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code });
}

function ollamaFormat(schema) {
  const unsupportedGrammarKeywords = new Set([
    "$schema",
    "pattern",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
  ]);
  function visit(value) {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !unsupportedGrammarKeywords.has(key))
      .map(([key, child]) => [key, visit(child)]));
  }
  return visit(z.toJSONSchema(schema));
}

function actionBatchSchemaFor(tools) {
  const sources = tools.map((tool) => tool.evidence);
  return z.object({
    actions: z.array(z.object({
      // An enum is enforced by Ollama's grammar. A regex is only checked after
      // generation and small local models often paraphrase ordinal references.
      source: z.enum(sources),
      label: z.enum(ACTION_LABELS),
      confidence: z.enum(CONFIDENCE_LEVELS),
    }).strict()).max(20),
  }).strict();
}

function summarySchemaFor(input) {
  const sources = (input.failures || []).map((failure) => failure.ordinal);
  const source = sources.length ? z.enum(sources) : z.string();
  return SemanticSummarySchema.extend({
    failures: z.array(SemanticFailureSchema.extend({ source }).strict()),
  }).strict();
}

async function postStructured(schema, prompt, systemPrompt, normalize = (value) => value) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.featureExtractorTimeoutMs);
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];
  let repairAttempts = 0;
  let promptTokens = 0;
  let outputTokens = 0;
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${config.ollamaBaseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          model: config.featureExtractorModel,
          stream: false,
          think: false,
          keep_alive: "15m",
          // Ollama/llama.cpp cannot compile a few validation-only JSON Schema
          // keywords into a grammar. Zod still enforces the full schema below.
          format: ollamaFormat(schema),
          options: { temperature: 0, num_ctx: 8_192, num_predict: 768 },
          messages,
        }),
      });
      if (!response.ok) {
        try { await response.body?.cancel(); } catch {}
        const code = response.status === 404 ? "ollama_model_missing" : "ollama_unavailable";
        throw ollamaError(`Ollama returned HTTP ${response.status}`, code);
      }
      const payload = await response.json();
      promptTokens += Number(payload.prompt_eval_count || 0);
      outputTokens += Number(payload.eval_count || 0);
      const raw = payload.message?.content || "";
      try {
        const value = schema.parse(normalize(JSON.parse(raw)));
        return {
          value,
          model: payload.model || config.featureExtractorModel,
          promptTokens,
          outputTokens,
          repairAttempts,
        };
      } catch (error) {
        if (attempt === 1) {
          const issues = error instanceof z.ZodError
            ? error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`).join("; ")
            : "invalid JSON";
          throw ollamaError(
            `Ollama response failed JSON-schema validation after one repair attempt (${issues})`,
            "semantic_schema_invalid",
            error,
          );
        }
        repairAttempts = 1;
        messages.push(
          { role: "assistant", content: String(raw).slice(0, 8_000) },
          { role: "user", content: "That response did not match the JSON schema. Repair it and return only the corrected JSON object." },
        );
      }
    }
    throw ollamaError("Ollama did not return a semantic result", "semantic_schema_invalid");
  } catch (error) {
    if (error.name === "AbortError") throw ollamaError("Ollama extraction timed out", "ollama_unavailable", error);
    if (typeof error.code === "string") throw error;
    throw ollamaError(`Ollama unavailable: ${error.message}`, "ollama_unavailable", error);
  } finally {
    clearTimeout(timeout);
  }
}

function uniqueStrings(values, limit) {
  return [...new Set((Array.isArray(values) ? values : []).filter((value) => typeof value === "string"))].slice(0, limit);
}

function normalizeSummary(value) {
  if (!value || typeof value !== "object") return value;
  const normalized = structuredClone(value);
  if (normalized.workload && typeof normalized.workload === "object") {
    normalized.workload.secondary = uniqueStrings(normalized.workload.secondary, 2);
    normalized.workload.evidence = uniqueStrings(normalized.workload.evidence, 8);
  }
  if (Array.isArray(normalized.failures)) {
    normalized.failures = normalized.failures.map((failure) => ({
      ...failure,
      evidence: uniqueStrings(failure?.evidence, 8),
    }));
  }
  if (normalized.outcome && typeof normalized.outcome === "object") {
    normalized.outcome.evidence = uniqueStrings(normalized.outcome.evidence, 8);
    if (typeof normalized.outcome.unmetGoal === "string") {
      normalized.outcome.unmetGoal = normalized.outcome.unmetGoal.slice(0, 160);
    }
  }
  return normalized;
}

export async function checkOllama() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.featureExtractorTimeoutMs, 5_000));
  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw ollamaError(`Ollama health returned ${response.status}`, "ollama_unavailable");
    const payload = await response.json();
    const models = (payload.models || []).map((model) => model.name || model.model);
    const configured = config.featureExtractorModel;
    const available = models.some((model) => model === configured || model?.startsWith(`${configured}:`) || configured.startsWith(`${model}:`));
    return { reachable: true, modelAvailable: available, models };
  } catch (error) {
    if (error.code === "ollama_unavailable") throw error;
    throw ollamaError(error.name === "AbortError" ? "Ollama health check timed out" : `Ollama unavailable: ${error.message}`, "ollama_unavailable", error);
  } finally {
    clearTimeout(timeout);
  }
}

export async function extractSemanticFeatures(input) {
  const started = Date.now();
  const ambiguousTools = input.actionCandidates || (input.tools || []).filter((tool) => tool.needsSemanticAction);
  const actions = [];
  const calls = [];
  const actionChunks = [];
  for (const tool of ambiguousTools) {
    let current = actionChunks.at(-1);
    if (!current || current.length >= 20 || JSON.stringify({ tools: [...current, tool] }).length > 12_000) {
      current = [];
      actionChunks.push(current);
    }
    current.push(tool);
  }
  for (const tools of actionChunks) {
    const result = await postStructured(
      actionBatchSchemaFor(tools),
      `Classify these tool items:\n${JSON.stringify({ tools })}`,
      ACTION_PROMPT,
    );
    const permitted = new Set(tools.map((tool) => tool.evidence));
    actions.push(...result.value.actions.filter((action) => permitted.has(action.source)));
    calls.push(result);
  }

  const { actionCandidates: _actionCandidates, ...summarySource } = input;
  const summaryInput = {
    ...summarySource,
    tools: (input.tools || []).map(({ needsSemanticAction: _ignored, ...tool }) => tool),
  };
  const summary = await postStructured(
    summarySchemaFor(summaryInput),
    `Classify this reduced turn. The schema is authoritative.\n${JSON.stringify(summaryInput)}`,
    SYSTEM_PROMPT,
    normalizeSummary,
  );
  calls.push(summary);
  const permittedFailures = new Set((input.failures || []).map((failure) => failure.ordinal));
  const failures = summary.value.failures.filter((failure) => permittedFailures.has(failure.source));
  const semantic = SemanticExtensionSchema.parse({ ...summary.value, failures, actions });
  return {
    semantic,
    metadata: {
      durationMs: Date.now() - started,
      promptTokens: calls.reduce((sum, call) => sum + call.promptTokens, 0),
      outputTokens: calls.reduce((sum, call) => sum + call.outputTokens, 0),
      repairAttempts: calls.reduce((sum, call) => sum + call.repairAttempts, 0),
      callCount: calls.length,
      model: summary.model || config.featureExtractorModel,
    },
  };
}
