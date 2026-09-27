import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { config } from "./config.js";

export function sanitizedExecutorEnvironment(source = process.env) {
  const allowed = ["PATH", "HOME", "CODEX_HOME", "TMPDIR", "LANG", "LC_ALL", "TERM"];
  const environment = Object.fromEntries(allowed.filter((key) => source[key]).map((key) => [key, source[key]]));
  const dependencies = path.resolve(
    source.CODEX_RUNTIME_DEPENDENCIES
      || path.join(source.HOME || os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies"),
  );
  const executablePaths = [
    path.join(dependencies, "bin", "override"),
    path.join(dependencies, "python", "bin"),
  ].filter((target) => fs.existsSync(target));
  if (executablePaths.length) environment.PATH = [...executablePaths, environment.PATH].filter(Boolean).join(path.delimiter);
  const nodeModules = path.join(dependencies, "node", "node_modules");
  if (fs.existsSync(nodeModules)) environment.NODE_PATH = nodeModules;
  return environment;
}

class CodexAppServerClient {
  constructor() {
    this.child = null;
    this.readyPromise = null;
    this.pending = new Map();
    this.listeners = new Set();
    this.nextId = 1;
    this.lastError = null;
  }

  status() {
    return {
      running: Boolean(this.child && !this.child.killed),
      ready: Boolean(this.child && this.readyPromise && !this.lastError),
      pid: this.child?.pid || null,
      error: this.lastError?.message || null,
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message) {
    for (const listener of this.listeners) {
      Promise.resolve(listener(message)).catch((error) => {
        console.error("Codex app-server event handler failed", error);
      });
    }
  }

  sanitizedEnvironment() {
    return sanitizedExecutorEnvironment();
  }

  async start() {
    if (this.child && !this.child.killed && this.readyPromise) return this.readyPromise;
    this.lastError = null;
    this.child = spawn(config.codexExecutable, ["app-server", "--stdio"], {
      cwd: config.projectRoot,
      env: this.sanitizedEnvironment(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const child = this.child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => {
      const text = String(chunk).trim();
      if (text) this.emit({ method: "budgetsight/appServer/stderr", params: { text: text.slice(-20_000) } });
    });
    child.on("error", (error) => this.handleExit(error));
    child.on("exit", (code, signal) => this.handleExit(new Error(`Codex app-server exited (${code ?? signal})`)));

    this.readyPromise = (async () => {
      await this.rawRequest("initialize", {
        clientInfo: { name: "budgetsight", title: "BudgetSight", version: "0.2.0" },
      });
      this.notify("initialized", {});
      return this;
    })();
    return this.readyPromise;
  }

  handleExit(error) {
    if (this.lastError) return;
    this.lastError = error;
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    this.emit({ method: "budgetsight/appServer/exited", params: { message: error.message } });
    this.child = null;
    this.readyPromise = null;
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit({ method: "budgetsight/appServer/invalidJson", params: { line: line.slice(0, 2_000) } });
      return;
    }
    if (message.id != null && !message.method) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      if (message.error) {
        const error = new Error(message.error.message || "Codex app-server request failed");
        Object.assign(error, { code: "codex_app_server_error", detail: message.error });
        pending.reject(error);
      } else pending.resolve(message.result);
      return;
    }
    if (message.id != null && message.method) {
      this.emit(message);
      const decisionMethods = new Set([
        "item/commandExecution/requestApproval",
        "item/fileChange/requestApproval",
        "item/permissions/requestApproval",
      ]);
      const result = decisionMethods.has(message.method) ? { decision: "decline" } : {};
      this.write({ id: message.id, result });
      return;
    }
    this.emit(message);
  }

  write(message) {
    if (!this.child?.stdin?.writable) throw new Error("Codex app-server is not running");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  rawRequest(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(String(id), { resolve, reject });
      this.write({ method, id, params });
    });
  }

  async request(method, params = {}) {
    await this.start();
    return this.rawRequest(method, params);
  }

  notify(method, params = {}) {
    this.write({ method, params });
  }

  async startThread({ cwd, model, title }) {
    const result = await this.request("thread/start", {
      cwd,
      model,
      sandbox: "workspace-write",
      approvalPolicy: "never",
      approvalsReviewer: "auto_review",
      serviceTier: "default",
    });
    if (title && result.thread?.id) {
      await this.request("thread/name/set", { threadId: result.thread.id, name: title }).catch(() => null);
    }
    return result.thread;
  }

  startTurn(threadId, input, options = {}) {
    return this.request("turn/start", {
      threadId,
      input,
      cwd: options.cwd,
      model: options.model,
      effort: options.effort || "medium",
      approvalPolicy: "never",
      serviceTierForTurn: "default",
    });
  }

  steerTurn(threadId, turnId, input) {
    return this.request("turn/steer", { threadId, expectedTurnId: turnId, input });
  }

  interruptTurn(threadId, turnId) {
    return this.request("turn/interrupt", { threadId, turnId });
  }

  readThread(threadId, includeTurns = true) {
    return this.request("thread/read", { threadId, includeTurns });
  }

  readAccount() {
    return this.request("account/read", { refreshToken: false });
  }

  readRateLimits() {
    return this.request("account/rateLimits/read", {});
  }
}

export const codexAppServer = new CodexAppServerClient();
