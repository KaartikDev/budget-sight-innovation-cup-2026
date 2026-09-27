import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDir, "../../..");
const baseUrl = String(process.env.BUDGETSIGHT_URL || "http://127.0.0.1:4310").replace(/\/$/, "");
const pollMs = Number(process.env.DEMO_POLL_MS || 5_000);
const taskTimeoutMs = Number(process.env.DEMO_TASK_TIMEOUT_MS || 8 * 60_000);
const waveTimeoutMs = Number(process.env.DEMO_WAVE_TIMEOUT_MS || 20 * 60_000);
const dryRun = process.argv.includes("--dry-run");
const requestedRunId = process.argv.find((value) => value.startsWith("--run-id="))?.split("=").slice(1).join("=");
const runId = requestedRunId || new Date().toISOString().replace(/[:.]/g, "-");
const model = "gpt-6-luna";

const accounts = [
  { name: "Maya Chen", username: "maya.chen", password: "Cedar!Sky27" },
  { name: "Jordan Patel", username: "jordan.patel", password: "Harbor!Mint42" },
  { name: "Sofia Ramirez", username: "sofia.ramirez", password: "Quartz!Lake56" },
  { name: "Liam O'Connor", username: "liam.oconnor", password: "Maple!River38" },
  { name: "Aisha Thompson", username: "aisha.thompson", password: "Nova!Field64" },
];

function scopedPrompt(outputPath, work) {
  return `${work}

This is a contained BudgetSight demo workload. Keep the result concise but polished and useful. Put every new artifact under ${outputPath}. Do not overwrite existing project files, do not commit, and do not push. You may inspect the repository and run relevant read-only checks or validations. Finish by validating the deliverable and briefly summarizing what you created.`;
}

