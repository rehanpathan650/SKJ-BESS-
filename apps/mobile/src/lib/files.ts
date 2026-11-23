// Secure handling of downloaded documents: files go to the app's private cache, are opened or shared,
// and are deleted afterwards. Nothing is written to shared storage.
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { API_URL } from "./config";
import { getAccessToken, refreshTokens } from "./session";

const PREFIX = "skj-";

async function download(path: string, name: string): Promise<File> {
  const target = new File(Paths.cache, `${PREFIX}${Date.now()}-${name.replace(/[^A-Za-z0-9._-]/g, "_")}`);
  const attempt = () => File.downloadFileAsync(`${API_URL}${path}`, target, {
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` }, idempotent: true,
  });
  try {
    return await attempt();
  } catch {
    if (await refreshTokens()) return attempt(); // access token may have expired
    throw new Error("Download failed");
  }
}

function scheduleDelete(f: File, ms = 2 * 60 * 1000) {
  setTimeout(() => { try { if (f.exists) f.delete(); } catch { /* already gone */ } }, ms);
}

export async function openPdf(path: string, name: string) {
  const f = await download(path, name);
  try {
    await f.preview({ mimeType: "application/pdf" });
  } catch {
    await Sharing.shareAsync(f.uri, { mimeType: "application/pdf", dialogTitle: name });
  } finally {
    scheduleDelete(f);
  }
}

/** Open any protected document (bill PDF or photo) in the phone's viewer, then delete the temp copy. */
export async function openFile(path: string, name: string, mimeType: string) {
  const f = await download(path, name);
  try {
    await f.preview({ mimeType });
  } catch {
    await Sharing.shareAsync(f.uri, { mimeType, dialogTitle: name });
  } finally {
    scheduleDelete(f);
  }
}

export async function sharePdf(path: string, name: string) {
  const f = await download(path, name);
  try {
    await Sharing.shareAsync(f.uri, { mimeType: "application/pdf", dialogTitle: `Share ${name}` });
  } finally {
    scheduleDelete(f);
  }
}

/** Remove any leftover temporary documents (called at start-up and on logout). */
export function cleanupTempFiles() {
  try {
    for (const item of Paths.cache.list()) {
      if (item instanceof File && item.name.startsWith(PREFIX)) item.delete();
    }
  } catch { /* cache not available */ }
}
