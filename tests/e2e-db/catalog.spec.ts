import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Product catalog + album costing against the real database: the admin keeps the catalog, reception records only the sheets,
// the admin splits the album into priced lines, finalizes (the server sets the total) and generates the invoice.
const TAG = String(Date.now());
const PRODUCT = `BOX-DB TEST ${TAG}`;

test("admin maintains the catalog, costs a reception order, finalizes and invoices it", async ({ page, browser }) => {
  await loginAs(page, "admin");
  await page.goto("/masters");
  await page.getByText("Product Catalog", { exact: true }).first().click();
  await page.getByRole("button", { name: "Add product" }).click();
  await page.getByLabel("Product name").fill(PRODUCT);
  await page.getByLabel("Sell price", { exact: true }).fill("1200");
  await page.getByLabel("Expected cost").fill("900");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(PRODUCT)).toBeVisible();
  expect(sql(`select sell_price || ':' || category from catalog_items where name = '${PRODUCT}'`)).toBe("1200.00:BOX");
  expect(sql(`select cost_price from catalog_costs where item_id = (select id from catalog_items where name = '${PRODUCT}')`)).toBe("900.00");

  // reception: customer + one album with 30 sheets, no prices
  const ctx = await browser.newContext(); const rp = await ctx.newPage();
  await loginAs(rp, "reception");
  await rp.goto("/orders");
  await rp.getByRole("button", { name: "Create Order" }).first().click();
  const dlg = rp.getByRole("dialog", { name: "New Order" });
  await dlg.getByRole("button", { name: /^Customer/ }).click();
  await rp.getByPlaceholder("Type to search…").fill(`Costing Spec ${TAG}`);
  await rp.getByRole("button", { name: /Add new customer/ }).last().click();
  await dlg.getByPlaceholder("Mobile number").fill(`9${TAG.slice(-9)}`);
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByLabel("No. of Sheets").fill("30");
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("button", { name: "Create Order" }).click();
  await expect(rp).toHaveURL(/\/orders\/IDP\d+$/, { timeout: 20_000 });
  const code = rp.url().split("/").pop()!;
  await expect(rp.getByText("Costing is pending")).toBeVisible();                       // reception cannot cost it
  expect(sql(`select total from orders where code = '${code}'`)).toBe("0.00");
  await ctx.close();

  // admin costs it
  await page.goto(`/orders/${code}`);
  const costing = page.getByTestId("costing");
  await costing.getByRole("button", { name: "Add from catalog" }).click();
  const pick = page.getByRole("dialog", { name: "Choose product" });
  await pick.getByRole("button", { name: /^BOX/ }).click();
  await pick.getByRole("button", { name: /DB TEST/ }).click();
  await pick.getByLabel("Quantity").fill("2");
  await pick.getByRole("button", { name: "Add Item" }).click();
  await costing.getByRole("button", { name: "Add custom item" }).click();
  await costing.getByLabel("Item name").last().fill("PAPER-DB SHEETS");
  await costing.getByLabel(/^Quantity of PAPER-DB/).fill("30");
  await costing.getByLabel(/^Selling price of PAPER-DB/).fill("80");
  await costing.getByLabel(/^Purchase price of PAPER-DB/).fill("60");
  await costing.getByRole("checkbox").last().check();
  await costing.getByLabel("Design charge (₹)").fill("0");
  await expect(costing.getByTestId("alloc-1")).toHaveText("30 / 30 sheets assigned");
  await page.getByRole("button", { name: "Save costing" }).click();
  await expect(page.getByText("Costing saved").first()).toBeVisible();
  // 2 × 1200 + 30 × 80 = 4800; GST 18% = 864; total 5664
  await expect(costing.getByTestId("costing-totals")).toContainText("₹5,664");
  const oid = sql(`select id from orders where code = '${code}'`);
  expect(sql(`select count(*) from album_lines where order_id = '${oid}'`)).toBe("2");
  expect(sql(`select cost_price from album_line_costs where line_id = (select id from album_lines where order_id = '${oid}' and name = 'PAPER-DB SHEETS')`)).toBe("60.00");
  expect(sql(`select name || ':' || sell_price from album_lines where order_id = '${oid}' and item_id is not null`)).toBe(`${PRODUCT}:1200.00`);

  await page.getByRole("button", { name: "Finalize costing" }).click();
  await expect(page.getByText(/Costing finalized: order total ₹5,664/).first()).toBeVisible();
  expect(sql(`select total from orders where id = '${oid}'`)).toBe("5664.00");
  expect(sql(`select finalized_at is not null from order_costing where order_id = '${oid}'`)).toBe("t");

  await costing.getByRole("button", { name: "Generate invoice(s)" }).click();
  await expect(page.getByText("Invoice created as a draft").first()).toBeVisible();
  expect(sql(`select count(*) from invoices where order_id = '${oid}' and kind = 'invoice'`)).toBe("1");
  expect(sql(`select total from invoices where order_id = '${oid}'`)).toBe("5664.00");

  await page.reload();                                                                    // the costing comes back from the database, locked
  await expect(page.getByTestId("costing-totals")).toContainText("₹5,664");
  await expect(page.getByRole("button", { name: "Reopen costing" })).toBeVisible();
});
