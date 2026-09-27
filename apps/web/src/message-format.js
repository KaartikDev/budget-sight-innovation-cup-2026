export function messageHref(target, taskId) {
  if (/^https?:\/\//i.test(target)) return { href: target, external: true };
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith("file://")) return null;
  let filePath = target;
  if (target.startsWith("file://")) {
    try { filePath = decodeURIComponent(new URL(target).pathname); }
    catch { return null; }
  } else {
    try { filePath = decodeURIComponent(target); }
    catch { return null; }
  }
  return {
    href: `/api/v1/tasks/${encodeURIComponent(taskId)}/files?path=${encodeURIComponent(filePath)}`,
    external: false,
  };
}
