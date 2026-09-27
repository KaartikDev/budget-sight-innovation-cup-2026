const listeners = new Map();

export function publish(taskId, event) {
  for (const listener of listeners.get(taskId) || []) listener(event);
}

export function subscribe(taskId, listener) {
  if (!listeners.has(taskId)) listeners.set(taskId, new Set());
  listeners.get(taskId).add(listener);
  return () => {
    listeners.get(taskId)?.delete(listener);
    if (listeners.get(taskId)?.size === 0) listeners.delete(taskId);
  };
}
