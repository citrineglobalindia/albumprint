import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loginAs, sql } from "./helpers";

// The order builder against the real database: server-side pricing, drafts, idempotent finalize, invoice snapshot, payments, history, reopen.
// Test catalog (created here, labelled with the run's tag): printing ₹5/sheet (12x36 = ₹10) · design ₹4/sheet · cover ₹300 · lamination ₹2/sheet · packing ₹100 per order.
const TAG = String(Date.now()).slice(-7);
const next = (p: Page) => p.getByRole("button", { name: "Next" }).click();

test.beforeAll(() => {
  sql(`update pricing_settings set tax_enabled = false`);
  sql(`update cat_items set active = false where option_kind in ('printing', 'design') and active`);
  sql(`insert into cat_categories(name) values ('Printing ${TAG}'), ('Design ${TAG}'), ('Covers ${TAG}'), ('Finishing ${TAG}'), ('Charges ${TAG}')`);
  sql(`insert into cat_categories(parent_id, name) select id, 'Lamination' from cat_categories where name = 'Finishing ${TAG}'`);
  sql(`insert into cat_items(category_id, name, pricing_method, unit, option_kind, rate) select id, 'Printing ${TAG}', 'per_sheet', 'sheet', 'printing', 5 from cat_categories where name = 'Printing ${TAG}'`);
  sql(`insert into cat_rates(item_id, size, rate) select id, '12x36', 10 from cat_items where name = 'Printing ${TAG}'`);
  sql(`insert into cat_items(category_id, name, pricing_method, unit, option_kind, rate) select id, 'Design ${TAG}', 'per_sheet', 'sheet', 'design', 4 from cat_categories where name = 'Design ${TAG}'`);
  sql(`insert into cat_items(category_id, name, pricing_method, unit, option_kind, rate) select id, 'Cover ${TAG}', 'per_unit', 'pcs', 'cover', 300 from cat_categories where name = 'Covers ${TAG}'`);
  sql(`insert into cat_items(category_id, name, pricing_method, unit, rate) select id, 'Matte lamination ${TAG}', 'per_sheet', 'sheet', 2 from cat_categories where name = 'Lamination' and parent_id = (select id from cat_categories where name = 'Finishing ${TAG}')`);
  sql(`insert into cat_items(category_id, name, pricing_method, unit, rate) select id, 'Packing ${TAG}', 'one_time_order', 'order', 100 from cat_categories where name = 'Charges ${TAG}'`);
});