const workloads = [
  // Wave 1: fast orientation, QA, and artifact wins.
  {
    wave: 1, username: "maya.chen", repository: "shared-project-accent", budgetUsd: 0.50,
    title: "PaperPlane onboarding map",
    prompt: scopedPrompt("demo-output/maya/paperplane-onboarding", "Explore the PaperPlane project and create a one-page onboarding map in Markdown. Explain the major folders, request flow, test locations, and the three best first tasks for a new contributor. Include a compact Mermaid architecture diagram."),
  },
  {
    wave: 1, username: "jordan.patel", repository: "budgetsightv3", budgetUsd: 0.65,
    title: "BudgetSight positioning audit",
    prompt: scopedPrompt("demo-output/jordan/positioning-audit", "Review the BudgetSight README and product UI copy. Create a concise positioning audit with the core audience, problem, promise, proof points, five sharper headline options, and a recommended demo narrative."),
  },
  {
    wave: 1, username: "sofia.ramirez", repository: "second-repo-demo", budgetUsd: 0.80,
    title: "Expense tracker QA snapshot",
    prompt: scopedPrompt("demo-output/sofia/expense-qa", "Inspect the expense tracker and its tests. Run the relevant test suite, then create a QA snapshot that lists covered behavior, uncovered edge cases, current results, and five high-value next tests. Add one small standalone test file in the output folder that demonstrates the highest-value edge case without changing the original app."),
  },
  {
    wave: 1, username: "liam.oconnor", repository: "abc", budgetUsd: 1.25,
    title: "Wright brothers mini deck",
    prompt: scopedPrompt("demo-output/liam/wright-mini-deck", "Create a polished five-slide presentation about the Wright brothers: problem, experiments, breakthrough, first flight, and enduring lesson. Produce a PPTX plus an editable source script, reuse any available presentation tooling in the repository, and render or inspect the result before finishing."),
  },
  {
    wave: 1, username: "aisha.thompson", repository: "demo repo 3", budgetUsd: 0.75,
    title: "Static demo conversion review",
    prompt: scopedPrompt("demo-output/aisha/conversion-review", "Review the static demo site as a conversion-focused product page. Create a prioritized review covering message clarity, information hierarchy, accessibility, mobile risks, and five easy wins. Include replacement copy for the hero and primary call to action."),
  },

  // Wave 2: code, debugging, slides, accessibility, and technical writing.
  {
    wave: 2, username: "maya.chen", repository: "budgetsightv3", budgetUsd: 1.10,
    title: "Luna cost explainer microsite",
    prompt: scopedPrompt("demo-output/maya/luna-cost-explainer", "Build a standalone responsive HTML/CSS/JavaScript microsite that explains cached input, uncached input, output tokens, and spend caps for Luna. Include an interactive cost example, accessible labels, and a small Node-based smoke test for the calculation."),
  },
  {
    wave: 2, username: "jordan.patel", repository: "second-repo-demo", budgetUsd: 0.95,
    title: "Expense tracker edge-case debug",
    prompt: scopedPrompt("demo-output/jordan/expense-debug", "Investigate the expense tracker for one realistic edge-case defect involving malformed amounts, empty data, or category handling. Reproduce the issue, create a corrected standalone variant or patch file in the output folder, add a regression test there, and run it."),
  },
  {
    wave: 2, username: "sofia.ramirez", repository: "abc", budgetUsd: 1.40,
    title: "Three-act history slide deck",
    prompt: scopedPrompt("demo-output/sofia/history-deck", "Create a six-slide presentation called 'History in Three Acts' with a strong visual hierarchy: ancient networks, industrial acceleration, the digital turn, a comparison slide, a timeline, and a closing takeaway. Produce a PPTX and source script, then render or inspect the output."),
  },
  {
    wave: 2, username: "liam.oconnor", repository: "demo repo 3", budgetUsd: 0.85,
    title: "Accessible landing-page variant",
    prompt: scopedPrompt("demo-output/liam/accessible-variant", "Audit the existing static page for accessibility and create an improved standalone HTML/CSS variant. Preserve its basic concept while improving semantic structure, focus states, contrast, reduced-motion behavior, and responsive layout. Include a short audit note and validate the HTML where practical."),
  },
  {
    wave: 2, username: "aisha.thompson", repository: "demo 3", budgetUsd: 0.70,
    title: "Erdos proof reader guide",
    prompt: scopedPrompt("demo-output/aisha/erdos-reader-guide", "Read the mathematical artifact in this repository and write a reader-friendly guide explaining the question, proof strategy, key definitions, and likely points of confusion. Include a glossary and a one-page teaching outline without changing the original source."),
  },

  // Wave 3: web research, testing, conversion experiments, and dependency mapping.
  {
    wave: 3, username: "maya.chen", repository: "second-repo-demo", budgetUsd: 1.50,
    title: "Expense app market scan",
    prompt: scopedPrompt("demo-output/maya/expense-market-scan", "Conduct lightweight current web research on personal expense-tracking products. Create a sourced market scan comparing five products on audience, key promise, pricing approach, and notable workflow. End with three positioning opportunities for this demo expense tracker and include source links."),
  },
  {
    wave: 3, username: "jordan.patel", repository: "abc", budgetUsd: 0.95,
    title: "Game of Life regression suite",
    prompt: scopedPrompt("demo-output/jordan/game-of-life-tests", "Inspect the Game of Life implementation and create a focused regression test suite for still lifes, oscillators, edge handling, and invalid input. Keep tests in the output folder, run them against the existing implementation, and document any failures without rewriting the original file."),
  },
  {
    wave: 3, username: "sofia.ramirez", repository: "demo repo 3", budgetUsd: 1.10,
    title: "Landing-page message experiment",
    prompt: scopedPrompt("demo-output/sofia/message-experiment", "Create two standalone landing-page variants for the existing demo: one credibility-led and one speed-led. Each should include distinct hero copy, proof section, CTA treatment, and responsive styling. Add a short experiment plan defining hypothesis, audience, and success metric."),
  },
  {
    wave: 3, username: "liam.oconnor", repository: "demo 3", budgetUsd: 1.20,
    title: "Math communication research brief",
    prompt: scopedPrompt("demo-output/liam/math-communication", "Research current best practices for communicating advanced mathematics to mixed audiences. Produce a sourced brief with five principles, examples of good explanatory structure, and a reusable checklist for presenting the repository's Erdős-related material. Include links and publication dates where available."),
  },
  {
    wave: 3, username: "aisha.thompson", repository: "shared-project-accent", budgetUsd: 0.75,
    title: "PaperPlane dependency risk map",
    prompt: scopedPrompt("demo-output/aisha/dependency-risk-map", "Inspect PaperPlane's package manifests and service structure. Create a dependency and integration risk map covering frontend, API, database, authentication, OCR, and external services. Rank the top five risks and include a Mermaid dependency diagram."),
  },

  // Wave 4: flagship deck, deployment readiness, editorial artifact, research, and KPI story.
  {
    wave: 4, username: "maya.chen", repository: "abc", budgetUsd: 2.50,
    title: "Agent cost governance deck",
    prompt: scopedPrompt("demo-output/maya/cost-governance-deck", "Create a polished seven-slide executive presentation about agent cost governance: the visibility gap, normalized workloads, spend versus outcomes, coordination overlap, validation gaps, an operating loop, and a closing recommendation. Produce a PPTX and editable source, use charts or diagrams where helpful, and render or inspect every slide."),
  },
  {
    wave: 4, username: "jordan.patel", repository: "demo repo 3", budgetUsd: 0.65,
    title: "Static-site release checklist",
    prompt: scopedPrompt("demo-output/jordan/release-checklist", "Create a practical deployment-readiness checklist for the static site. Inspect links and assets, run lightweight local validation, and document pass/fail evidence for accessibility basics, responsive behavior, caching, rollback, and smoke testing."),
  },
  {
    wave: 4, username: "sofia.ramirez", repository: "demo 3", budgetUsd: 0.60,
    title: "Erdos editorial abstract",
    prompt: scopedPrompt("demo-output/sofia/erdos-editorial", "Create an editorial package for the mathematical artifact: a 150-word abstract, a plain-language summary, five pull quotes or callouts, a suggested article outline, and three title options. Keep all claims grounded in the repository material."),
  },
  {
    wave: 4, username: "liam.oconnor", repository: "shared-project-accent", budgetUsd: 1.75,
    title: "Pilot logbook competitor brief",
    prompt: scopedPrompt("demo-output/liam/logbook-competitors", "Conduct current web research on digital pilot logbooks and aviation record-management products. Compare at least five products on positioning, platform, import workflow, verification, and differentiators. Conclude with four product opportunities for PaperPlane and include source links."),
  },
  {
    wave: 4, username: "aisha.thompson", repository: "budgetsightv3", budgetUsd: 0.90,
    title: "Insights KPI story card",
    prompt: scopedPrompt("demo-output/aisha/kpi-story", "Create a standalone responsive HTML story card that explains five BudgetSight Insights metrics: measured spend, tokens, cache rate, incomplete spend, and completed turns. Include concise interpretation guidance, a sample data state, and accessible styling."),
  },

  // Wave 5: final set of demonstrable code, validation, personas, automation, and slides.
  {
    wave: 5, username: "maya.chen", repository: "demo repo 3", budgetUsd: 1.25,
    title: "Interactive ROI landing page",
    prompt: scopedPrompt("demo-output/maya/roi-landing-page", "Build a standalone marketing landing page with an interactive ROI calculator. Users should enter monthly agent runs, average minutes, and incomplete-run rate, then see an illustrative time-saved estimate. Clearly label assumptions, make it responsive and accessible, and add a smoke test for the calculation."),
  },
  {
    wave: 5, username: "jordan.patel", repository: "demo 3", budgetUsd: 0.80,
    title: "LaTeX validation and triage",
    prompt: scopedPrompt("demo-output/jordan/latex-triage", "Inspect and validate the LaTeX document without modifying the original. Attempt compilation using available tooling, record exact diagnostics, classify any issues as blocking or cosmetic, and create a minimal patch file only if a correction is needed."),
  },
  {
    wave: 5, username: "sofia.ramirez", repository: "shared-project-accent", budgetUsd: 1.40,
    title: "PaperPlane audience personas",
    prompt: scopedPrompt("demo-output/sofia/paperplane-personas", "Research and create four concise audience personas for a digital pilot logbook product: student pilot, career-track pilot, instructor, and flight-school operator. For each include jobs, pains, triggers, objections, message, and one campaign idea. Cite current external sources for market facts."),
  },
  {
    wave: 5, username: "liam.oconnor", repository: "budgetsightv3", budgetUsd: 1.65,
    title: "Insights summary generator",
    prompt: scopedPrompt("demo-output/liam/insights-summary-generator", "Build a small Node command-line tool that accepts a JSON file shaped like the BudgetSight Insights response and prints a concise Markdown executive summary. Include fixture data, tests for outcomes and data-confidence warnings, usage instructions, and run the tests."),
  },
  {
    wave: 5, username: "aisha.thompson", repository: "second-repo-demo", budgetUsd: 2.00,
    title: "Expense tracker product pitch",
    prompt: scopedPrompt("demo-output/aisha/expense-pitch", "Create a polished six-slide product pitch for the expense tracker: user problem, product flow, category insight, trust and privacy, roadmap, and call to action. Produce a PPTX and editable source script, reuse available tooling where practical, and render or inspect the slides."),
  },
];

