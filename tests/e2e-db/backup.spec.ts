import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { loginAs, sql } from "./helpers";

test("admin downloads a full backup zip with every table and a manifest", async ({ page }) => {
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Backup Spec ${Date.now()}', '9${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0];
  sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending')`);
  await loginAs(page, "admin");
  await page.goto("/settings");
  await page.getByRole("button", { name: /^Backups/ }).first().click();
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByTestId("backup-now").click()]);
  const path = `${tmpdir()}/albumpro-backup-${Date.now()}.zip`;
  await dl.saveAs(path);
  const out = execFileSync("python3", ["-c", `
import sys, zipfile, json
z = zipfile.ZipFile(sys.argv[1]); names = set(z.namelist())
m = json.loads(z.read("MANIFEST.json"))
orders = json.loads(z.read("orders.json"))
print(len(names), m["app"], len(m["skipped"]), len(orders), "orders.json" in names and "customers.json" in names and "audit_log.json" in names)
`, path]).toString().trim().split(" ");
  expect(out[1]).toBe("albumpro");
  expect(Number(out[2])).toBe(0);                      // no table was skipped
  expect(Number(out[0])).toBeGreaterThan(30);          // ~38 tables + manifest
  expect(Number(out[3])).toBeGreaterThan(0);           // the orders are in there
  expect(out[4]).toBe("True");
  await expect(page.getByText(/Backup downloaded:/).first()).toBeVisible();
});
