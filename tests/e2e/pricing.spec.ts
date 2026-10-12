import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

// The New Order total follows what the admin sets in Masters > Pricing Rules.
test("admin-set size and binding prices change the New Order total; admin-managed lists feed the dropdowns", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/masters");
  await page.getByRole("tab", { name: "Pricing Rules" }).click().catch(async () => { await page.getByText("Pricing Rules", { exact: true }).first().click(); });
  await page.getByLabel("Album sizes: 12x36").fill("1000");
  await page.getByLabel("Binding: Lay-flat").fill("500");
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
  await dlg.getByRole("button", { name: "Next" }).click();
  // default album: 12x36 + Lay-flat → +1000 +500 per copy on top of the base (pre-GST), so the total rises by 1500 × 1.18 = 1770 (18,644 → 20,414)
  await expect(dlg.getByText("₹18,644")).toHaveCount(0);
  await expect(dlg.getByText("₹20,414")).toBeVisible();
});
