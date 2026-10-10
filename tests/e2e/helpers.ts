import { expect, type Page } from "@playwright/test";

export type Role = "admin" | "reception" | "colour" | "designer" | "printing" | "qc" | "accounts";

/** Skip the login screen: the app keeps the signed-in role in localStorage (demo auth). */
export async function seedRole(page: Page, role: Role) {
  await page.addInitScript((r) => { try { if (!localStorage.getItem("albumpro.role") && !sessionStorage.getItem("e2e.seeded")) { localStorage.setItem("albumpro.role", r); sessionStorage.setItem("e2e.seeded", "1"); } } catch { /* ignore */ } }, role);
}

/** Wait until the app has autosaved (persist.ts flushes every ~1.2 s) the given text into a saved collection. */
export async function savedContains(page: Page, key: "orders" | "customers" | "audit" | "files", text: string) {
  await expect.poll(() => page.evaluate(([k, t]) => (localStorage.getItem(`albumpro.v1.${k}`) ?? "").includes(t as string), [key, text] as const), { timeout: 10_000 }).toBe(true);
}

export const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
