import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import bcrypt from "bcryptjs";
import request from "supertest";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "budgetsight-test-"));
const repoPath = path.join(tempRoot, "repo");
fs.mkdirSync(repoPath);
execFileSync("git", ["init", repoPath]);
process.env.DATA_DIR = path.join(tempRoot, "data");
process.env.REPO_ROOTS = tempRoot;
process.env.SESSION_SECRET = "test-secret-with-enough-entropy";

const { app } = await import("../src/app.js");
const { db, now } = await import("../src/db.js");

const userId = crypto.randomUUID();
db.prepare("INSERT INTO users(id,display_name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(
  userId,
  "Test Person",
  "test",
  await bcrypt.hash("password", 4),
  "admin",
  now(),
);

after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("health exposes app-server runtime state without secrets", async () => {
  const response = await request(app).get("/api/v1/health").expect(200);
  assert.equal(response.body.configuration.runtime, "codex_app_server");
  assert.equal(JSON.stringify(response.body).includes("test-secret"), false);
});

test("admins can create accounts while regular users cannot", async () => {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username: "test", password: "password" }).expect(200);
  const created = await agent.post("/api/v1/admin/users").send({
    name: "Morgan Lee",
    username: "morgan.lee",
    password: "Temporary!42",
    role: "user",
  }).expect(201);
  assert.equal(created.body.user.name, "Morgan Lee");
  assert.equal(created.body.user.threadCount, 0);
  await agent.post("/api/v1/admin/users").send({
    name: "Duplicate Morgan",
    username: "MORGAN.LEE",
    password: "Temporary!99",
    role: "user",
  }).expect(409);
  const listing = await agent.get("/api/v1/admin/users").expect(200);
  assert.ok(listing.body.users.some((user) => user.username === "morgan.lee"));

  const regularId = crypto.randomUUID();
  db.prepare("INSERT INTO users(id,display_name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(
    regularId, "Regular Person", "regular", await bcrypt.hash("regular-password", 4), "user", now(),
  );
  const regular = request.agent(app);
  await regular.post("/api/v1/auth/login").send({ username: "regular", password: "regular-password" }).expect(200);
  await regular.post("/api/v1/admin/users").send({
    name: "Blocked User", username: "blocked.user", password: "Temporary!42", role: "user",
  }).expect(403);
});

test("authenticated task lifecycle and complete local export", async () => {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username: "test", password: "password" }).expect(200);
  const repos = await agent.get("/api/v1/repositories").expect(200);
  assert.equal(repos.body.repositories.length, 1);
  const created = await agent.post("/api/v1/tasks").send({
    repositoryId: repos.body.repositories[0].id,
    model: "gpt-6-sol",
    budgetUsd: 1,
    title: "Audit me",
  }).expect(201);
  assert.equal(created.body.task.budget.tokenEnvelope, 100_000);
  assert.equal(created.body.task.budget.pricingBasis, "standard_api_list_price");
  assert.equal(created.body.task.budget.estimatedToolUsd, 0);
  assert.deepEqual(created.body.task.budget.toolUsage, { webSearchCalls: 0, fileSearchCalls: 0 });
  const id = created.body.task.id;
  const raised = await agent.patch(`/api/v1/tasks/${id}/budget`).send({ budgetUsd: 2 }).expect(200);
  assert.equal(raised.body.task.budget.requestedUsd, 2);
  await agent.patch(`/api/v1/tasks/${id}/budget`).send({ budgetUsd: 1 }).expect(400);
  const exported = await agent.get(`/api/v1/tasks/${id}/session`).expect(200);
  assert.equal(exported.body.report.person.name, "Test Person");
  assert.equal(exported.body.report.repository.name, "repo");
  assert.equal(exported.body.report.budget.requestedUsd, 2);
  assert.equal(exported.body.schemaVersion, "budgetsight.session.v1");
  const download = await agent.get(`/api/v1/tasks/${id}/session?download=1`).expect(200);
  assert.equal(download.headers["content-disposition"], `attachment; filename="budgetsight-${id}.json"`);
  assert.equal(download.headers["cache-control"], "private, no-store");
  assert.equal(download.body.schemaVersion, "budgetsight.session.v1");
  fs.writeFileSync(path.join(repoPath, "artifact.md"), "# Download me\n");
  const artifact = await agent.get(`/api/v1/tasks/${id}/files`).query({ path: "artifact.md" }).expect(200);
  assert.match(artifact.headers["content-disposition"], /attachment; filename="artifact\.md"/);
  assert.equal(artifact.text, "# Download me\n");
  const outside = path.join(tempRoot, "outside.txt");
  fs.writeFileSync(outside, "private\n");
  await agent.get(`/api/v1/tasks/${id}/files`).query({ path: outside }).expect(403);
});

