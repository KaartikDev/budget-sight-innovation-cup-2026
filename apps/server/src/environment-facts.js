import os from "node:os";
import { execFileSync } from "node:child_process";

let cachedHostFacts = null;

function hostFacts() {
  if (cachedHostFacts) return cachedHostFacts;
  let hardwareModel = null;
  let chip = os.cpus()?.[0]?.model || null;
  if (process.platform === "darwin") {
    try {
      hardwareModel = execFileSync("sysctl", ["-n", "hw.model"], {
        encoding: "utf8",
        timeout: 1_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || null;
    } catch {}
    try {
      chip = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], {
        encoding: "utf8",
        timeout: 1_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || chip;
    } catch {}
  }
  cachedHostFacts = {
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    architecture: os.arch(),
    hardwareModel,
    chip,
    memoryBytes: os.totalmem(),
  };
  return cachedHostFacts;
}

export function captureEnvironmentFacts({
  runtimeProvider = "codex_app_server",
  sandboxMode = "workspace-write",
  workspaceRoot = null,
  workingDirectory = null,
} = {}) {
  return {
    ...hostFacts(),
    runtimeProvider,
    sandboxMode,
    workspaceRoot,
    workingDirectory,
  };
}
