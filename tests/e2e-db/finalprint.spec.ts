import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Album Designing locks a REAL uploaded print-ready file (no placeholder), only after the client approved.
test("admin uploads the print-ready file, locks it, and the order moves to Final Approval", async ({ page }) => {
  const tag = Date.now().toString(36);
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Final Print ${tag}', '9${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0];
  const [oid, code] = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending') returning id || '|' || code`).split("\n")[0]!.split("|");
  sql(`select advance_order('${oid}', 'client_review', 'fixture', true)`);
  sql(`insert into proofs(order_id, token_hash, expires_at, status, approved_by, responded_at, version) values ('${oid}', '${(tag + "0".repeat(64)).slice(0, 64).replace(/[^0-9a-f]/g, "a")}', now() + interval '30 days', 'approved', 'Final Print Client', now(), 1)`);

  await loginAs(page, "admin");
  await page.goto(`/designing/${code}`);
  await page.getByRole("button", { name: "Approve for print (lock)" }).click();
  await expect(page.getByText("Upload the print-ready file first").first()).toBeVisible();      // nothing is invented for you
  expect(sql(`select stage from orders where id = '${oid}'`)).toBe("client_review");

  await page.getByLabel("Upload final print file").setInputFiles({ name: `${code}-final.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% print-ready test file\n".repeat(50)) });
  await expect(page.getByTestId("final-print-files").getByText(`${code}-final.pdf v1`)).toBeVisible();
  await expect.poll(() => sql(`select count(*) from order_files where order_id = '${oid}' and category = 'final_print'`), { timeout: 15_000 }).toBe("1");
  await page.getByRole("button", { name: "Approve for print (lock)" }).click();
  await expect(page.getByTestId("lock-badge")).toBeVisible();
  expect(sql(`select stage from orders where id = '${oid}'`)).toBe("final_approval");
  expect(sql(`select state from order_files where order_id = '${oid}' and category = 'final_print'`)).toBe("locked");
  expect(sql(`select count(*) from storage.objects where name like '${code}/%'`)).toBe("1");        // the bytes really are in storage
});
