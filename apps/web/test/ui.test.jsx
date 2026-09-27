// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityGroup, AppHeader, Conversation, NewTask, Sidebar, TimelineItem } from "../src/App.jsx";
import AccountsPage from "../src/AccountsPage.jsx";
import ReportingDashboard from "../src/ReportingDashboard.jsx";
import InsightsDashboard from "../src/InsightsDashboard.jsx";
import { api } from "../src/api.js";

vi.mock("../src/api.js", () => ({ api: vi.fn() }));

const noop = () => {};

const reportRow = {
  rowId: "row-1",
  semanticStatus: "pending",
  row: {
    identity: { turnId: "turn-1234567890", taskId: "task-1" },
    actor: { name: "Maya Chen", role: "user" },
    environment: { platform: "darwin", architecture: "arm64" },
    thread: { title: "Inspect dependency graph", runtimeStatus: "idle_completed" },
    repository: { name: "budget-app", branchBefore: "main", branchAfter: "main" },
    timing: { startedAt: "2026-09-26T20:00:00.000Z", durationMs: 4200 },
    metrics: { commandCount: 3, linesAdded: 12, linesDeleted: 2, deliverablePaths: ["src/App.jsx"], toolCount: 7, changedFileCount: 1 },
    semantic: {
      workload: { primary: "repo_exploration", secondary: ["analysis_planning"] },
      outcome: { status: "completed", validation: "passed" },
      observations: { mostRepeatedToolIntent: "file_reading", toolCallCount: 4, isRepeated: true, confidence: "high" },
    },
    usage: { totalTokens: 2400, estimatedCostMicros: 12000 },
  },
};