test("reception builds a two-album order; the server prices, numbers and stores it once; payments, history and an authorized edit work", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await loginAs(page, "reception");
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await next(page);
  await page.getByRole("button", { name: "New customer" }).click();
  await page.getByLabel("Customer name").fill(`Builder ${TAG}`); await page.getByLabel("Phone number").fill(`9${String(Date.now()).slice(-9)}`);
  await page.getByLabel("Address").fill("12 MG Road"); await next(page);
  await page.getByLabel("Other event").fill(`Couple ${TAG}`); await page.getByLabel("Other event").press("Enter"); await page.getByLabel("Event date").fill("2026-12-20");
  await page.getByLabel("Work Group").selectOption("Photo Book"); await next(page);

  const a1 = page.getByTestId("album-1");
  await a1.getByLabel("Sheets").fill("30");
  await a1.getByLabel("Album name").fill("Wedding album"); await a1.getByLabel("Copies").fill("2"); await a1.getByLabel("Size").selectOption("12x36");
  await a1.getByLabel("Cover").selectOption({ label: `Cover ${TAG}` });
  const p1 = page.getByTestId("picker-1");
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: `Finishing ${TAG}` }); await p1.getByLabel("Subcategory").selectOption({ label: "Lamination" });
  await p1.getByLabel("Item").selectOption({ label: `Matte lamination ${TAG}` }); await p1.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("album-total-1")).toHaveText("₹1,560");           // (30×10 + 30×4 + 300 + 30×2) × 2
  await page.getByRole("button", { name: "Add another album" }).click();
  const a2 = page.getByTestId("album-2");
  await a2.getByLabel("Album name").fill("Engagement album"); await a2.getByLabel("Sheets").fill("20"); await a2.getByLabel("Size").selectOption("8x12");
  await expect(page.getByTestId("album-total-2")).toHaveText("₹180");             // 20×5 + 20×4
  const oc = page.getByTestId("order-charge-picker");
  await oc.getByLabel("Category", { exact: true }).selectOption({ label: `Charges ${TAG}` }); await oc.getByLabel("Item").selectOption({ label: `Packing ${TAG}` }); await oc.getByRole("button", { name: "Add" }).click();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved").first()).toBeVisible();
  expect(sql(`select count(*) from order_drafts where title like 'Builder ${TAG}%' and result is null`)).toBe("1");
  await next(page);
  await page.getByLabel("Discount type").selectOption("percent"); await page.getByLabel("Discount value").fill("10");
  await expect(page.getByTestId("final-amount")).toHaveText("₹1,656");            // 1,840 − 10%
  await expect(page.getByTestId("server-check")).toContainText("Verified by the server");
  await next(page);
  await page.getByRole("button", { name: /^Finalize order/ }).dblclick();
  await expect(page.getByTestId("finalized")).toBeVisible({ timeout: 30_000 });
  const inv1 = (await page.getByTestId("done-invoice").textContent())!;
  const code = (await page.getByRole("link", { name: "Open the order" }).getAttribute("href"))!.split("/").pop()!;
  const oid = sql(`select id from orders where code = '${code}'`);

  // stored once, with proper relationships
  expect(sql(`select count(*) from orders o join customers c on c.id = o.customer_id where c.studio_name = 'Builder ${TAG}'`)).toBe("1");
  expect(sql(`select count(*) || ':' || min(number) || ':' || min(status) || ':' || min(total) from invoices where order_id = '${oid}'`)).toBe(`1:${inv1}:sent:1656.00`);
  expect(sql(`select total || ':' || work_group || ':' || event_name from orders where id = '${oid}'`)).toBe(`1656.00:Photo Book:Couple ${TAG}`);
  expect(sql(`select string_agg(position || ':' || title || ':' || copies || ':' || pages, ',' order by position) from order_albums where order_id = '${oid}'`)).toBe("1:Wedding album:2:30,2:Engagement album:1:20");
  expect(sql(`select count(*) from order_charge_lines where order_id = '${oid}'`)).toBe("7");                        // 4 + 2 + 1
  expect(sql(`select string_agg(scope, ',' order by album_position nulls last, position) from order_charge_lines where order_id = '${oid}'`)).toBe("copy,copy,copy,copy,copy,copy,order");
  expect(sql(`select status || ':' || revision || ':' || discount_amount from order_pricing where order_id = '${oid}'`)).toBe("finalized:1:184.00");
  expect(sql(`select snapshot->'customer'->>'address' from invoices where order_id = '${oid}'`)).toBe("12 MG Road");
  expect(sql(`select count(*) from invoice_lines where invoice_id = (select id from invoices where order_id = '${oid}') and section = 'Engagement album'`)).toBe("2");

  // admin: payments reduce the balance; the PDF downloads; a catalog change does not touch the order
  sql(`insert into payments(receipt_no, order_id, amount, mode) values ('pending', '${oid}', 500, 'cash')`);
  const ap = await (await browser.newContext()).newPage();
  await loginAs(ap, "admin");
  await ap.goto(`/orders/${code}`);
  const panel = ap.getByTestId("order-pricing");
  await expect(panel.getByTestId("final-amount")).toHaveText("₹1,656");
  await expect(panel.getByTestId("balance")).toHaveText("₹1,156");
  const [dl] = await Promise.all([ap.waitForEvent("download"), ap.getByRole("button", { name: "PDF", exact: true }).click()]);
  expect(readFileSync((await dl.path())!).subarray(0, 4).toString()).toBe("%PDF");
  sql(`update cat_rates set rate = 99 where item_id = (select id from cat_items where name = 'Printing ${TAG}') and size = '12x36'`);
  await ap.reload();
  await expect(ap.getByTestId("order-pricing").getByTestId("final-amount")).toHaveText("₹1,656");
  expect(sql(`select rate from order_charge_lines where order_id = '${oid}' and kind = 'printing' and album_position = 1`)).toBe("10.00");

  // authorized edit
  await ap.getByRole("button", { name: "Edit (reopen)" }).click();
  await ap.getByLabel("Reason for reopening").fill("one more engagement copy");
  await ap.getByRole("button", { name: "Reopen for editing" }).click();
  await expect(ap).toHaveURL(/\/orders\/new\?draft=/);
  await ap.getByRole("button", { name: /Albums & items/ }).click();
  await ap.getByRole("tab", { name: /^Engagement album/ }).click();
  await ap.getByTestId("album-2").getByLabel("Copies").fill("2");
  await ap.getByRole("button", { name: /Finalize/ }).first().click();
  await ap.getByRole("button", { name: /Finalize changes/ }).click();
  await expect(ap.getByTestId("finalized")).toContainText("revision 2", { timeout: 30_000 });
  // album 1 now prices printing at ₹99 (the catalog changed): (30×99+120+300+60)×2 + (20×5+20×4)×2 + 100 = 6,900+360+100 = 7,360 − 10% = 6,624
  expect(sql(`select string_agg(status, ',' order by created_at) from invoices where order_id = '${oid}'`)).toBe("void,sent");
  expect(sql(`select total from orders where id = '${oid}'`)).toBe("6624.00");
  expect(sql(`select status || ':' || revision from order_pricing where order_id = '${oid}'`)).toBe("finalized:2");
  expect(sql(`select count(*) from payments where order_id = '${oid}'`)).toBe("1");
  expect(sql(`select count(*) from order_charge_lines where order_id = '${oid}' and revision = 1`)).toBe("7");
  sql(`update cat_rates set rate = 10 where item_id = (select id from cat_items where name = 'Printing ${TAG}') and size = '12x36'`);
});

