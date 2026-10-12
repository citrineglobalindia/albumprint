import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loginAs, sql } from "./helpers";

// Files above 6 MB go up through the resumable (TUS) endpoint in 6 MB chunks; the stored bytes must match exactly.
test("a 14 MB print file uploads in chunks and is stored byte-for-byte", async ({ page }) => {
  const tag = Date.now().toString(36);
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('Big Upload ${tag}', '9${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0];
  const code = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, 1000, 'pending') returning code`).split("\n")[0]!;
  const buf = Buffer.alloc(14 * 1024 * 1024 + 123);
  for (let i = 0; i + 4 <= buf.length; i += 4) buf.writeUInt32LE((i * 2654435761) >>> 0, i);             // deterministic, non-compressible
  const sha = createHash("sha256").update(buf).digest("hex");

  const tusPosts: string[] = [], tusPatches: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/upload/resumable")) (r.method() === "POST" ? tusPosts : r.method() === "PATCH" ? tusPatches : []).push(r.url()); });
  await loginAs(page, "admin");
  await page.goto(`/orders/${code}`);
  await page.getByTestId("file-input").setInputFiles({ name: `${code}-big.pdf`, mimeType: "application/pdf", buffer: buf });
  await expect.poll(() => sql(`select count(*) from order_files where order_id = (select id from orders where code = '${code}')`), { timeout: 60_000 }).toBe("1");
  expect(tusPosts.length).toBe(1);                                                                  // created once
  expect(tusPatches.length).toBeGreaterThanOrEqual(2);                                              // several 6 MB chunks, not one request
  const row = sql(`select storage_path || '|' || size_bytes || '|' || coalesce(checksum, '') from order_files where order_id = (select id from orders where code = '${code}')`).split("|");
  expect(Number(row[1])).toBe(buf.length);
  const dir = process.env.STORAGE_DIR ?? join(process.cwd(), "supabase/local/.storage", String(process.env.API_PORT ?? 54321));
  const stored = readFileSync(join(dir, "order-files", ...row[0]!.split("/")));
  expect(createHash("sha256").update(stored).digest("hex")).toBe(sha);
  expect(row[2]).toBe(sha);                                                                          // the register's checksum agrees
});