const insightsData = {
  window: { bucket: "day", dataAsOf: "2026-09-27T06:00:00.000Z" },
  summary: {
    turns: 2,
    spendMicros: 120000,
    inputTokens: 12000,
    cachedInputTokens: 9000,
    uncachedInputTokens: 3000,
    outputTokens: 1400,
    totalTokens: 13400,
    toolCalls: 18,
    cacheRate: .75,
    outcomes: { completed: 1, partial_completion: 1, failed: 0, unknown: 0 },
  },
  series: [
    { bucketStart: "2026-09-26T00:00:00.000Z", spendMicros: 40000, inputTokens: 5000, cachedInputTokens: 4000, uncachedInputTokens: 1000, outputTokens: 600, totalTokens: 5600, turns: 1, outcomes: { completed: 1 }, turnIds: ["turn-1"] },
    { bucketStart: "2026-09-27T00:00:00.000Z", spendMicros: 80000, inputTokens: 7000, cachedInputTokens: 5000, uncachedInputTokens: 2000, outputTokens: 800, totalTokens: 7800, turns: 1, outcomes: { partial_completion: 1 }, turnIds: ["turn-2"] },
  ],
  runPoints: [
    { turnId: "turn-1", title: "Inspect dependency graph", promptSummary: "Inspect dependency graph", repositoryName: "budget-app", userName: "Maya Chen", model: "gpt-6-sol", branch: "main", durationMs: 4200, spendMicros: 40000, totalTokens: 5600, cachedInputTokens: 4000, toolCalls: 7, tools: [{ ordinal: "tool_1", toolName: "rg", itemType: "commandExecution", intent: "code_search", status: "completed", effect: "read", durationMs: 240, exitCode: 0, targets: ["apps/web/src"] }], failures: [], changedFiles: [], changedFileCount: 0, validationAfterLastModification: true, validationActions: [], conversation: { userMessages: 1, assistantMessages: 1, attachments: 0 }, outcome: "completed", workload: "repo_exploration" },
    { turnId: "turn-2", title: "Fix validation flow", promptSummary: "Fix validation flow", repositoryName: "budget-app", userName: "Jordan Patel", model: "gpt-6-sol", branch: "main", durationMs: 12000, spendMicros: 80000, totalTokens: 7800, cachedInputTokens: 5000, toolCalls: 11, tools: [{ ordinal: "tool_1", toolName: "npm test", itemType: "commandExecution", intent: "test_validation", status: "failed", effect: "process", durationMs: 2300, exitCode: 1, targets: ["apps/web/test/ui.test.jsx"] }], failures: [{ ordinal: "failure_1", toolOrdinal: "tool_1", category: "test_command_failed", subject: "UI suite", fingerprint: "failure-test-ui", exitCode: 1 }], changedFiles: [{ path: "apps/web/src/App.jsx", linesAdded: 4, linesDeleted: 1 }], changedFileCount: 1, validationAfterLastModification: false, validationActions: [], conversation: { userMessages: 1, assistantMessages: 1, attachments: 0 }, outcome: "partial_completion", workload: "code_generation" },
  ],
  overlap: {
    repositories: [{ id: "repo-1", name: "budget-app", calls: 12 }],
    intents: [{ intent: "file_reading", calls: 12 }],
    cells: [{ repositoryId: "repo-1", repositoryName: "budget-app", intent: "file_reading", agentCount: 2, agentNames: ["Maya Chen", "Jordan Patel"], turnCount: 2, turnIds: ["turn-1", "turn-2"], callCount: 12 }],
  },
  workloadOutcomes: [{ workload: "code_generation", total: 2, outcomes: { completed: { count: 1, turnIds: ["turn-1"] }, partial_completion: { count: 1, turnIds: ["turn-2"] }, failed: { count: 0, turnIds: [] }, unknown: { count: 0, turnIds: [] } } }],
  opportunities: [{ id: "validation-gaps", type: "validation_gap", confidence: "high", title: "Edits often finish without final validation", summary: "One turn changed files without final validation.", evidence: ["2 changed files", "Measured after the final edit"], impact: { kind: "measured", label: "Turns missing validation", value: 1, unit: "turns" }, turnIds: ["turn-2"], trend: [0, 1] }],
  dataQuality: { unknownOutcomes: 0, missingUsage: 0, incompleteSources: 0, pendingExtraction: 0, failedExtraction: 0 },
  facets: {
    repositories: [{ value: "repo-1", label: "budget-app", count: 2 }],
    users: [{ value: "user-1", label: "Maya Chen", count: 1 }],
    models: [{ value: "gpt-6-sol", label: "gpt-6-sol", count: 2 }],
    workloads: [{ value: "code_generation", label: "Code Generation", count: 2 }],
    outcomes: [{ value: "completed", label: "Completed", count: 1 }],
  },
};

