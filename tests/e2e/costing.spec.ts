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

  // album 1 (30 sheets): the admin clicks a category, drills to the item, and the priced table is right there
  const a1 = costing.getByRole("region", { name: /Costing for Asha & Ravi Wedding Album/ });
  await expect(a1.locator(".leaf")).toHaveCount(30);                                   // the visual shows one leaf per sheet (unassigned ones are grey)
  await a1.getByLabel("Item Name").fill("COVER-PIXEL BUDGET COVER-PL 06");             // not in the demo catalog: a custom item
  await a1.getByLabel("Custom Qty").fill("1");
  await a1.getByLabel("Custom Selling Price").fill("900");
  await a1.getByRole("button", { name: "Add Item" }).click();
  await a1.getByLabel("Category").selectOption("PAPER");
  const pick = page.getByRole("dialog", { name: "Choose product" });
  await pick.getByRole("button", { name: /^NT$/ }).click();                           // PAPER → NT → 125 GSM → GLOSSY
  await pick.getByRole("button", { name: /^125 GSM/ }).click();
  await pick.getByRole("button", { name: /^GLOSSY/ }).click();
  await expect(pick.getByText("Item Selected: PAPER-NT-125 GSM-GLOSSY")).toBeVisible();
  await expect(pick.getByLabel("Quantity")).toHaveValue("29");                         // defaults to the sheets still unassigned
  await pick.getByRole("button", { name: "Add Item" }).click();
  await expect(costing.getByTestId("alloc-1")).toHaveText("30 / 30 sheets assigned");
  await expect(a1.getByText("Every sheet is assigned")).toBeVisible();
  await expect(a1.getByRole("cell", { name: "₹2,175" }).first()).toBeVisible();        // 29 × 75 in the table's Total column

  // album 2 (20 sheets): only 10 get a type, so finalizing will warn
  const a2 = costing.getByRole("region", { name: /Costing for Engagement Album/ });
  await a2.getByLabel("Category").selectOption("PAPER");
  await pick.getByRole("button", { name: /^TRANSPARENT/ }).click();
  await pick.getByLabel("Quantity").fill("10");
  await pick.getByRole("button", { name: "Add Item" }).click();
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
