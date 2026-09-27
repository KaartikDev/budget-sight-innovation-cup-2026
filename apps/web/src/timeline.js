export function eventItem(event) {
  return event.item || event.raw_json?.item || event.raw_json?.params?.item || null;
}

export function eventName(event) {
  return event.type || event.event_type || event.raw_json?.type || event.raw_json?.method || "event";
}

export function timelineTime(item) {
  const value = item.createdAt || item.created_at || item.localCreatedAt;
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function taskOutcome(task) {
  if (!task) return "—";
  if (["running", "connecting"].includes(task.status)) return task.status.replaceAll("_", " ");
  return task.lastTurnOutcome || task.status.replaceAll("_", " ");
}

export function groupTimelineByPrompt(messages = [], events = []) {
  const visibleMessages = [
    ...messages,
    ...events.filter((event) => /output_text\.done/.test(eventName(event))),
  ].sort((a, b) => timelineTime(a) - timelineTime(b));
  const prompts = visibleMessages.filter((item) => item.role === "user");
  const groups = prompts.map((prompt, index) => ({
    id: prompt.id || `prompt-${index}`,
    prompt,
    responses: [],
    events: [],
    startedAt: timelineTime(prompt),
  }));
  const orphan = { responses: [], events: [] };

  function destination(item) {
    const time = timelineTime(item);
    let match = null;
    for (const group of groups) {
      if (group.startedAt <= time) match = group;
      else break;
    }
    return match || orphan;
  }

  for (const item of visibleMessages) {
    if (item.role !== "user") destination(item).responses.push(item);
  }
  for (const event of events) {
    if (!/output_text\.done/.test(eventName(event))) destination(event).events.push(event);
  }
  return { groups, orphan };
}
