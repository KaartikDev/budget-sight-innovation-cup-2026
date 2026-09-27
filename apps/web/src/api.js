export async function api(path, options = {}) {
  const response = await fetch(`/api/v1${path}`, {
    credentials: "include",
    headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.message || body.error || `Request failed (${response.status})`);
    Object.assign(error, body, { status: response.status });
    throw error;
  }
  return body;
}

export function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
