import "dotenv/config";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDir, "../../..");

function splitPaths(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function isExecutable(target) {
  try {
    fs.accessSync(target, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCodexExecutable(value = process.env.CODEX_EXECUTABLE, environment = process.env) {
  const configured = String(value || "codex").trim();
  if (configured.includes(path.sep)) return path.resolve(configured);

  for (const directory of String(environment.PATH || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, configured);
    if (isExecutable(candidate)) return candidate;
  }

  if (configured === "codex" && process.platform === "darwin") {
    const relative = "ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
    for (const candidate of [path.join("/Applications", relative), path.join(os.homedir(), "Applications", relative)]) {
      if (isExecutable(candidate)) return candidate;
    }
  }

  return configured;
}

export const config = Object.freeze({
  projectRoot,
  port: Number(process.env.PORT || 4310),
  webOrigin: process.env.WEB_ORIGIN || "http://localhost:5173",
  sessionSecret: process.env.SESSION_SECRET || "local-development-only-change-me",
  dataDir: path.resolve(projectRoot, process.env.DATA_DIR || "data"),
  reportingDbPath: path.resolve(projectRoot, process.env.REPORTING_DB_PATH || path.join(process.env.DATA_DIR || "data", "reporting.db")),
  repoRoots: splitPaths(process.env.REPO_ROOTS || projectRoot),
  codexExecutable: resolveCodexExecutable(),
  featureExtractionEnabled: process.env.FEATURE_EXTRACTION_ENABLED !== "false",
  ollamaBaseUrl: String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
  featureExtractorModel: process.env.FEATURE_EXTRACTOR_MODEL || "qwen3:4b-instruct",
  featureExtractorTimeoutMs: Number(process.env.FEATURE_EXTRACTOR_TIMEOUT_MS || 30_000),
  featureExtractionLogPath: path.resolve(projectRoot, process.env.FEATURE_EXTRACTION_LOG_PATH || path.join(process.env.DATA_DIR || "data", "feature-extraction.log")),
  isProduction: process.env.NODE_ENV === "production",
});

export function configurationStatus() {
  return {
    runtime: "codex_app_server",
    sessionSecretIsDefault: config.sessionSecret === "local-development-only-change-me",
    repoRoots: config.repoRoots,
    featureExtraction: {
      enabled: config.featureExtractionEnabled,
      model: config.featureExtractorModel,
      reportingDbPath: config.reportingDbPath,
      logPath: config.featureExtractionLogPath,
    },
  };
}
