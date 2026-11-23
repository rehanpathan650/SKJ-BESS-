import { expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type Who = "admin" | "it" | "mgmt" | "engineer" | "sales" | "sales2" | "finance" | "readonly";
interface Fixtures { password: string; users: Record<Who, { email: string; role: string; totp_secret: string | null }> }

const API_DIR = join(__dirname, "..", "..", "api");
export const fx = (): Fixtures => JSON.parse(readFileSync(join(__dirname, ".auth", "fixtures.json"), "utf8"));

// ---------- TOTP (RFC 6238), with replay protection awareness ----------
function base32(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpAt(secret: string, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}
const usedSteps = new Map<string, number>();
/** The server refuses a code that was already used, so wait for a fresh 30-second window if needed. */
export async function totp(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  if ((usedSteps.get(secret) ?? -1) >= step) {
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
    step = Math.floor(Date.now() / 30_000);
  }
  usedSteps.set(secret, step);
  return totpAt(secret, step);
}

// ---------- backend helpers (read the throwaway e2e database only) ----------
function py(code: string): string {
  return execFileSync(join(API_DIR, ".venv", "Scripts", "python.exe"), ["-c", code], {
    cwd: API_DIR, encoding: "utf8",
    env: { ...process.env, ENVIRONMENT: "test", DATABASE_URL: `sqlite:///${join(API_DIR, "e2e", "e2e.db").replace(/\\/g, "/")}`,
      STORAGE_DIR: join(API_DIR, "e2e", "storage"), AI_ENABLED: "false" },
  }).trim();
}

/** Latest email queued for an address; returns the first link in its body. */
export function lastEmailLink(to: string, pathPart: string): string {
  const out = py(`
import json
from sqlalchemy import select
from app.db import SessionLocal
from app.models import Job
db = SessionLocal()
jobs = [j for j in db.execute(select(Job).where(Job.kind == "email").order_by(Job.created_at.desc())).scalars() if j.payload.get("to") == ${JSON.stringify(to)}]
print(jobs[0].payload["body"] if jobs else "")
`);
  const m = out.match(new RegExp(`https?://\\S*${pathPart}\\S*`));
  if (!m) throw new Error(`No email with ${pathPart} for ${to}`);
  return new URL(m[0]).pathname + new URL(m[0]).search;
}

/** Run the background worker's queue once (bill scanning/extraction, emails). */
export function runWorker(times = 3): void {
  py(`
from app.worker import run_once
for _ in range(${times}):
    run_once()
`);
}

// ---------- UI helpers ----------
export async function login(page: Page, who: Who, password?: string): Promise<void> {
  const f = fx();
  const u = f.users[who];
  await page.goto("/login");
  await page.getByLabel("Work email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(password ?? f.password);
  await page.getByRole("button", { name: "Log in" }).click();
  if (u.totp_secret) {
    await page.getByLabel(/^6-digit code/).fill(await totp(u.totp_secret));
    await page.getByRole("button", { name: "Verify" }).click();
  }
  await expect(page.getByLabel("Main navigation")).toBeVisible();
}

export async function logout(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

export const nav = (page: Page) => page.getByLabel("Main navigation");
