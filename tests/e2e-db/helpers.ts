import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import type { Page } from "@playwright/test";

export const PW = "AlbumPro-Local-1";
export const ROLES = ["admin", "reception", "colour", "designer", "printing", "qc", "accounts"] as const;
export type Role = (typeof ROLES)[number];

/** Run SQL against the local test database (LOCAL_DB, default albumprint_local). Returns trimmed stdout. */
export function sql(q: string): string {
  const db = process.env.LOCAL_DB ?? "albumprint_local";
  return execSync(`psql -h ${process.env.PGHOST ?? "/var/tmp"} -p ${process.env.PGPORT ?? 5433} -U ${process.env.PGUSER ?? "postgres"} -d ${db} -tA -v ON_ERROR_STOP=1`, { input: q }).toString().trim();
}

/** Sign in through the real login form as one of the seeded local users (admin@albumpro.local, …). */
export async function loginAs(page: Page, role: Role) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(`${role}@albumpro.local`);
  await page.locator("input[type=password]").first().fill(PW);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.includes("login"), { timeout: 15_000 });
}

/** The current 6-digit authenticator code for a base32 secret (RFC 6238, SHA-1, 30 s). */
export function totp(secret: string, at = Date.now()): string {
  const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = ""; for (const ch of secret.replace(/=+$/, "")) bits += B32.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, i) => parseInt(bits.slice(i * 8, i * 8 + 8), 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1]! & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