test("workspace members can view every thread but only owners can modify it", async () => {
  const owner = request.agent(app);
  await owner.post("/api/v1/auth/login").send({ username: "test", password: "password" }).expect(200);
  const repository = (await owner.get("/api/v1/repositories").expect(200)).body.repositories[0];
  const sharedTask = (await owner.post("/api/v1/tasks").send({
    repositoryId: repository.id,
    model: "gpt-6-luna",
    budgetUsd: 1,
    title: "Shared workspace thread",
  }).expect(201)).body.task;

  db.prepare("INSERT INTO users(id,display_name,username,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(
    crypto.randomUUID(), "Casey Nguyen", "casey.nguyen", await bcrypt.hash("casey-password", 4), "user", now(),
  );
  const viewer = request.agent(app);
  await viewer.post("/api/v1/auth/login").send({ username: "casey.nguyen", password: "casey-password" }).expect(200);
  const listing = await viewer.get("/api/v1/tasks").expect(200);
  assert.ok(listing.body.tasks.some((task) => task.id === sharedTask.id));
  await viewer.get(`/api/v1/tasks/${sharedTask.id}`).expect(200);
  await viewer.patch(`/api/v1/tasks/${sharedTask.id}/budget`).send({ budgetUsd: 2 }).expect(403);
  await viewer.post(`/api/v1/tasks/${sharedTask.id}/messages`).send({ text: "Not my thread", attachmentIds: [] }).expect(403);
});

test("creates a Git repository only inside an allowed root", async () => {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username: "test", password: "password" }).expect(200);
  const discovery = await agent.get("/api/v1/repositories").expect(200);
  assert.equal(discovery.body.roots.length, 1);
  const created = await agent.post("/api/v1/repositories").send({
    rootId: discovery.body.roots[0].id,
    name: "new-project",
  }).expect(201);
  assert.equal(created.body.repository.name, "new-project");
  assert.equal(fs.existsSync(path.join(tempRoot, "new-project", ".git")), true);
  assert.equal(fs.existsSync(path.join(tempRoot, "new-project", "README.md")), true);
  await agent.post("/api/v1/repositories").send({ rootId: "not-allowed", name: "escape" }).expect(400);
});

test("rejects unsafe upload paths", async () => {
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username: "test", password: "password" }).expect(200);
  const repo = (await agent.get("/api/v1/repositories")).body.repositories[0];
  const task = (await agent.post("/api/v1/tasks").send({ repositoryId: repo.id, model: "gpt-6-luna", budgetUsd: 1 })).body.task;
  await agent.post(`/api/v1/tasks/${task.id}/uploads`)
    .field("relativePaths", "../escape.txt")
    .attach("files", Buffer.from("nope"), "escape.txt")
    .expect(400);
  assert.equal(fs.existsSync(path.join(tempRoot, "escape.txt")), false);
});

test("discovers nested repositories when the configured root is itself a Git repository", async () => {
  execFileSync("git", ["init", tempRoot]);
  const agent = request.agent(app);
  await agent.post("/api/v1/auth/login").send({ username: "test", password: "password" }).expect(200);
  const discovery = await agent.get("/api/v1/repositories").expect(200);
  const names = discovery.body.repositories.map((repository) => repository.name);
  assert.ok(names.includes(path.basename(tempRoot)));
  assert.ok(names.includes("repo"));
  assert.ok(names.includes("new-project"));
  const nested = discovery.body.repositories.find((repository) => repository.name === "repo");
  await agent.post("/api/v1/tasks").send({
    repositoryId: nested.id,
    model: "gpt-6-luna",
    budgetUsd: 1,
    title: "Nested repository task",
  }).expect(201);
  const created = await agent.post("/api/v1/repositories").send({
    rootId: discovery.body.roots[0].id,
    name: "nested-after-root-git",
  }).expect(201);
  await agent.post("/api/v1/tasks").send({
    repositoryId: created.body.repository.id,
    model: "gpt-6-luna",
    budgetUsd: 1,
    title: "New nested repository task",
  }).expect(201);
});
