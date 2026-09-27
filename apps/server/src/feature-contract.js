import { z } from "zod";

export const ROW_SCHEMA_VERSION = "budgetsight.turn-feature.v2";
export const EXTRACTOR_VERSION = "turn-feature-extractor.v2";
export const TAXONOMY_VERSION = "light-semantic.v2";
export const PROMPT_VERSION = "light-semantic.prompt.v2";

export const WORKLOAD_LABELS = [
  "code_generation",
  "debugging",
  "testing",
  "repo_exploration",
  "web_research",
  "artifact_generation",
  "environment_setup",
  "deployment_operations",
  "analysis_planning",
  "other",
  "unknown",
];

export const ACTION_LABELS = [
  "repo_exploration",
  "code_search",
  "file_reading",
  "code_editing",
  "test_validation",
  "command_execution",
  "environment_inspection",
  "dependency_setup",
  "web_searching",
  "version_control",
  "artifact_inspection",
  "other",
];

export const FAILURE_STATES = [
  "benign_expected",
  "recovered",
  "blocking",
  "unresolved",
  "unknown",
];

export const OUTCOME_STATUSES = ["completed", "partial_completion", "failed", "unknown"];
export const VALIDATION_STATES = ["passed", "failed", "attempted", "none", "unknown"];
export const CONFIDENCE_LEVELS = ["high", "medium", "low"];
const Evidence = z.string().max(80);
const Confidence = z.enum(CONFIDENCE_LEVELS);

export const WorkloadSchema = z.object({
  primary: z.enum(WORKLOAD_LABELS),
  secondary: z.array(z.enum(WORKLOAD_LABELS)).max(2),
  confidence: Confidence,
  evidence: z.array(Evidence).max(8),
}).strict();

export const SemanticActionSchema = z.object({
  source: z.string().regex(/^tool_\d+$/),
  label: z.enum(ACTION_LABELS),
  confidence: Confidence,
}).strict();

export const SemanticFailureSchema = z.object({
  source: z.string().regex(/^failure_\d+$/),
  state: z.enum(FAILURE_STATES),
  confidence: Confidence,
  evidence: z.array(Evidence).max(8),
}).strict();

export const SemanticOutcomeSchema = z.object({
  status: z.enum(OUTCOME_STATUSES),
  validation: z.enum(VALIDATION_STATES),
  unmetGoal: z.string().max(160).nullable(),
  confidence: Confidence,
  evidence: z.array(Evidence).max(8),
}).strict();

export const ToolIntentObservationSchema = z.object({
  mostRepeatedToolIntent: z.enum([...ACTION_LABELS, "none"]),
  toolCallCount: z.number().int().nonnegative(),
  isRepeated: z.boolean(),
  confidence: Confidence,
  evidence: z.array(Evidence).max(8),
}).strict();

export const SemanticSummarySchema = z.object({
  workload: WorkloadSchema,
  failures: z.array(SemanticFailureSchema),
  outcome: SemanticOutcomeSchema,
}).strict();

export const SemanticActionBatchSchema = z.object({
  actions: z.array(SemanticActionSchema).max(20),
}).strict();

export const SemanticExtensionSchema = SemanticSummarySchema.extend({
  actions: z.array(SemanticActionSchema),
}).strict();

export const TurnSemanticSchema = SemanticExtensionSchema.extend({
  observations: ToolIntentObservationSchema,
}).strict();

export function deriveToolIntentObservation(actions = []) {
  if (!actions.length) {
    return {
      mostRepeatedToolIntent: "none",
      toolCallCount: 0,
      isRepeated: false,
      confidence: "low",
      evidence: [],
    };
  }
  const counts = new Map(ACTION_LABELS.map((label) => [label, 0]));
  for (const action of actions) counts.set(action.label, (counts.get(action.label) || 0) + 1);
  const mostRepeatedToolIntent = ACTION_LABELS.reduce((best, label) => (
    (counts.get(label) || 0) > (counts.get(best) || 0) ? label : best
  ), ACTION_LABELS[0]);
  const matching = actions.filter((action) => action.label === mostRepeatedToolIntent);
  const confidences = matching.map((action) => action.confidence);
  const confidence = confidences.every((value) => value === "high")
    ? "high"
    : confidences.some((value) => value === "low") ? "low" : "medium";
  return {
    mostRepeatedToolIntent,
    toolCallCount: matching.length,
    isRepeated: matching.length > 1,
    confidence,
    evidence: matching.map((action) => action.source).slice(0, 8),
  };
}