function validatePlan() {
  const errors = [];
  const usernames = new Set(accounts.map((account) => account.username));
  const titles = new Set();
  for (const account of accounts) {
    const count = workloads.filter((item) => item.username === account.username).length;
    if (count < 5) errors.push(`${account.username} has only ${count} workloads`);
  }
  for (const item of workloads) {
    if (!usernames.has(item.username)) errors.push(`Unknown account: ${item.username}`);
    if (item.budgetUsd < 0.50 || item.budgetUsd > 2.50) errors.push(`Budget out of range: ${item.title}`);
    if (titles.has(item.title)) errors.push(`Duplicate title: ${item.title}`);
    titles.add(item.title);
  }
  for (const wave of [...new Set(workloads.map((item) => item.wave))]) {
    const items = workloads.filter((item) => item.wave === wave);
    if (items.length !== accounts.length) errors.push(`Wave ${wave} has ${items.length} workloads`);
    if (new Set(items.map((item) => item.username)).size !== items.length) errors.push(`Wave ${wave} repeats a user`);
    if (new Set(items.map((item) => item.repository)).size !== items.length) errors.push(`Wave ${wave} repeats a repository`);
  }
  if (errors.length) throw new Error(`Invalid demo workload plan:\n- ${errors.join("\n- ")}`);
}

