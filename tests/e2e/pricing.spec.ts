import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

// Pricing Rules: admin-managed option lists feed the New Order dropdowns.
test("admin-managed work groups appear in the New Order dropdown", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/masters");
  await page.getByText("Pricing Rules", { exact: true }).first().click();
  await page.getByLabel("New Work groups name").fill("Studio Special");
  await page.getByLabel("Add Work groups").click();
  await page.getByTestId("pricing-save").click();

  await page.goto("/orders");
  await page.getByRole("button", { name: "Create Order" }).first().click();
  const dlg = page.getByRole("dialog", { name: "New Order" });
  await dlg.getByRole("button", { name: /^Customer/ }).click();
  await page.getByRole("button", { name: "Sharma Studio Rahul Sharma · +91 98765 43210", exact: true }).click();
  await dlg.getByRole("button", { name: "Next" }).click();
  await expect(dlg.getByLabel("Work Group").locator("option", { hasText: "Studio Special" })).toHaveCount(1);
});
