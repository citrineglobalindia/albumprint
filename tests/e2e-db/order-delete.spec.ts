import { test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loginAs, sql } from "./helpers";

const newOrder = (name: string) => {
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('${name}', '6${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0];
  return sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending') returning code`).split("\n")[0]!;
};

test("admin deletes an order permanently: it, its files (rows and stored bytes) are gone and the audit keeps the reason", async ({ page }) => {
  const code = newOrder(`Delete ${Date.now().toString(36)}`);
  await loginAs(page, "admin");
  await page.goto(`/orders/${code}`);
  await page.getByTestId("file-input").setInputFiles({ name: "photo.jpg", mimeType: "image/jpeg", buffer: Buffer.from("jpeg bytes for the delete test") });
  await expect.poll(() => sql(`select count(*) from order_files where order_id = (select id from orders where code = '${code}')`)).toBe("1");
  const path = sql(`select storage_path from order_files where order_id = (select id from orders where code = '${code}')`);
  const dir = process.env.STORAGE_DIR ?? join(process.cwd(), "supabase/local/.storage", String(process.env.API_PORT ?? 54321));
  const disk = join(dir, "order-files", ...path.split("/"));
  expect(existsSync(disk)).toBe(true);

  await page.getByRole("button", { name: "Delete order" }).click();
  const dlg = page.getByTestId("reason-dialog");
  await dlg.getByTestId("reason-input").fill("Test order created by mistake");
  await expect(dlg.getByTestId("reason-confirm")).toBeDisabled();                // must type the order ID
  await dlg.getByTestId("confirm-text").fill(code.toLowerCase());
  await dlg.getByTestId("reason-confirm").click();
  await expect(page).toHaveURL(/\/orders$/);
  await expect(page.getByText(`${code} deleted`).first()).toBeVisible();
  expect(sql(`select count(*) from orders where code = '${code}'`)).toBe("0");
  expect(sql(`select count(*) from order_files where storage_path = '${path}'`)).toBe("0");
  expect(sql(`select count(*) from storage.objects where name = '${path}'`)).toBe("0");
  expect(existsSync(disk)).toBe(false);
  expect(sql(`select reason from audit_log where entity = 'orders' and action = 'delete' and old_data->>'code' = '${code}'`)).toBe("Order deleted: Test order created by mistake");
  await expect(page.getByRole("link", { name: code })).toHaveCount(0);
});

test("an order with a recorded payment cannot be deleted, and only admins see the option", async ({ browser }) => {
  const code = newOrder(`Paid ${Date.now().toString(36)}`);
  sql(`insert into payments(order_id, amount, mode, reference) values ((select id from orders where code = '${code}'), 100, 'upi', 'UTR${Date.now()}')`);
  const admin = await (await browser.newContext({ baseURL: page0(browser) })).newPage();
  await loginAs(admin, "admin");
  await admin.goto(`/orders/${code}`);
  await admin.getByRole("button", { name: "Delete order" }).click();
  await admin.getByTestId("reason-input").fill("try"); await admin.getByTestId("confirm-text").fill(code); await admin.getByTestId("reason-confirm").click();
  await expect(admin.getByText(/has recorded payments and cannot be deleted/).first()).toBeVisible();
  expect(sql(`select count(*) from orders where code = '${code}'`)).toBe("1");

  const rec = await (await browser.newContext({ baseURL: page0(browser) })).newPage();
  await loginAs(rec, "reception");
  await rec.goto(`/orders/${code}`);
  await expect(rec.getByRole("heading", { name: new RegExp(code) }).first()).toBeVisible();
  await expect(rec.getByRole("button", { name: "Delete order" })).toHaveCount(0);
});
const page0 = (_b: unknown) => `http://localhost:${Number(process.env.E2E_PORT ?? 5190)}`;
