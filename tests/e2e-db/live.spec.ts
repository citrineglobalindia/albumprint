import { test, expect } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loginAs, sql } from "./helpers";

// Changes made by someone else show up on an open screen without a reload. The local stand-in has no Realtime server,
// so this exercises the fallback (auto-refresh every 10 s); in production Supabase Realtime pushes the same reload at once.
test("another person's change appears on an open screen without reloading", async ({ page }) => {
  const tag = Date.now().toString(36);
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Live ${tag}', '9${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending') returning code`).split("\n")[0]!;
  await loginAs(page, "admin");
  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("step-new_order")).toHaveAttribute("data-state", "current");
  await expect(page.getByTestId("live-badge")).toHaveAttribute("data-state", /live|polling/, { timeout: 15_000 });
  // someone else moves the order (straight in the database, as another session would)
  sql(`select set_config('app.via_fn', '1', false); update orders set stage = 'files_received' where code = '${code}'`);
  await expect(page.getByTestId("step-files_received")).toHaveAttribute("data-state", "current", { timeout: 30_000 });
  await expect(page.getByTestId("step-new_order")).toHaveAttribute("data-state", "done");
});

test("a file over the upload limit is refused at once with the limit, and nothing is logged as uploaded", async ({ page }) => {
  const tag = Date.now().toString(36);
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Limit ${tag}', '8${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending') returning code`).split("\n")[0]!;
  await loginAs(page, "admin");
  await page.goto(`/orders/${code}`);
  const big = join(tmpdir(), `huge-${tag}.tif`); writeFileSync(big, Buffer.alloc(51 * 1024 * 1024));
  await page.getByTestId("file-input").setInputFiles(big);
  await expect(page.getByText(/huge-.*\.tif is 51(\.0)? MB — the limit is 50 MB per file/).first()).toBeVisible();
  expect(sql(`select count(*) from order_files where order_id = (select id from orders where code = '${code}')`)).toBe("0");
});
