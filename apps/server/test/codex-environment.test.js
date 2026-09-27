import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sanitizedExecutorEnvironment } from "../src/codex-app-server.js";
import { resolveCodexExecutable } from "../src/config.js";

test("resolves the Codex executable from PATH", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "budgetsight-codex-"));
  const executable = path.join(root, "codex");
  fs.writeFileSync(executable, "#!/bin/sh\n");
  fs.chmodSync(executable, 0o755);

  assert.equal(resolveCodexExecutable("codex", { PATH: root }), executable);
});

test("preserves an explicit Codex executable path", () => {
  assert.equal(resolveCodexExecutable("/custom/bin/codex", { PATH: "" }), "/custom/bin/codex");
});

test("adds bundled tools without inheriting host secrets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "budgetsight-runtime-"));
  const override = path.join(root, "bin", "override");
  const python = path.join(root, "python", "bin");
  const nodeModules = path.join(root, "node", "node_modules");
  fs.mkdirSync(override, { recursive: true });
  fs.mkdirSync(python, { recursive: true });
  fs.mkdirSync(nodeModules, { recursive: true });

  const environment = sanitizedExecutorEnvironment({
    PATH: "/usr/bin",
    HOME: "/safe/home",
    CODEX_RUNTIME_DEPENDENCIES: root,
    OPENAI_API_KEY: "must-not-leak",
    PRIVATE_TOKEN: "must-not-leak",
  });

  assert.equal(environment.PATH, [override, python, "/usr/bin"].join(path.delimiter));
  assert.equal(environment.NODE_PATH, nodeModules);
  assert.equal(environment.HOME, "/safe/home");
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.PRIVATE_TOKEN, undefined);
});

test("falls back to the original path when no bundled runtime exists", () => {
  const environment = sanitizedExecutorEnvironment({
    PATH: "/usr/bin",
    HOME: "/safe/home",
    CODEX_RUNTIME_DEPENDENCIES: path.join(os.tmpdir(), "missing-budgetsight-runtime"),
  });

  assert.equal(environment.PATH, "/usr/bin");
  assert.equal(environment.NODE_PATH, undefined);
});