function logPlan() {
  console.log(`BudgetSight demo workload run ${runId}`);
  console.log(`Model: ${model} · Threads: ${workloads.length} · Users: ${accounts.length}`);
  for (const item of workloads) {
    console.log(`Wave ${item.wave} · ${item.username} · ${item.repository} · $${item.budgetUsd.toFixed(2)} · ${item.title}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(pathname, { cookie, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}/api/v1${pathname}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
    Object.assign(error, { status: response.status, payload });
    throw error;
  }
  return { payload, response };
}

async function login(account) {
  const { payload, response } = await request("/auth/login", {
    method: "POST",
    body: { username: account.username, password: account.password },
  });
  const setCookie = response.headers.getSetCookie?.()[0] || response.headers.get("set-cookie");
  if (!setCookie) throw new Error(`Login for ${account.username} did not return a session cookie`);
  return { ...account, user: payload.user, cookie: setCookie.split(";", 1)[0] };
}

const manifestDir = path.join(projectRoot, "data", "demo-workload-runs");
const manifestPath = path.join(manifestDir, `${runId}.json`);
const manifest = {
  runId,
  createdAt: new Date().toISOString(),
  baseUrl,
  model,
  plan: workloads.map(({ prompt, ...item }) => ({ ...item, promptLength: prompt.length })),
  tasks: [],
  waves: {},
};

function saveManifest() {
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

async function launchWorkload(item, session, repositories) {
  const repository = repositories.find((candidate) => candidate.name === item.repository);
  if (!repository) throw new Error(`Repository not found: ${item.repository}`);
  const title = `[Demo ${runId.slice(0, 10)}] ${item.title}`;
  const { payload: created } = await request("/tasks", {
    cookie: session.cookie,
    method: "POST",
    body: { repositoryId: repository.id, title, model, budgetUsd: item.budgetUsd },
  });
  const taskRecord = {
    wave: item.wave,
    username: item.username,
    repository: item.repository,
    title,
    budgetUsd: item.budgetUsd,
    taskId: created.task.id,
    status: created.task.status,
    createdAt: new Date().toISOString(),
  };
  manifest.tasks.push(taskRecord);
  saveManifest();
  const { payload: started } = await request(`/tasks/${created.task.id}/messages`, {
    cookie: session.cookie,
    method: "POST",
    body: { text: item.prompt, attachmentIds: [] },
  });
  taskRecord.status = started.task.status;
  taskRecord.startedAt = new Date().toISOString();
  saveManifest();
  return { item, session, taskRecord };
}

const terminalStatuses = new Set(["idle_completed", "budget_interrupted", "user_interrupted", "failed"]);

async function waitForWave(wave, launched) {
  const deadline = Date.now() + waveTimeoutMs;
  const previous = new Map();
  while (Date.now() < deadline) {
    const states = await Promise.all(launched.map(async (entry) => {
      const { payload } = await request(`/tasks/${entry.taskRecord.taskId}`, { cookie: entry.session.cookie });
      return { entry, task: payload.task };
    }));
    for (const { entry, task } of states) {
      entry.taskRecord.status = task.status;
      entry.taskRecord.estimatedSpendUsd = task.budget?.estimatedUsd ?? null;
      entry.taskRecord.totalTokens = task.usage?.totalTokens ?? null;
      if (previous.get(task.id) !== task.status) {
        console.log(`Wave ${wave} · ${entry.item.username} · ${task.status} · ${entry.item.title}`);
        previous.set(task.id, task.status);
      }
      const startedAt = Date.parse(entry.taskRecord.startedAt || "");
      if (
        !terminalStatuses.has(task.status)
        && Number.isFinite(startedAt)
        && Date.now() - startedAt >= taskTimeoutMs
        && !entry.taskRecord.cancellationRequestedAt
      ) {
        entry.taskRecord.cancellationRequestedAt = new Date().toISOString();
        entry.taskRecord.cancellationReason = "Demo scheduler timebox reached";
        console.log(`Wave ${wave} · timeboxing ${entry.item.username} · ${entry.item.title}`);
        try {
          await request(`/tasks/${entry.taskRecord.taskId}/cancel`, {
            cookie: entry.session.cookie,
            method: "POST",
            body: { reason: entry.taskRecord.cancellationReason },
          });
        } catch (error) {
          entry.taskRecord.cancellationError = error.message;
          console.error(`Could not timebox ${entry.item.title}: ${error.message}`);
        }
      }
    }
    saveManifest();
    if (states.every(({ task }) => terminalStatuses.has(task.status))) {
      manifest.waves[wave] = { status: "completed", completedAt: new Date().toISOString() };
      saveManifest();
      return;
    }
    await sleep(pollMs);
  }
  manifest.waves[wave] = { status: "timed_out", timedOutAt: new Date().toISOString() };
  saveManifest();
  throw new Error(`Wave ${wave} did not finish within ${Math.round(waveTimeoutMs / 60_000)} minutes`);
}

async function waitForExtraction() {
  const deadline = Date.now() + 10 * 60_000;
  while (Date.now() < deadline) {
    const { payload } = await request("/health");
    const extraction = payload.featureExtraction;
    if (!extraction?.enabled) {
      console.log("Feature extraction is disabled; reporting rows will remain deterministic drafts.");
      return;
    }
    if (!extraction.busy && extraction.jobs.queued === 0 && extraction.jobs.running === 0) {
      if (extraction.jobs.waitingForOllama) console.log(`${extraction.jobs.waitingForOllama} extraction jobs are waiting for Ollama.`);
      else console.log("Feature extraction queue is clear.");
      return;
    }
    console.log(`Extraction · queued ${extraction.jobs.queued} · running ${extraction.jobs.running} · waiting ${extraction.jobs.waitingForOllama}`);
    await sleep(10_000);
  }
  console.log("Timed out waiting for semantic extraction; deterministic reporting rows remain available.");
}

async function main() {
  validatePlan();
  logPlan();
  if (dryRun) return;

  const { payload: health } = await request("/health");
  if (!health.ok) throw new Error("BudgetSight server is not healthy");
  if (!health.models?.includes(model)) throw new Error(`${model} is not available from the server`);

  const sessions = new Map((await Promise.all(accounts.map(login))).map((session) => [session.username, session]));
  const { payload: repositoryPayload } = await request("/repositories", { cookie: sessions.values().next().value.cookie });
  const repositories = repositoryPayload.repositories;
  saveManifest();

  const waves = [...new Set(workloads.map((item) => item.wave))].sort((left, right) => left - right);
  for (const wave of waves) {
    console.log(`Launching wave ${wave} (${accounts.length} parallel Luna turns)`);
    manifest.waves[wave] = { status: "launching", launchedAt: new Date().toISOString() };
    saveManifest();
    const waveItems = workloads.filter((item) => item.wave === wave);
    const results = await Promise.allSettled(waveItems.map((item) => launchWorkload(item, sessions.get(item.username), repositories)));
    const rejected = results.filter((result) => result.status === "rejected");
    const launched = results.filter((result) => result.status === "fulfilled").map((result) => result.value);
    if (rejected.length) {
      for (const result of rejected) console.error(`Wave ${wave} launch failed: ${result.reason.message}`);
      manifest.waves[wave] = { status: "launch_failed", errors: rejected.map((result) => result.reason.message) };
      saveManifest();
      if (!launched.length) throw new Error(`No workloads launched in wave ${wave}`);
    }
    await waitForWave(wave, launched);
  }

  await waitForExtraction();
  manifest.completedAt = new Date().toISOString();
  manifest.status = "completed";
  saveManifest();
  console.log(`Completed ${manifest.tasks.length} demo threads. Manifest: ${manifestPath}`);
}

main().catch((error) => {
  manifest.status = "failed";
  manifest.error = error.message;
  saveManifest();
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
