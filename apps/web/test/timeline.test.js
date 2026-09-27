import test from "node:test";
import assert from "node:assert/strict";
import { groupTimelineByPrompt, taskOutcome } from "../src/timeline.js";
import { messageHref } from "../src/message-format.js";

test("maps Markdown links to safe web and repository targets", () => {
  assert.equal(messageHref("/repo/My Deck.pptx", "task-1").href, "/api/v1/tasks/task-1/files?path=%2Frepo%2FMy%20Deck.pptx");
  assert.equal(messageHref("/repo/My%20Deck.pptx", "task-1").href, "/api/v1/tasks/task-1/files?path=%2Frepo%2FMy%20Deck.pptx");
  assert.equal(messageHref("https://example.com/info", "task-1").external, true);
  assert.equal(messageHref("javascript:alert(1)", "task-1"), null);
});

test("shows the live status instead of a stale prior outcome", () => {
  assert.equal(taskOutcome({ status: "running", lastTurnOutcome: "completed" }), "running");
  assert.equal(taskOutcome({ status: "connecting", lastTurnOutcome: "completed" }), "connecting");
  assert.equal(taskOutcome({ status: "idle_completed", lastTurnOutcome: "completed" }), "completed");
});

test("keeps each prompt's messages and agent events in its own group", () => {
  const messages = [
    { id: "p1", role: "user", text: "first", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "a1", role: "assistant", text: "working", createdAt: "2026-01-01T00:00:01.000Z" },
    { id: "p2", role: "user", text: "second", createdAt: "2026-01-01T00:01:00.000Z" },
    { id: "a2", role: "assistant", text: "working again", createdAt: "2026-01-01T00:01:01.000Z" },
  ];
  const events = [
    { seq: 1, event_type: "item/completed", created_at: "2026-01-01T00:00:02.000Z", item: { id: "c1", type: "commandExecution" } },
    { seq: 2, event_type: "item/completed", created_at: "2026-01-01T00:01:02.000Z", item: { id: "c2", type: "commandExecution" } },
  ];

  const timeline = groupTimelineByPrompt(messages, events);
  assert.equal(timeline.groups.length, 2);
  assert.deepEqual(timeline.groups[0].responses.map((item) => item.id), ["a1"]);
  assert.deepEqual(timeline.groups[0].events.map((item) => item.seq), [1]);
  assert.deepEqual(timeline.groups[1].responses.map((item) => item.id), ["a2"]);
  assert.deepEqual(timeline.groups[1].events.map((item) => item.seq), [2]);
});

test("assigns mid-turn steering activity to the latest prompt", () => {
  const messages = [
    { id: "p1", role: "user", text: "start", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "p2", role: "user", text: "steer", createdAt: "2026-01-01T00:00:05.000Z" },
  ];
  const events = [
    { seq: 1, event_type: "item/completed", created_at: "2026-01-01T00:00:03.000Z", item: { type: "commandExecution" } },
    { seq: 2, event_type: "item/completed", created_at: "2026-01-01T00:00:06.000Z", item: { type: "commandExecution" } },
  ];

  const timeline = groupTimelineByPrompt(messages, events);
  assert.deepEqual(timeline.groups[0].events.map((item) => item.seq), [1]);
  assert.deepEqual(timeline.groups[1].events.map((item) => item.seq), [2]);
});