export function unknownSemantics(tools = [], failures = []) {
  const actions = tools.map((tool) => ({
    source: tool.ordinal,
    label: tool.intent?.label || "other",
    confidence: tool.intent?.confidence || "low",
  }));
  return {
    workload: { primary: "unknown", secondary: [], confidence: "low", evidence: [] },
    actions,
    failures: failures.map((failure) => ({
      source: failure.ordinal,
      state: "unknown",
      confidence: "low",
      evidence: [failure.toolOrdinal].filter(Boolean),
    })),
    outcome: { status: "unknown", validation: "unknown", unmetGoal: null, confidence: "low", evidence: [] },
    observations: deriveToolIntentObservation(actions),
  };
}

const NullableString = z.string().nullable();
const NullableNumber = z.number().nullable();
const CountRecord = z.record(z.string(), z.number().int().nonnegative());

const EnvironmentSchema = z.object({
  key: z.string().min(1),
  hostname: z.string(),
  platform: z.string(),
  release: z.string(),
  architecture: z.string(),
  hardwareModel: NullableString,
  chip: NullableString,
  memoryBytes: z.number().int().nonnegative(),
  runtimeProvider: z.string(),
  sandboxMode: z.string(),
  workspaceRoot: NullableString,
  workingDirectory: NullableString,
}).strict();

const RepositorySchema = z.object({
  id: NullableString,
  name: NullableString,
  path: NullableString,
  remote: NullableString,
  remoteBefore: NullableString,
  remoteAfter: NullableString,
  branchBefore: NullableString,
  branchAfter: NullableString,
  commitBefore: NullableString,
  commitAfter: NullableString,
  dirtyBefore: z.boolean().nullable(),
  dirtyAfter: z.boolean().nullable(),
  agentsFiles: z.array(z.object({
    path: z.string(),
    read: z.boolean(),
    sha256: NullableString,
  }).strict()),
}).strict();

const UsageSchema = z.object({
  inputTokens: NullableNumber,
  cachedInputTokens: NullableNumber,
  cacheWriteInputTokens: NullableNumber,
  outputTokens: NullableNumber,
  reasoningTokens: NullableNumber,
  totalTokens: NullableNumber,
  estimatedTokenCostMicros: NullableNumber,
  estimatedToolCostMicros: z.number().int().nonnegative(),
  estimatedCostMicros: NullableNumber,
  webSearchCalls: z.number().int().nonnegative(),
  fileSearchCalls: z.number().int().nonnegative(),
}).strict();

const FileSchema = z.object({
  path: z.string(),
  reads: z.number().int().nonnegative(),
  adds: z.number().int().nonnegative(),
  updates: z.number().int().nonnegative(),
  deletes: z.number().int().nonnegative(),
  moves: z.number().int().nonnegative(),
  linesAdded: z.number().int().nonnegative(),
  linesDeleted: z.number().int().nonnegative(),
  firstModificationTool: z.string().regex(/^tool_\d+$/).optional(),
  lastModificationTool: z.string().regex(/^tool_\d+$/).optional(),
  extension: NullableString,
}).strict();

const ToolSchema = z.object({
  ordinal: z.string().regex(/^tool_\d+$/),
  eventSeq: z.number().int().positive(),
  itemType: z.string(),
  toolName: z.string(),
  commandActionTypes: z.array(z.string()),
  targets: z.array(z.string()),
  inputHash: z.string(),
  outputHash: NullableString,
  outputBytes: z.number().int().nonnegative(),
  status: z.string(),
  exitCode: NullableNumber,
  durationMs: NullableNumber,
  effect: z.enum(["read", "write", "process", "network", "mixed", "unknown"]),
  billableKind: z.enum(["webSearch", "fileSearch"]).nullable(),
  intent: z.object({
    label: z.enum(ACTION_LABELS),
    confidence: Confidence,
    source: z.literal("deterministic"),
  }).strict(),
}).strict();

const DeterministicFailureSchema = z.object({
  ordinal: z.string().regex(/^failure_\d+$/),
  toolOrdinal: z.string().regex(/^tool_\d+$/),
  category: z.string(),
  subject: NullableString,
  fingerprint: z.string(),
  exitCode: NullableNumber,
  outputHash: NullableString,
}).strict();

