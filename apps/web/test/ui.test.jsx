// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActivityGroup, AppHeader, Conversation, NewTask, Sidebar, TimelineItem } from "../src/App.jsx";
import AccountsPage from "../src/AccountsPage.jsx";
import ReportingDashboard from "../src/ReportingDashboard.jsx";
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

afterEach(cleanup);
beforeEach(() => {
  api.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

describe("instrument console components", () => {
  test("shows role-gated top navigation and the active workspace", () => {
    const { rerender } = render(<AppHeader user={{ name: "BudgetSight Admin", role: "admin" }} activeView="reporting" onThreads={noop} onReporting={noop} onAccounts={noop} onLogout={noop} />);
    expect(screen.getByRole("button", { name: "Reporting" }).classList.contains("active")).toBe(true);
    expect(screen.getByRole("button", { name: "Accounts" })).toBeTruthy();

    rerender(<AppHeader user={{ name: "Demo User", role: "user" }} activeView="threads" onThreads={noop} onReporting={noop} onAccounts={noop} onLogout={noop} />);
    expect(screen.getByRole("button", { name: "Threads" }).classList.contains("active")).toBe(true);
    expect(screen.queryByRole("button", { name: "Reporting" })).toBeNull();
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
      return Promise.resolve({ rows: [reportRow], nextCursor: null });
    });
    render(<ReportingDashboard tasks={[{ id: "task-1", status: "idle_completed", usage: { totalTokens: 2400 }, budget: { estimatedUsd: 0.012 } }]} />);
    expect(await screen.findByText("Inspect dependency graph")).toBeTruthy();

    fireEvent.click(screen.getByText("Inspect dependency graph"));
    expect(screen.getByText("Identity")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry extraction" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/admin/reporting/turns/turn-1234567890/retry", { method: "POST" }));

    await userEvent.selectOptions(screen.getByLabelText("Filter by workload"), "testing");
    await waitFor(() => expect(api.mock.calls.some(([path]) => String(path).includes("workload=testing"))).toBe(true));
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
