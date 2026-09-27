import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "./config.js";

function repoId(repoPath) {
  return crypto.createHash("sha256").update(repoPath).digest("hex").slice(0, 16);
}

function rootId(rootPath) {
  return crypto.createHash("sha256").update(`root:${rootPath}`).digest("hex").slice(0, 16);
}

export function listRepositoryRoots() {
  return config.repoRoots.flatMap((configuredPath) => {
    try {
      const rootPath = fs.realpathSync(configuredPath);
      return [{ id: rootId(rootPath), name: path.basename(rootPath), path: rootPath }];
    } catch {
      return [];
    }
  });
}

function isGitRepo(candidate) {
  return fs.existsSync(path.join(candidate, ".git"));
}

function walk(root, depth, found) {
  let canonical;
  try {
    canonical = fs.realpathSync(root);
  } catch {
    return;
  }
  if (isGitRepo(canonical)) {
    found.add(canonical);
  }
  if (depth <= 0) return;
  let entries = [];
  try {
    entries = fs.readdirSync(canonical, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || ["node_modules", "vendor", "dist", "build"].includes(entry.name)) continue;
    walk(path.join(canonical, entry.name), depth - 1, found);
  }
}

export function listRepositories() {
  const found = new Set();
  for (const root of config.repoRoots) walk(root, 2, found);
  return [...found]
    .map((repoPath) => ({ id: repoId(repoPath), name: path.basename(repoPath), path: repoPath }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getRepository(id) {
  return listRepositories().find((repo) => repo.id === id) || null;
}

export function createRepository(rootIdentifier, requestedName) {
  const root = listRepositoryRoots().find((item) => item.id === rootIdentifier);
  if (!root) throw Object.assign(new Error("Repository root is not allowed"), { status: 400, code: "repository_root_not_allowed" });
  const name = String(requestedName || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,63}$/.test(name) || name === "." || name === "..") {
    throw Object.assign(new Error("Use a name of 1–64 letters, numbers, spaces, dots, dashes, or underscores"), { status: 400, code: "invalid_repository_name" });
  }
  const destination = path.resolve(root.path, name);
  if (!destination.startsWith(`${root.path}${path.sep}`)) {
    throw Object.assign(new Error("Repository path is outside the configured root"), { status: 400, code: "repository_path_not_allowed" });
  }
  if (fs.existsSync(destination)) {
    throw Object.assign(new Error("A file or directory with that name already exists"), { status: 409, code: "repository_exists" });
  }
  fs.mkdirSync(destination, { recursive: false });
  try {
    execFileSync("git", ["init", "--initial-branch=main", destination], { encoding: "utf8", timeout: 10_000 });
    fs.writeFileSync(path.join(destination, "README.md"), `# ${name}\n\nCreated with BudgetSight.\n`);
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw Object.assign(new Error(`Could not initialize repository: ${error.message}`), { status: 500, code: "repository_create_failed" });
  }
  return { id: repoId(fs.realpathSync(destination)), name, path: fs.realpathSync(destination) };
}

function git(repoPath, args) {
  try {
    return execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    return null;
  }
}

export function repositorySnapshot(repoPath) {
  const status = git(repoPath, ["status", "--porcelain=v1", "--branch"]);
  const remote = git(repoPath, ["remote", "get-url", "origin"]);
  return {
    path: repoPath,
    branch: git(repoPath, ["branch", "--show-current"]),
    commit: git(repoPath, ["rev-parse", "HEAD"]),
    remote: remote?.replace(/\/\/[^/@]+@/, "//[redacted]@") || null,
    dirty: Boolean(status && status.split("\n").some((line) => !line.startsWith("##"))),
    status,
    capturedAt: new Date().toISOString(),
  };
}
