import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

const MODULES = ["orders", "customers", "grading", "designing", "proofs", "printing", "qc", "delivery", "finance", "costing", "files", "attendance", "access", "messaging", "system"];

test("control center: health score, alerts, KPI tiles and a card for every module", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/control");
  await expect(page.getByTestId("health-score")).toHaveText(/^\d{1,3}$/);
  await expect(page.getByTestId("alerts")).toBeVisible();
  await expect(page.getByTestId("kpi-grid").locator("a")).toHaveCount(14);
  await expect(page.getByTestId("trends").locator("[data-testid^=trend-]")).toHaveCount(3);
  await expect(page.getByTestId("funnel").getByRole("listitem")).toHaveCount(11);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByTestId("updated-at")).toBeVisible();

  await page.getByRole("tab", { name: /^Modules/ }).click();
  for (const k of MODULES) {
    const card = page.getByTestId(`module-${k}`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-health", /^(ok|attention|critical)$/);
  }
});

test("every link on the module board and the alerts opens a working page", async ({ page }) => {
  test.setTimeout(240_000);
  await seedRole(page, "admin");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/control");
  await page.getByRole("tab", { name: /^Modules/ }).click();
  const hrefs = new Set<string>(await page.getByTestId("module-board").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? "")));
  await page.getByRole("tab", { name: "Overview" }).click();
  for (const h of await page.getByTestId("alerts").locator("a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) hrefs.add(h);
  expect(hrefs.size).toBeGreaterThan(10);
  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.locator("main, #main").first()).toBeVisible();
    await expect(page.getByText("Page not found")).toHaveCount(0);
    await expect(page.getByRole("heading").first()).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test("control center: approve from the inbox, manage an order, hold needs a reason, resume", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/control");
  await page.getByRole("tab", { name: /^Approvals & SLA/ }).click();
  const rows = page.getByTestId("approval-row");
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);
  await rows.first().getByRole("button", { name: "Approve" }).click();
  await expect(rows).toHaveCount(before - 1);

  await page.getByTestId("escalation-queue").getByRole("button", { name: "Manage" }).first().click();
  await expect(page.getByTestId("order-controls")).toBeVisible();
  await page.getByTestId("order-controls").getByRole("button", { name: "Hold" }).click();
  const dlg = page.getByRole("dialog", { name: "Put on hold" });
  await dlg.getByRole("button", { name: "Put on hold" }).click();
  await expect(dlg.getByRole("alert")).toContainText("required");
  await dlg.getByLabel("Reason").fill("waiting for the client");
  await dlg.getByRole("button", { name: "Put on hold" }).click();
  await expect(page.getByTestId("order-controls").getByText("On Hold", { exact: true })).toBeVisible();
  await page.getByTestId("order-controls").getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByTestId("order-controls").getByText("On Hold", { exact: true })).toHaveCount(0);

  await page.getByRole("tab", { name: "Workload & activity" }).click();
  await expect(page.getByTestId("workload")).toBeVisible();
  await expect(page.getByTestId("activity").getByText("hold").first()).toBeVisible();
});

test("non-admin roles are sent away from the control center", async ({ page }) => {
  await seedRole(page, "reception");
  await page.goto("/control");
  await expect(page).not.toHaveURL(/\/control/);
  await expect(page.getByTestId("health-score")).toHaveCount(0);
});
