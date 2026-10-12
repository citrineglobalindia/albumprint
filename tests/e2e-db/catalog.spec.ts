import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// The product catalog and order items against the real database: the admin maintains products; New Order prices items from them.
const TAG = String(Date.now());
const PRODUCT = `BOX-DB TEST ${TAG}`;

test("admin adds a product (cost stays admin-only); reception orders it and the server stores the catalog price", async ({ page, browser }) => {
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

  const ctx = await browser.newContext(); const rp = await ctx.newPage();
  await loginAs(rp, "reception");
  await rp.goto("/orders");
  await rp.getByRole("button", { name: "Create Order" }).first().click();
  const dlg = rp.getByRole("dialog", { name: "New Order" });
  await dlg.getByRole("button", { name: /^Customer/ }).click();
  await rp.getByPlaceholder("Type to search…").fill(`Item Spec ${TAG}`);
  await rp.getByRole("button", { name: /Add new customer/ }).last().click();
  await dlg.getByPlaceholder("Mobile number").fill(`9${TAG.slice(-9)}`);
  for (let i = 0; i < 3; i++) await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByLabel("Item category").selectOption("BOX");
  await dlg.getByText("Search products…").click();
  await rp.getByRole("button", { name: /DB TEST/ }).last().click();
  await dlg.getByLabel("Quantity", { exact: true }).fill("2");
  await dlg.getByRole("button", { name: "Add item" }).click();
  for (let i = 0; i < 2; i++) await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("button", { name: "Create Order" }).click();
  await expect(rp).toHaveURL(/\/orders\/IDP\d+$/, { timeout: 20_000 });
  await expect(rp.getByText("Order Items · 1")).toBeVisible();
  const code = rp.url().split("/").pop()!;
  expect(sql(`select name || ':' || qty || ':' || sell_price from order_items where order_id = (select id from orders where code = '${code}')`)).toBe(`${PRODUCT}:2.00:1200.00`);
  await rp.reload();
  await expect(rp.getByText("Order Items · 1")).toBeVisible();     // items come back from the database
  await ctx.close();
});
