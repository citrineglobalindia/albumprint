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

  // an order with one album of 30 sheets and no pricing yet (orders not created by the order builder use this classic costing)
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Costing Spec ${TAG}', '9${TAG.slice(-9)}', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 0, 'pending') returning code`).split("\n")[0]!;
  sql(`insert into order_albums(order_id, position, title, album_type, album_size, orientation, pages, copies, paper_type, cover_type, binding) select id, 1, 'Album 1', 'Premium Album', '12x36', 'landscape', 30, 1, 'Matte', 'Leatherette', 'Lay-flat' from orders where code = '${code}'`);
  const ctx = await browser.newContext(); const rp = await ctx.newPage();
  await loginAs(rp, "reception");
  await rp.goto(`/orders/${code}`);
  await expect(rp.getByText("Costing is pending")).toBeVisible();                       // reception cannot cost it
  expect(sql(`select total from orders where code = '${code}'`)).toBe("0.00");
  await ctx.close();

  // admin costs it
  await page.goto(`/orders/${code}`);
  const costing = page.getByTestId("costing");
  await costing.getByLabel("Category").selectOption("BOX");                              // click a category → drill to the product → quantity
  const pick = page.getByRole("dialog", { name: "Choose product" });
  await pick.getByRole("button", { name: new RegExp(`DB TEST ${TAG}`) }).click();
  await pick.getByLabel("Quantity").fill("2");
  await pick.getByRole("button", { name: "Add Item" }).click();
  await costing.getByLabel("Item Name", { exact: true }).fill("PAPER-DB SHEETS");                         // a custom sheet item
  await costing.getByLabel("Custom Qty").fill("30");
  await costing.getByLabel("Custom Selling Price").fill("80");
  await costing.getByLabel("Custom Purchase Price").fill("60");
  await costing.getByRole("button", { name: "Add Item" }).click();
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
  expect(sql(`select counts_sheets::text || ':' || qty from album_lines where order_id = '${oid}' and name = 'PAPER-DB SHEETS'`)).toBe("true:30.00");

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
