import { test, expect, type Page } from "@playwright/test";
import { seedRole, noHScroll, type Role } from "./helpers";

// Module check: every role opens every module in its menu; each page must load without a crash, a "Page not found",
// a browser error, or an empty screen, and must show the business name in the tab title and the Stepstones credit.

const ROLES: Role[] = ["admin", "reception", "colour", "designer", "printing", "qc", "accounts"];

/** Collect uncaught page errors and console errors while a page is open. */
function watchErrors(page: Page) {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|logo\.png|Failed to load resource/i.test(m.text())) errs.push(`console: ${m.text()}`); });
  return errs;
}

async function checkPage(page: Page, path: string, errs: string[]) {
  await page.goto(path);
  const main = page.locator("#main");
  await expect(main, `${path}: main area`).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" }), `${path}: crashed`).toHaveCount(0);
  await expect(page.getByText("Page not found"), `${path}: not found`).toHaveCount(0);
  await expect.poll(async () => (await main.innerText()).trim().length, { message: `${path}: empty page` }).toBeGreaterThan(40);
  await expect(main.getByText("Developed by:"), `${path}: credit`).toBeVisible();
  await expect(page, `${path}: tab title`).toHaveTitle(/Innovative Photo Designers/);
  expect(errs, `${path}: browser errors`).toEqual([]);
}

for (const role of ROLES) {
  test(`${role}: every module in the menu opens cleanly`, async ({ page }) => {
    test.setTimeout(150_000);   // up to 25 pages in one test
    await seedRole(page, role);
    const errs = watchErrors(page);
    await page.goto("/");
    const nav = page.locator("#app-sidebar nav");
    await expect(nav.getByRole("link").first()).toBeVisible();
    const paths = [...new Set(await nav.getByRole("link").evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname)))];
    expect(paths.length, "menu items").toBeGreaterThan(0);
    for (const p of [...paths, "/account"]) await test.step(p, () => checkPage(page, p, errs));
  });
}

test("admin: order detail, customer profile, new order and a wrong address", async ({ page }) => {
  await seedRole(page, "admin");
  const errs = watchErrors(page);
  await page.goto("/orders");
  const code = (await page.locator("#main").getByText(/^IDP\d+$/).first().innerText()).trim();
  expect(code).toMatch(/^IDP\d+$/);
  await test.step("order detail", async () => {
    await checkPage(page, `/orders/${code}`, errs);
    await expect(page.locator("#main").getByText(code).first()).toBeVisible();
  });
  await page.goto("/customers");
  const custHref = await page.locator('#main a[href^="/customers/"]').first().getAttribute("href");
  expect(custHref, "a customer link on the Customers page").toBeTruthy();
  await test.step("customer profile", () => checkPage(page, custHref!, errs));
  await test.step("new order", () => checkPage(page, "/orders/new", errs));
  // a wrong address never crashes: it lands on the dashboard or a "Page not found" note
  await page.goto("/this-page-does-not-exist");
  await expect(page.getByRole("heading", { level: 1 }).or(page.getByText("Page not found")).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
});

test("admin on a phone: every module fits the screen with no sideways scrolling", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await seedRole(page, "admin");
  const errs = watchErrors(page);
  await page.goto("/");
  const paths = [...new Set(await page.locator("#app-sidebar nav").getByRole("link").evaluateAll((as) => as.map((a) => new URL((a as HTMLAnchorElement).href).pathname)))];
  const wide: string[] = [];
  for (const p of paths) {
    await page.goto(p);
    await expect(page.locator("#main")).toBeVisible();
    await page.waitForTimeout(150);
    if (!(await noHScroll(page))) wide.push(p);
  }
  expect(wide, "pages wider than the phone screen").toEqual([]);
  expect(errs).toEqual([]);
});

test("login page shows the logo, the tab icon and the Stepstones credit", async ({ page }) => {
  await page.goto("/login");
  const logo = page.getByRole("img", { name: "Innovative Photo Designers" }).first();
  await expect(logo).toBeVisible();
  await expect.poll(() => logo.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(100);   // the image really loaded
  expect(await (await page.request.get("/")).text(), "branded loader on first paint").toContain('class="ipd-loader"');
  for (const f of ["/favicon.ico", "/favicon-32.png", "/apple-touch-icon.png", "/logo.png", "/logo-full.png", "/logo-invoice.jpg"]) expect((await page.request.get(f)).status(), f).toBe(200);
  await expect(page.getByText("Developed by:")).toBeVisible();
  await expect(page.getByText("Stepstones")).toBeVisible();
  await expect(page).toHaveTitle(/Innovative Photo Designers/);
});
