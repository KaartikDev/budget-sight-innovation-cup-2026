import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { db, now } from "./db.js";
import { EXTRACTOR_VERSION } from "./feature-contract.js";
import { appendReportingRow } from "./reporting-db.js";
import { buildTurnFeatureRow, mergeSemanticExtension } from "./feature-builder.js";
import { checkOllama, extractSemanticFeatures } from "./ollama-feature-extractor.js";

const worker = {
  started: false,
  busy: false,
  timer: null,
  lastError: null,
  lastCompletedAt: null,
  ollamaUnavailableUntil: null,
  ollama: { checkedAt: null, reachable: null, modelAvailable: null },
};

const RETRY_DELAYS_MS = [5_000, 30_000, 5 * 60_000];

fs.mkdirSync(path.dirname(config.featureExtractionLogPath), { recursive: true });
fs.closeSync(fs.openSync(config.featureExtractionLogPath, "a", 0o600));

function isoAfter(delayMs) {
  return new Date(Date.now() + delayMs).toISOString();
}

function safeErrorMessage(error) {
  return String(error?.message || error || "Unknown extraction failure").slice(0, 1_000);
}

function logExtraction(level, event, values) {
  const output = JSON.stringify({ level, event, at: now(), ...values });
  try {
    fs.appendFileSync(config.featureExtractionLogPath, `${output}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    console.error(`[feature-extraction] could not write ${config.featureExtractionLogPath}: ${safeErrorMessage(error)}`);
  }
}

export function enqueueTurnExtraction(taskId, turnId, options = {}) {
  if (!taskId || !turnId) return null;
  const createdAt = now();
  const delayMs = options.delayMs ?? 2_000;
  db.prepare(`
    INSERT INTO feature_extraction_jobs(
      task_id,turn_id,extractor_version,idempotency_key,state,attempt_count,available_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(turn_id,extractor_version) DO UPDATE SET
      state=CASE
        WHEN ? THEN 'queued'
        ELSE feature_extraction_jobs.state
      END,
      available_at=CASE WHEN ? THEN excluded.available_at ELSE feature_extraction_jobs.available_at END,
      last_error_code=CASE WHEN ? THEN NULL ELSE feature_extraction_jobs.last_error_code END,
      last_error_message=CASE WHEN ? THEN NULL ELSE feature_extraction_jobs.last_error_message END,
      updated_at=excluded.updated_at
  `).run(
    taskId,
    turnId,
    EXTRACTOR_VERSION,
    `${turnId}:pending:${EXTRACTOR_VERSION}`,
    "queued",
    0,
    isoAfter(delayMs),
    createdAt,
    createdAt,
    options.force ? 1 : 0,
    options.force ? 1 : 0,
    options.force ? 1 : 0,
    options.force ? 1 : 0,
  );
  if (options.force) {
    db.prepare(`
      UPDATE feature_extraction_jobs SET attempt_count=0,source_hash=NULL,idempotency_key=?,locked_at=NULL
      WHERE turn_id=? AND extractor_version=?
    `).run(`${turnId}:pending:${EXTRACTOR_VERSION}`, turnId, EXTRACTOR_VERSION);
    logExtraction("info", "manual_retry_queued", { taskId, turnId, extractorVersion: EXTRACTOR_VERSION });
  }
  const job = db.prepare("SELECT * FROM feature_extraction_jobs WHERE turn_id=? AND extractor_version=?")
    .get(turnId, EXTRACTOR_VERSION);
  db.prepare("UPDATE task_turns SET extraction_state=?,updated_at=? WHERE turn_id=?")
    .run(job.state, createdAt, turnId);
  return job;
}

function recordRun(job, values) {
  db.prepare(`
    INSERT INTO feature_extraction_runs(
      job_id,task_id,turn_id,extractor_version,source_hash,model,status,input_truncated,
      prompt_tokens,output_tokens,duration_ms,error_code,error_message,created_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    job.id,
    job.task_id,
    job.turn_id,
    job.extractor_version,
    values.sourceHash || null,
    values.model || config.featureExtractorModel,
    values.status,
    values.inputTruncated ? 1 : 0,
    values.promptTokens ?? null,
    values.outputTokens ?? null,
    values.durationMs ?? null,
    values.errorCode || null,
    values.errorMessage || null,
    now(),
  );
}

function nextJob() {
  return db.prepare(`
    SELECT * FROM feature_extraction_jobs
    WHERE extractor_version=? AND state IN ('queued','waiting_for_ollama') AND available_at<=?
    ORDER BY available_at,id LIMIT 1
  `).get(EXTRACTOR_VERSION, now());
}

function finishJob(job, sourceHash) {
  const timestamp = now();
  db.prepare(`
    UPDATE feature_extraction_jobs SET state='succeeded',source_hash=?,locked_at=NULL,
      last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?
  `).run(sourceHash, timestamp, job.id);
  db.prepare("UPDATE task_turns SET extraction_state='succeeded',updated_at=? WHERE turn_id=?")
    .run(timestamp, job.turn_id);
  worker.lastCompletedAt = timestamp;
  worker.lastError = null;
  worker.ollamaUnavailableUntil = null;
  worker.ollama = { reachable: true, modelAvailable: true, checkedAt: timestamp };
  logExtraction("info", "succeeded", {
    taskId: job.task_id,
    turnId: job.turn_id,
    extractorVersion: job.extractor_version,
    attempt: Number(job.attempt_count || 0) + 1,
  });
}

function deferJob(job, error) {
  const unavailable = ["ollama_unavailable", "ollama_model_missing"].includes(error.code);
  const attempts = Number(job.attempt_count || 0) + 1;
  if (unavailable) {
    if (!worker.ollamaUnavailableUntil || Date.parse(worker.ollamaUnavailableUntil) <= Date.now()) {
      worker.ollamaUnavailableUntil = isoAfter(30_000);
    }
    db.prepare(`
      UPDATE feature_extraction_jobs SET state='waiting_for_ollama',attempt_count=?,available_at=?,
        locked_at=NULL,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?
    `).run(attempts, isoAfter(30_000), error.code, safeErrorMessage(error), now(), job.id);
    worker.ollama = {
      reachable: error.code === "ollama_model_missing",
      modelAvailable: false,
      checkedAt: now(),
      error: safeErrorMessage(error),
    };
  } else if (attempts <= RETRY_DELAYS_MS.length) {
    db.prepare(`
      UPDATE feature_extraction_jobs SET state='queued',attempt_count=?,available_at=?,locked_at=NULL,
        last_error_code=?,last_error_message=?,updated_at=? WHERE id=?
    `).run(attempts, isoAfter(RETRY_DELAYS_MS[attempts - 1]), error.code || "extraction_failed", safeErrorMessage(error), now(), job.id);
  } else {
    db.prepare(`
      UPDATE feature_extraction_jobs SET state='failed',attempt_count=?,locked_at=NULL,
        last_error_code=?,last_error_message=?,updated_at=? WHERE id=?
    `).run(attempts, error.code || "extraction_failed", safeErrorMessage(error), now(), job.id);
  }
  const state = db.prepare("SELECT state FROM feature_extraction_jobs WHERE id=?").get(job.id)?.state || "failed";
  db.prepare("UPDATE task_turns SET extraction_state=?,updated_at=? WHERE turn_id=?")
    .run(state, now(), job.turn_id);
  worker.lastError = { code: error.code || "extraction_failed", message: safeErrorMessage(error), at: now() };
  logExtraction("error", "failed", {
    taskId: job.task_id,
    turnId: job.turn_id,
    extractorVersion: job.extractor_version,
    state,
    attempt: attempts,
    errorCode: error.code || "extraction_failed",
    errorMessage: safeErrorMessage(error),
  });
  return { unavailable, attempts };
}

export function retryTurnExtraction(turnId) {
  const turn = db.prepare("SELECT task_id,status,completed_at FROM task_turns WHERE turn_id=?").get(turnId);
  if (!turn) return null;
  if (!turn.completed_at) {
    throw Object.assign(new Error("Only terminal turns can be extracted"), { status: 409, code: "turn_not_terminal" });
  }
  const existing = db.prepare("SELECT state FROM feature_extraction_jobs WHERE turn_id=? AND extractor_version=?")
    .get(turnId, EXTRACTOR_VERSION);
  if (existing?.state === "succeeded") {
    throw Object.assign(new Error("This turn already has a successful extraction"), { status: 409, code: "extraction_already_succeeded" });
  }
  if (["queued", "running"].includes(existing?.state)) {
    throw Object.assign(new Error("Extraction is already in progress"), { status: 409, code: "extraction_in_progress" });
  }
  return enqueueTurnExtraction(turn.task_id, turnId, { delayMs: 0, force: true });
}

export async function processNextFeatureJob({ ignoreDisabled = false } = {}) {
  if (worker.busy || (!config.featureExtractionEnabled && !ignoreDisabled)) return null;
  const job = nextJob();
  if (!job) return null;
  worker.busy = true;
  db.prepare("UPDATE feature_extraction_jobs SET state='running',locked_at=?,updated_at=? WHERE id=?")
    .run(now(), now(), job.id);
  db.prepare("UPDATE task_turns SET extraction_state='running',updated_at=? WHERE turn_id=?")
    .run(now(), job.turn_id);
  const started = Date.now();
  let built = null;
  try {
    built = buildTurnFeatureRow(job.turn_id);
    db.prepare("UPDATE feature_extraction_jobs SET source_hash=?,idempotency_key=?,updated_at=? WHERE id=?")
      .run(built.sourceHash, `${job.turn_id}:${built.sourceHash}:${job.extractor_version}`, now(), job.id);
    appendReportingRow(built.row, { stage: "draft", semanticStatus: "pending" });
    if (worker.ollamaUnavailableUntil && Date.parse(worker.ollamaUnavailableUntil) > Date.now()) {
      throw Object.assign(new Error(`Ollama circuit is open until ${worker.ollamaUnavailableUntil}`), { code: "ollama_unavailable" });
    }
    const result = await extractSemanticFeatures(built.semanticInput);
    const finalRow = mergeSemanticExtension(built.row, result.semantic, {
      attempt: Number(job.attempt_count || 0) + 1,
      ...result.metadata,
    });
    appendReportingRow(finalRow, { stage: "final", semanticStatus: "ready" });
    finishJob(job, built.sourceHash);
    recordRun(job, {
      sourceHash: built.sourceHash,
      status: "succeeded",
      inputTruncated: built.row.quality.semanticInputTruncated,
      durationMs: Date.now() - started,
      promptTokens: result.metadata.promptTokens,
      outputTokens: result.metadata.outputTokens,
      model: result.metadata.model,
    });
    return finalRow;
  } catch (error) {
    const disposition = deferJob(job, error);
    if (!disposition.unavailable && disposition.attempts > RETRY_DELAYS_MS.length && built) {
      const degraded = structuredClone(built.row);
      degraded.extraction = {
        ...degraded.extraction,
        semanticStatus: "failed",
        attempt: disposition.attempts,
        durationMs: Date.now() - started,
      };
      appendReportingRow(degraded, { stage: "degraded", semanticStatus: "failed" });
    }
    recordRun(job, {
      sourceHash: built?.sourceHash,
      status: disposition.unavailable ? "waiting_for_ollama" : "failed",
      inputTruncated: built?.row.quality.semanticInputTruncated,
      durationMs: Date.now() - started,
      errorCode: error.code || "extraction_failed",
      errorMessage: safeErrorMessage(error),
    });
    return null;
  } finally {
    worker.busy = false;
  }
}

async function refreshOllamaStatus() {
  try {
    const status = await checkOllama();
    worker.ollama = { ...status, checkedAt: now() };
  } catch (error) {
    worker.ollama = { reachable: false, modelAvailable: false, checkedAt: now(), error: safeErrorMessage(error) };
  }
}

export function startFeatureWorker() {
  if (worker.started || !config.featureExtractionEnabled) return;
  worker.started = true;
  db.prepare(`
    UPDATE feature_extraction_jobs SET state='queued',locked_at=NULL,available_at=?,updated_at=?
    WHERE extractor_version=? AND state='running'
  `).run(now(), now(), EXTRACTOR_VERSION);
  db.prepare(`
    UPDATE task_turns SET extraction_state='queued',updated_at=?
    WHERE turn_id IN (SELECT turn_id FROM feature_extraction_jobs WHERE state='queued')
  `).run(now());
  refreshOllamaStatus();
  worker.timer = setInterval(() => {
    processNextFeatureJob().catch((error) => {
      worker.lastError = { code: error.code || "worker_error", message: safeErrorMessage(error), at: now() };
    });
  }, 1_000);
  worker.timer.unref?.();
}

export function stopFeatureWorker() {
  if (worker.timer) clearInterval(worker.timer);
  worker.timer = null;
  worker.started = false;
}

export function featureWorkerStatus() {
  const counts = Object.fromEntries(db.prepare(`
    SELECT state,COUNT(*) AS count FROM feature_extraction_jobs GROUP BY state
  `).all().map((row) => [row.state, Number(row.count)]));
  return {
    enabled: config.featureExtractionEnabled,
    started: worker.started,
    busy: worker.busy,
    model: config.featureExtractorModel,
    ollama: worker.ollama,
    jobs: {
      queued: counts.queued || 0,
      running: counts.running || 0,
      waitingForOllama: counts.waiting_for_ollama || 0,
      succeeded: counts.succeeded || 0,
      failed: counts.failed || 0,
    },
    lastCompletedAt: worker.lastCompletedAt,
    lastError: worker.lastError,
    circuitOpenUntil: worker.ollamaUnavailableUntil,
  };
}

export function enqueueFeatureBackfill(options = {}) {
  const clauses = ["tt.completed_at IS NOT NULL"];
  const values = [];
  if (options.turnId) { clauses.push("tt.turn_id=?"); values.push(options.turnId); }
  if (options.taskId) { clauses.push("tt.task_id=?"); values.push(options.taskId); }
  if (options.failedOnly) clauses.push("j.state='failed'");
  else clauses.push("(j.id IS NULL OR j.state IN ('queued','waiting_for_ollama'))");
  const limit = Math.max(1, Math.min(100_000, Number(options.limit || 10_000)));
  const rows = db.prepare(`
    SELECT tt.task_id,tt.turn_id FROM task_turns tt
    LEFT JOIN feature_extraction_jobs j ON j.turn_id=tt.turn_id AND j.extractor_version=?
    WHERE ${clauses.join(" AND ")} ORDER BY tt.started_at LIMIT ?
  `).all(EXTRACTOR_VERSION, ...values, limit);
  for (const row of rows) enqueueTurnExtraction(row.task_id, row.turn_id, { delayMs: 0, force: Boolean(options.failedOnly) });
  return rows.length;
}