test("missing price blocks finalizing, and the catalog admin writes the hierarchy to the database", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Category", exact: true }).click();
  await page.getByLabel("Category name").fill(`Extras ${TAG}`); await page.getByRole("button", { name: "Save category" }).click();
  await page.getByRole("button", { name: "Add subcategory" }).click();
  await page.getByLabel("Category name").fill("Unpriced"); await page.getByRole("button", { name: "Save category" }).click();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Item name").fill(`No price ${TAG}`); await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.getByText("Item added").first()).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
  expect(sql(`select c.depth || ':' || i.pricing_method || ':' || coalesce(i.rate::text, 'none') from cat_items i join cat_categories c on c.id = i.category_id where i.name = 'No price ${TAG}'`)).toBe("2:per_unit:none");
  await page.getByRole("button", { name: "Category", exact: true }).click();
  await page.getByLabel("Category name").fill(`extras ${TAG}`); await page.getByRole("button", { name: "Save category" }).click();
  await expect(page.getByRole("alert")).toContainText("already exists");

  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Album Printing Only/ }).click(); await next(page);
  await page.getByRole("button", { name: "New customer" }).click();
  await page.getByLabel("Customer name").fill(`Party ${TAG}`); await page.getByLabel("Phone number").fill(`8${String(Date.now()).slice(-9)}`); await next(page);
  await page.getByLabel("Event date").fill("2026-12-20"); await next(page);
  await page.getByTestId("album-1").getByLabel("Album name").fill("Party album"); await page.getByTestId("album-1").getByLabel("Sheets", { exact: true }).fill("30");
  const p1 = page.getByTestId("picker-1");
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: `Extras ${TAG}` }); await p1.getByLabel("Subcategory").selectOption({ label: "Unpriced" });
  await p1.getByLabel("Item").selectOption({ label: `No price ${TAG}` }); await p1.getByRole("button", { name: "Add" }).click();
  await expect(page.getByLabel(`Price of No price ${TAG}`)).toHaveAttribute("placeholder", "Not set");
  await next(page); await next(page);
  await expect(page.getByTestId("blocking")).toContainText("price not configured");
  await expect(page.getByRole("button", { name: /^Finalize order/ })).toBeDisabled();
  // a price typed on the line and a line discount: the server agrees on the total
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await page.getByLabel(`Price of No price ${TAG}`).fill("20");
  await page.getByLabel(`Discount on No price ${TAG}`).fill("5");
  await page.getByLabel(`Discount type for No price ${TAG}`).selectOption("percent");
  await page.getByRole("button", { name: /^(5\s*)?Invoice$/ }).click();
  await expect(page.getByTestId("server-check")).toContainText("Verified by the server", { timeout: 15_000 });
});
