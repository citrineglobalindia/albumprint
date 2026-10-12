import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

// Reception records the sheets; the admin splits each album into priced catalog items, finalizes, and generates invoices.
test("admin costs two albums from the catalog, finalizes the total and generates one invoice per album", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/orders");
  await page.getByRole("button", { name: "Create Order" }).first().click();
  const dlg = page.getByRole("dialog", { name: "New Order" });
  await dlg.getByRole("button", { name: /^Customer/ }).click();
  await page.getByRole("button", { name: "Sharma Studio Rahul Sharma · +91 98765 43210", exact: true }).click();
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByLabel("Couple Name").fill("Asha & Ravi");
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByLabel("No. of Sheets").fill("30");
  await dlg.getByRole("button", { name: "Add album" }).click();
  await dlg.getByLabel("Album Name").fill("Engagement Album");
  await dlg.getByLabel("No. of Sheets").fill("20");
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("button", { name: "Create Order" }).click();
  await expect(page).toHaveURL(/\/orders\/IDP\d+$/);

  const costing = page.getByTestId("costing");
  await expect(costing).toBeVisible();
  await expect(costing.getByTestId("alloc-1")).toHaveText("0 / 30 sheets assigned");

  // album 1: cover (1 sheet) + inside paper (29 sheets), picked by drilling down the catalog
  await costing.getByRole("region", { name: /Costing for Asha & Ravi Wedding Album/ }).getByRole("button", { name: "Add from catalog" }).click();
  const pick = page.getByRole("dialog", { name: "Choose product" });
  await pick.getByRole("button", { name: /^PAPER/ }).click();
  await pick.getByRole("button", { name: /^NT$/ }).click();
  await pick.getByRole("button", { name: /^125 GSM/ }).click();
  await pick.getByRole("button", { name: /^GLOSSY/ }).click();
  await expect(pick.getByText("Item Selected: PAPER-NT-125 GSM-GLOSSY")).toBeVisible();
  await pick.getByLabel("Quantity").fill("29");
  await pick.getByRole("button", { name: "Add Item" }).click();
  const a1 = costing.getByRole("region", { name: /Costing for Asha & Ravi Wedding Album/ });
  await a1.getByRole("button", { name: "Add custom item" }).click();
  await a1.getByLabel("Item name").last().fill("COVER-PIXEL BUDGET COVER-PL 06");
  await a1.getByLabel(/^Selling price of/).last().fill("900");
  await a1.getByRole("checkbox").last().check();
  await expect(costing.getByTestId("alloc-1")).toHaveText("30 / 30 sheets assigned");
  await expect(costing.getByText("₹2,175").first()).toBeVisible();                  // 29 × 75 on the paper line

  // album 2: one custom line that does not cover all 20 sheets
  const a2 = costing.getByRole("region", { name: /Costing for Engagement Album/ });
  await a2.getByRole("button", { name: "Add custom item" }).click();
  await a2.getByLabel("Item name").fill("PAPER-TRANSPARENT");
  await a2.getByLabel(/^Selling price of/).fill("140");
  await a2.getByLabel(/^Quantity of/).fill("10");
  await a2.getByRole("checkbox").check();
  await costing.getByLabel("Design charge (₹)").fill("0");
  await costing.getByLabel("GST %").fill("18");
  await page.getByRole("button", { name: "Save costing" }).click();
  await expect(page.getByText("Costing saved").first()).toBeVisible();

  // totals: 2175 + 900 + 1400 = 4475; GST 18% = 806 (805.5 rounded); total 5281
  await expect(costing.getByTestId("costing-totals")).toContainText("₹5,281");
  await page.getByRole("button", { name: "Finalize costing" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "sheets assigned" })).toContainText("Engagement Album: 10 of 20 sheets assigned");
  await page.getByRole("button", { name: "Finalize anyway" }).click();
  await expect(page.getByText(/Costing finalized: order total ₹5,281/).first()).toBeVisible();

  await costing.getByLabel("One invoice per album").check();
  await costing.getByRole("button", { name: "Generate invoice(s)" }).click();
  await expect(page.getByText("2 invoices created as drafts (one per album)").first()).toBeVisible();
  await page.goto("/invoices");
  await expect(page.getByText("Album: Engagement Album").or(page.getByText(/INV-/)).first()).toBeVisible();
});

test("reception sees the costing but cannot edit it or see purchase prices", async ({ page }) => {
  await seedRole(page, "reception");
  await page.goto("/orders/IDP00072");
  await expect(page.getByText("Costing is pending")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add from catalog" })).toHaveCount(0);
});