export const TurnFeatureRowSchema = z.object({
  identity: z.object({
    schemaVersion: z.literal(ROW_SCHEMA_VERSION),
    extractorVersion: z.literal(EXTRACTOR_VERSION),
    taxonomyVersion: z.literal(TAXONOMY_VERSION),
    promptVersion: z.literal(PROMPT_VERSION),
    taskId: z.string(),
    threadId: NullableString,
    turnId: z.string(),
    sourceHash: z.string(),
  }).strict(),
  actor: z.object({ id: z.string(), name: z.string(), role: z.string() }).strict(),
  thread: z.object({
    title: z.string(),
    model: z.string(),
    runtimeProvider: z.string(),
    runtimeStatus: z.string(),
    taskStatus: z.string(),
    errorReason: NullableString,
  }).strict(),
  environment: EnvironmentSchema,
  repository: RepositorySchema,
  timing: z.object({
    startedAt: NullableString,
    completedAt: NullableString,
    durationMs: NullableNumber,
  }).strict(),
  usage: UsageSchema,
  conversation: z.object({
    userMessageCount: z.number().int().nonnegative(),
    assistantMessageCount: z.number().int().nonnegative(),
    userCharacterCount: z.number().int().nonnegative(),
    assistantCharacterCount: z.number().int().nonnegative(),
    messageHashes: z.array(z.object({ ordinal: z.string().regex(/^message_\d+$/), role: z.enum(["user", "assistant"]), sha256: z.string() }).strict()),
    attachments: z.array(z.object({ path: z.string(), sizeBytes: z.number().int().nonnegative(), sha256: z.string(), mimeType: NullableString }).strict()),
    attachmentCount: z.number().int().nonnegative(),
  }).strict(),
  metrics: z.object({
    toolCount: z.number().int().nonnegative(),
    toolCountsByType: CountRecord,
    toolCountsByStatus: CountRecord,
    commandCount: z.number().int().nonnegative(),
    failedCommandCount: z.number().int().nonnegative(),
    cancelledToolCount: z.number().int().nonnegative(),
    timeoutCount: z.number().int().nonnegative(),
    approvalCount: z.number().int().nonnegative(),
    exactRepeatedCommandCount: z.number().int().nonnegative(),
    environmentInspectionCount: z.number().int().nonnegative(),
    dependencyInstallAttemptCount: z.number().int().nonnegative(),
    changedFileCount: z.number().int().nonnegative(),
    uniqueFileReadCount: z.number().int().nonnegative(),
    addedFileCount: z.number().int().nonnegative(),
    updatedFileCount: z.number().int().nonnegative(),
    deletedFileCount: z.number().int().nonnegative(),
    movedFileCount: z.number().int().nonnegative(),
    linesAdded: z.number().int().nonnegative(),
    linesDeleted: z.number().int().nonnegative(),
    fileExtensions: CountRecord,
    outputBytes: z.number().int().nonnegative(),
    firstModificationTool: z.string().regex(/^tool_\d+$/).nullable(),
    lastModificationTool: z.string().regex(/^tool_\d+$/).nullable(),
    validationAfterLastModification: z.boolean(),
    validationActionsAfterLastModification: z.array(z.string().regex(/^tool_\d+$/)),
    deliverablePaths: z.array(z.string()),
    deliverableExtensions: z.array(z.string()),
  }).strict(),
  files: z.array(FileSchema),
  tools: z.array(ToolSchema),
  deterministicFailures: z.array(DeterministicFailureSchema),
  semantic: TurnSemanticSchema,
  quality: z.object({
    sourceEventCount: z.number().int().nonnegative(),
    sourceComplete: z.boolean(),
    usageAvailable: z.boolean(),
    repositoryBeforeAvailable: z.boolean(),
    repositoryAfterAvailable: z.boolean(),
    semanticInputTruncated: z.boolean(),
    semanticInputSummaryChars: z.number().int().nonnegative(),
    semanticMessagesSent: z.number().int().nonnegative(),
    semanticToolsSent: z.number().int().nonnegative(),
    semanticFailuresSent: z.number().int().nonnegative(),
    semanticActionCandidates: z.number().int().nonnegative(),
  }).strict(),
  extraction: z.object({
    model: z.string(),
    semanticStatus: z.enum(["pending", "ready", "failed"]),
    attempt: z.number().int().nonnegative(),
    durationMs: NullableNumber,
    promptTokens: NullableNumber,
    outputTokens: NullableNumber,
    repairAttempts: z.number().int().nonnegative().optional(),
    semanticCallCount: z.number().int().positive().optional(),
  }).strict(),
}).strict();
