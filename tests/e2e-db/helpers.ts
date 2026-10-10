import { execSync } from "node:child_process";
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