afterEach(cleanup);
beforeEach(() => {
  api.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("instrument console components", () => {
  test("shows role-gated top navigation and the active workspace", () => {
    const { rerender } = render(<AppHeader user={{ name: "BudgetSight Admin", role: "admin" }} activeView="reporting" onThreads={noop} onReporting={noop} onAccounts={noop} onLogout={noop} />);
    expect(screen.getByRole("button", { name: "Reporting" }).classList.contains("active")).toBe(true);
    expect(screen.getByRole("button", { name: "Insights" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Accounts" })).toBeTruthy();

    rerender(<AppHeader user={{ name: "Demo User", role: "user" }} activeView="threads" onThreads={noop} onReporting={noop} onAccounts={noop} onLogout={noop} />);
    expect(screen.getByRole("button", { name: "Threads" }).classList.contains("active")).toBe(true);
    expect(screen.queryByRole("button", { name: "Reporting" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Insights" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accounts" })).toBeNull();
  });

  test("keeps repository and recent-thread controls in the thread rail", () => {
    render(<Sidebar repos={[{ id: "repo-1", name: "budget-app" }]} tasks={[{ id: "task-1", title: "Inspect dependency graph", status: "running", model: "gpt-6-sol", repository: { id: "repo-1", name: "budget-app" } }]} selectedRepo="" setSelectedRepo={noop} activeId="task-1" onSelect={noop} onNew={noop} onNewRepo={noop} />);
    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Inspect dependency graph/ }).classList.contains("active")).toBe(true);
    expect(screen.queryByRole("button", { name: "Reporting" })).toBeNull();
  });

  test("renders prompts and assistant output as operational run-log entries", () => {
    const { rerender } = render(<TimelineItem item={{ role: "user", text: "Audit this repository" }} taskId="task-1" />);
    expect(screen.getByText("Prompt")).toBeTruthy();
    expect(screen.getByText("Operator input")).toBeTruthy();

    rerender(<TimelineItem item={{ role: "assistant", text: "I inspected the repository." }} taskId="task-1" />);
    expect(screen.getByText("Work note")).toBeTruthy();
    expect(screen.getByText("I inspected the repository.")).toBeTruthy();
  });

  test("keeps thread creation behavior inside the redesigned dialog", async () => {
    const onClose = vi.fn();
    render(<NewTask repos={[{ id: "repo-1", name: "budget-app" }]} defaultRepo="repo-1" onClose={onClose} onCreated={noop} />);
    expect(screen.getByRole("heading", { name: "Start with a boundary" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("shows agent activity and lets pending attachments be removed", async () => {
    const task = { id: "task-1", title: "Inspect dependency graph", status: "running", repository: { name: "budget-app" }, repoSnapshot: { branch: "main" } };
    render(<Conversation task={task} detail={{ messages: [], events: [] }} onRefresh={noop} onSend={noop} onCancel={noop} />);

    expect(screen.getByRole("status").textContent).toContain("Codex is thinking");
    expect(screen.getByText("What should Codex work on?").closest(".timeline").getAttribute("aria-busy")).toBe("true");

    const attachment = new File(["notes"], "notes.txt", { type: "text/plain", lastModified: 1 });
    fireEvent.change(screen.getByLabelText("Attach files"), { target: { files: [attachment] } });
    expect(screen.getByText("notes.txt")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    expect(screen.queryByText("notes.txt")).toBeNull();
  });

  test("keeps an interrupted run terminal even when an event is stale", () => {
    const staleEvent = { seq: 1, type: "item/updated", item: { id: "command-1", type: "commandExecution", status: "inProgress", command: "npm test" } };
    const { rerender } = render(<ActivityGroup events={[staleEvent]} taskStatus="user_interrupted" />);

    expect(screen.getByText("Interrupted")).toBeTruthy();
    expect(screen.getByTitle("user_interrupted")).toBeTruthy();
    expect(screen.queryByText("Running")).toBeNull();

    rerender(<ActivityGroup events={[]} taskStatus="user_interrupted" />);
    expect(screen.getByText("Run interrupted. No agent activity was recorded after this prompt.")).toBeTruthy();
  });

  test("loads, expands, filters, and retries reporting rows", async () => {
    api.mockImplementation((path, options) => {
      if (options?.method === "POST") return Promise.resolve({ job: { state: "queued" } });
      if (String(path).startsWith("/admin/reporting/insights")) return Promise.resolve(insightsData);
      return Promise.resolve({ rows: [reportRow], nextCursor: null });
    });
    render(<ReportingDashboard tasks={[{ id: "task-1", status: "idle_completed", usage: { totalTokens: 2400 }, budget: { estimatedUsd: 0.012 } }]} />);
    expect(await screen.findByText("Inspect dependency graph")).toBeTruthy();
    expect(screen.getByText("Usage over time")).toBeTruthy();

    fireEvent.click(screen.getByText("Inspect dependency graph"));
    expect(screen.getByText("Identity")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry extraction" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/reporting/turns/turn-1234567890/retry", { method: "POST" }));

    await userEvent.selectOptions(screen.getByLabelText("Filter by workload"), "testing");
    await waitFor(() => expect(api.mock.calls.some(([path]) => String(path).includes("workload=testing"))).toBe(true));

    await userEvent.selectOptions(screen.getByLabelText("Filter by model"), "gpt-6-sol");
    await waitFor(() => expect(api.mock.calls.some(([path]) => String(path).includes("model=gpt-6-sol"))).toBe(true));

    await userEvent.selectOptions(screen.getByLabelText("Filter by time range"), "7d");
    await waitFor(() => expect(api.mock.calls.some(([path]) => String(path).includes("from=") && String(path).includes("to="))).toBe(true));
    expect(api.mock.calls.some(([path]) => String(path).includes("/admin/reporting/insights?") && String(path).includes("bucket=day"))).toBe(true);
  });

  test("loads insights, filters the aggregate endpoint, and opens linked evidence", async () => {
    api.mockResolvedValue(insightsData);
    const { container } = render(<InsightsDashboard />);
    expect(await screen.findByRole("heading", { name: "Insights" })).toBeTruthy();
    expect(screen.getByText("Obvious wins")).toBeTruthy();
    expect(screen.getByText("Turns by workload")).toBeTruthy();
    expect(screen.queryByText("Usage over time")).toBeNull();
    expect(screen.getByText("Edits often finish without final validation")).toBeTruthy();

    const callsBeforeRadarEdit = api.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /Add workload/ }));
    await userEvent.selectOptions(screen.getByLabelText("Workload type to add"), "testing");
    await userEvent.click(screen.getByRole("button", { name: "Add axis" }));
    expect([...container.querySelectorAll(".radar-label")].some((label) => label.textContent === "Testing")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /Remove workload/ }));
    await userEvent.selectOptions(screen.getByLabelText("Workload type to remove"), "testing");
    await userEvent.click(screen.getByRole("button", { name: "Remove axis" }));
    expect([...container.querySelectorAll(".radar-label")].some((label) => label.textContent === "Testing")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /Add workload/ }));
    await userEvent.type(screen.getByLabelText("Custom workload name"), "Security review");
    await userEvent.click(screen.getByRole("button", { name: "Add axis" }));
    expect([...container.querySelectorAll(".radar-label")].some((label) => label.textContent === "Security Review")).toBe(true);
    expect(api.mock.calls.length).toBe(callsBeforeRadarEdit);

    fireEvent.click(screen.getByText("Edits often finish without final validation").closest("button"));
    fireEvent.click(container.querySelector(".detail-run-toggle"));
    fireEvent.click(screen.getByText(/All tool calls/).closest("summary"));
    expect(screen.getByText("npm test")).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText("Repository"), "repo-1");
    await waitFor(() => expect(api.mock.calls.some(([path]) => String(path).includes("repositoryId=repo-1"))).toBe(true));

    fireEvent.click(container.querySelector(".scatter-point"));
    expect(screen.getByText("Selected evidence")).toBeTruthy();
    expect(screen.queryByText("Exploring")).toBeNull();
    expect(screen.getAllByText("Inspect dependency graph").length).toBeGreaterThan(0);
    fireEvent.click(container.querySelector(".detail-run-toggle"));
    expect(screen.getByText("Prompt summary")).toBeTruthy();
    expect(screen.getByText("rg")).toBeTruthy();
    expect(screen.getByText(/raw prompt text is not retained/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Close selected evidence" }));
    expect(screen.queryByText("Selected evidence")).toBeNull();
  });

  test("loads members and preserves account creation feedback", async () => {
    api.mockImplementation((path, options) => {
      if (options?.method === "POST") return Promise.resolve({ user: { id: "user-2", name: "Morgan Lee", username: "morgan.lee", role: "user", threadCount: 0, estimatedSpendUsd: 0 } });
      return Promise.resolve({ users: [{ id: "user-1", name: "BudgetSight Admin", username: "admin", role: "admin", threadCount: 4, estimatedSpendUsd: 1.25 }] });
    });
    render(<AccountsPage />);
    expect(await screen.findByText("BudgetSight Admin")).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Full name"), "Morgan Lee");
    await userEvent.type(screen.getByLabelText("Username"), "morgan.lee");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Morgan Lee is ready.")).toBeTruthy();
  });
});
