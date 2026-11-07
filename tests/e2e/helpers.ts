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

export interface AlbumInput { name: string; sheets?: number; copies?: number; size?: string; paper?: string; finish?: string; cover?: string; box?: string }
/** Drive the order builder (Order type → Customer → Event → Albums → Invoice → Finalize). Returns the order code when finalized. */
export async function buildOrder(page: Page, o: { type?: RegExp; customer?: RegExp; newCustomer?: { name: string; phone: string }; albums?: AlbumInput[]; eventName?: string; discountPct?: string; finalize?: boolean; photosGiven?: string } = {}): Promise<string | undefined> {
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: o.type ?? /Design \+ Printing/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  if (o.newCustomer) {
    await page.getByRole("button", { name: "New customer" }).click();
    await page.getByLabel("Customer name").fill(o.newCustomer.name);
    await page.getByLabel("Phone number").fill(o.newCustomer.phone);
  } else {
    await page.getByRole("button", { name: /^Search customer/ }).click();
    await page.getByRole("button", { name: o.customer ?? /^Sharma Studio/ }).first().click();
  }
  await page.getByRole("button", { name: "Next" }).click();
  if (o.eventName) await page.getByLabel("Event name").fill(o.eventName);
  await page.getByLabel("Event date").fill("2026-12-12");
  if (o.photosGiven) await page.getByLabel("Photos given").fill(o.photosGiven);
  await page.getByRole("button", { name: "Next" }).click();
  const albums = o.albums ?? [{ name: "Wedding album" }];
  for (const [i, a] of albums.entries()) {
    if (i > 0) await page.getByRole("button", { name: "Add another album" }).click();
    const box = page.getByTestId(`album-${i + 1}`);
    await box.getByLabel("Album name").fill(a.name);
    await box.getByLabel("Sheets").fill(String(a.sheets ?? 30));
    await box.getByLabel("Copies").fill(String(a.copies ?? 1));
    await box.getByLabel("Size").selectOption(a.size ?? "12x36");
    if (a.cover) await box.getByLabel("Cover").selectOption({ label: a.cover });
    if (a.box) await box.getByLabel("Box").selectOption({ label: a.box });
  }
  await page.getByRole("button", { name: "Next" }).click();                 // → Invoice
  if (o.discountPct) { await page.getByLabel("Discount type").selectOption("percent"); await page.getByLabel("Discount value").fill(o.discountPct); }
  await page.getByRole("button", { name: "Next" }).click();                 // → Finalize
  if (o.finalize === false) return undefined;
  await page.getByRole("button", { name: /^Finalize/ }).click();
  await expect(page.getByTestId("finalized")).toBeVisible();
  const href = await page.getByRole("link", { name: "Open the order" }).getAttribute("href");
  return href?.split("/").pop();
}
