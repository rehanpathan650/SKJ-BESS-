// Web transport: httpOnly cookies hold the tokens (JavaScript cannot read them).
// State-changing requests send the CSRF token from the readable skj_csrf cookie.
import { ApiClient, endpoints } from "@skj/shared";

function readCookie(name: string): string {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : "";
}

let sessionEndedHandler: (() => void) | null = null;
export function onSessionEnded(fn: () => void) { sessionEndedHandler = fn; }

export const client = new ApiClient("", {
  credentials: "same-origin",
  headers(method): Record<string, string> {
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return {};
    const csrf = readCookie("skj_csrf");
    return csrf ? { "X-CSRF-Token": csrf } : {};
  },
  async refresh() {
    const res = await fetch("/api/v1/auth/refresh", { method: "POST", credentials: "same-origin" });
    return res.ok;
  },
  onSessionEnded() { sessionEndedHandler?.(); },
});

export const api = endpoints(client);

/** Download/open a protected file (sent with cookies) without exposing tokens in URLs. */
export async function fetchBlobUrl(path: string): Promise<string> {
  const res = await client.raw("GET", path.replace(/^\/api\/v1/, ""));
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function downloadFile(path: string, filename: string) {
  const url = await fetchBlobUrl(path);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
