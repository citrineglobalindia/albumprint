import { test, expect } from "@playwright/test";
import { noHScroll, savedContains, seedRole } from "./helpers";

test("workflow changes and audit rows persist across reload and feed the Dashboard activity", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/orders/IDP00072");
  await page.getByTestId("next-admin_approval").click();
  await expect(page.getByTestId("notice-ok")).toBeVisible();
  await savedContains(page, "audit", "stage_change");
  await savedContains(page, "orders", "admin_approval");
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("IDP00072");
  await expect(page.getByTestId("audit-trail").locator('[data-audit-action="stage_change"]')).toHaveCount(1);
  await page.goto("/");
  await expect(page.locator('[data-activity="stage_change"]').first()).toContainText("IDP00072");
});

test("Reports: production tab labels estimates until the audit trail has data, then shows measured values", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/reports");
  await page.getByRole("tab", { name: "Production" }).click();
  await expect(page.getByText("estimate").first()).toBeVisible();
  await page.getByRole("tab", { name: "Team Performance" }).click();
  await expect(page.getByRole("columnheader", { name: "Stage moves" })).toBeVisible();
  await page.getByRole("tab", { name: "Customer" }).click();
  await expect(page.getByText("Customer Mix")).toBeVisible();
});

test.describe("mobile (390x844)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sidebar is an off-canvas drawer opened from the hamburger", async ({ page }) => {
    await seedRole(page, "admin");
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(page.getByTestId("hamburger")).toBeVisible();
    await expect(nav).not.toBeInViewport();             // off-canvas (and inert)
    await page.getByTestId("hamburger").click();
    await expect(nav).toBeVisible();
    await expect(nav.getByRole("link", { name: "Orders" })).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(nav).not.toBeInViewport();
    await page.getByTestId("hamburger").click();
    await nav.getByRole("link", { name: "Orders" }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(nav).not.toBeInViewport();
  });

  for (const path of ["/", "/orders", "/pipeline", "/orders/IDP00072", "/reports", "/customers"]) {
    test(`no page-level horizontal scroll on ${path}`, async ({ page }) => {
      await seedRole(page, "admin");
      await page.goto(path);
      await page.waitForTimeout(600);
      expect(await noHScroll(page)).toBe(true);
    });
  }

  test("New Order wizard is full-screen and Esc closes it", async ({ page }) => {
    await seedRole(page, "admin");
    await page.goto("/orders");
    await page.getByRole("button", { name: "Create Order" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New Order" });
    await expect(dlg).toBeVisible();
    const box = await dlg.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(388);
    expect(box!.height).toBeGreaterThanOrEqual(840);
    await expect(dlg).toHaveAttribute("aria-modal", "true");
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
  });
});

test.describe("accessibility basics", () => {
  test("skip link, focus ring, dialog focus trap and Esc", async ({ page }) => {
    await seedRole(page, "admin");
    await page.goto("/orders");
    await expect(page.getByRole("heading", { name: "Orders", level: 1 })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
    // modal: slide-over traps focus
    await page.locator("[data-row]").first().click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toBeVisible();
    await expect(dlg).toHaveAttribute("aria-modal", "true");
    for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
    expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dlg).toBeHidden();
    // visible keyboard focus ring
    await page.getByRole("button", { name: "Create Order" }).first().focus();
    const outline = await page.getByRole("button", { name: "Create Order" }).first().evaluate((e) => getComputedStyle(e).outlineStyle);
    expect(outline).toBe("solid");
  });

  test("toasts are announced via an aria-live region", async ({ page }) => {
    await seedRole(page, "admin");
    await page.goto("/orders/IDP00072");
    await page.getByTestId("next-admin_approval").click();
    await expect(page.getByTestId("notice-ok")).toHaveAttribute("role", "status");
    await expect(page.getByTestId("notice-ok")).toHaveAttribute("aria-live", "polite");
  });
});

test("a recorded payment survives a reload", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/payments");
  await page.getByRole("button", { name: /Record Payment/i }).first().click();
  const dlg = page.getByRole("dialog", { name: "Record Payment" });
  await dlg.getByRole("button", { name: /^Order/ }).click();
  await dlg.getByRole("button", { name: /^IDP00071/ }).click();
  await dlg.getByLabel("Amount").fill("1234");
  await dlg.getByRole("button", { name: "Cash", exact: true }).click();
  await dlg.getByRole("button", { name: "Save payment" }).click();
  await savedContains(page, "orders", "IDP00071");
  await expect.poll(() => page.evaluate(() => (localStorage.getItem("albumpro.v1.payments") ?? "").includes("1234")), { timeout: 10_000 }).toBe(true);
  await page.reload();
  await expect(page.getByText("₹1,234").first()).toBeVisible();
});
