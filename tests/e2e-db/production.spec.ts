import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs, sql, type Role } from "./helpers";

// Production module against the real database: printing → QC → delivery, dues gate, file bytes in Storage, locked files.
// Needs the local backend (supabase/local/start.sh) — see playwright.db.config.ts.
const PORT = Number(process.env.E2E_PORT ?? 5190);
const API_PORT = Number(process.env.API_PORT ?? 54321);
const STORE = path.resolve(process.cwd(), "supabase/local/.storage", String(API_PORT), "order-files");
const tag = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

/** A customer + order created straight in the database (as the system), moved to `stage` with an override. */
function fixtureOrder(o: { type?: "design_printing" | "printing_only"; total?: number; stage?: string } = {}): string {
  const studio = `Prod E2E ${tag()}`;
  sql(`insert into customers(studio_name, mobile, code) values ('${studio}', '9000000090', 'pending')`);
  sql(`insert into orders(customer_id, code, type, due_date, total, event_type) select id, 'pending', '${o.type ?? "printing_only"}', current_date + 20, ${o.total ?? 20000}, 'Wedding' from customers where studio_name = '${studio}'`);
  const code = sql(`select code from orders where customer_id = (select id from customers where studio_name = '${studio}')`);
  sql(`insert into order_specs(order_id, album_type, album_size, orientation, pages, paper_type, cover_type, binding) select id, 'Premium', '12x36', 'landscape', 40, 'Matte', 'Leatherette', 'Lay-flat' from orders where code = '${code}'`);
  if (o.stage) sql(`select advance_order(id, '${o.stage}', 'fixture', true) from orders where code = '${code}'`);
  return code;
}
const db = (code: string, q: string) => sql(q.replaceAll("$O", `(select id from orders where code = '${code}')`));
async function as(browser: Browser, role: Role): Promise<Page> {
  const ctx = await browser.newContext({ baseURL: `http://localhost:${PORT}` }); const page = await ctx.newPage(); await loginAs(page, role); return page;
}
const CHECKS = ["Print quality", "Colour accuracy", "Alignment & trim", "Binding", "Cover & finish", "Specification match", "Packaging"];

test.describe.configure({ mode: "serial" });

test("printing → QC (fail needs a defect, rework, pass) → delivery: dues block dispatch, admin override, proof of delivery", async ({ browser }) => {
  test.setTimeout(240_000);
  const code = fixtureOrder({ stage: "printing" });

  // ── printing: the job appears (the order reached Printing by another route), operator walks it through every stage
  const printing = await as(browser, "printing");
  await printing.goto("/printing");
  await printing.getByTestId(`pjob-${code}`).click();
  const advanceAll = async (labels: string[]) => { for (const l of labels) { await expect(printing.getByTestId("advance")).toContainText(l); await printing.getByTestId("advance").click(); } };
  await advanceAll(["File Prep", "Printing", "Finishing", "Assembly", "Packaging", "Completed", "Send to QC"]);
  await expect.poll(() => db(code, `select stage from print_jobs where order_id = $O`)).toBe("sent_to_qc");
  await expect.poll(() => db(code, `select stage from orders where id = $O`)).toBe("qc");
  expect(db(code, `select count(*) from print_stage_log where order_id = $O`)).toBe("8");        // every stage change is timestamped by the database

  // ── QC round 1: fails; a defect code is mandatory
  const qc = await as(browser, "qc");
  await qc.goto("/qc");
  await qc.getByTestId(`qc-${code}`).click();
  await qc.getByRole("button", { name: /Start inspection/ }).click();
  await expect.poll(() => db(code, `select decision from qc_inspections where order_id = $O`)).toBe("in_progress");
  for (const c of CHECKS) await qc.getByRole("button", { name: `${c} ${c === "Print quality" ? "fail" : "pass"}`, exact: true }).click();
  await qc.getByRole("button", { name: /Fail \/ Rework/ }).click();
  await qc.getByLabel("Failure reason").fill("Back cover scratched");
  await qc.getByRole("button", { name: /Confirm rework/ }).click();
  await expect(qc.getByText(/at least one defect code/i).first()).toBeVisible();
  expect(() => db(code, `update qc_inspections set decision = 'failed', reason = 'x', return_to = 'printing' where order_id = $O`)).toThrow();   // the database refuses too
  await qc.getByRole("button", { name: "Scratch", exact: true }).click();
  await qc.getByRole("button", { name: /Confirm rework/ }).click();
  await expect.poll(() => db(code, `select decision || '|' || return_to || '|' || reason || '|' || defect_codes::text from qc_inspections where order_id = $O and round = 1`)).toBe("rework|printing|Back cover scratched|{Scratch}");
  await expect.poll(() => db(code, `select stage || '|' || qc_status from orders where id = $O`)).toBe("printing|rework");

  // ── printing again (reprint), back to QC, round 2 passes
  await printing.goto("/printing");
  await printing.getByTestId(`pjob-${code}`).click();
  await expect(printing.getByTestId("advance")).toContainText("Finishing");
  expect(db(code, `select reprints from print_jobs where order_id = $O`)).toBe("1");
  await advanceAll(["Finishing", "Assembly", "Packaging", "Completed", "Send to QC"]);
  await expect.poll(() => db(code, `select stage from orders where id = $O`)).toBe("qc");
  await qc.goto("/qc");
  await qc.getByTestId(`qc-${code}`).click();
  await qc.getByRole("button", { name: /Start inspection \(round 2\)/ }).click();
  for (const c of CHECKS) await qc.getByRole("button", { name: `${c} pass`, exact: true }).click();
  await qc.getByRole("button", { name: /Pass → Ready for Delivery/ }).click();
  await expect.poll(() => db(code, `select stage || '|' || qc_status from orders where id = $O`)).toBe("ready_for_delivery|passed");
  expect(db(code, `select count(*) from qc_inspections where order_id = $O`)).toBe("2");
  expect(db(code, `select round from qc_inspections where order_id = $O and decision = 'passed'`)).toBe("2");

  // ── delivery: unpaid order cannot leave the shop
  const reception = await as(browser, "reception");
  await reception.goto("/delivery");
  await reception.getByTestId(`del-${code}`).getByRole("button", { name: "Open" }).click();
  await reception.getByRole("button", { name: "Courier", exact: true }).click();
  await reception.getByLabel("Carrier").fill("DTDC");
  await reception.getByLabel("Tracking", { exact: true }).fill("D123456");
  await reception.getByTestId("dispatch").click();
  await expect(reception.getByText(/Dispatch blocked/).first()).toBeVisible();
  await expect.poll(() => db(code, `select mode || '|' || courier || '|' || tracking_no || '|' || status from deliveries where order_id = $O`)).toBe("courier|DTDC|D123456|ready");

  // a client that was told "allow delivery without payment" still cannot get past the database's payment hold
  await reception.evaluate(() => localStorage.setItem("albumpro.settings", JSON.stringify({ deliveryNoPay: true })));
  await reception.getByTestId("dispatch").click();
  await expect(reception.getByText(/payment hold/).first()).toBeVisible();
  expect(db(code, `select status from deliveries where order_id = $O`)).toBe("ready");
  await reception.evaluate(() => localStorage.removeItem("albumpro.settings"));

  // admin overrides with a reason
  const admin = await as(browser, "admin");
  await admin.goto("/delivery");
  await admin.getByTestId(`del-${code}`).getByRole("button", { name: "Open" }).click();
  await admin.getByLabel("Dispatch override reason").fill("Customer pays on receipt");
  await admin.getByTestId("dispatch").click();
  await expect.poll(() => db(code, `select status || '|' || override_reason from deliveries where order_id = $O`)).toBe("dispatched|Customer pays on receipt");
  expect(db(code, `select delivery_status from orders where id = $O`)).toBe("dispatched");

  // proof of delivery is required, the file lands in Storage
  await reception.goto("/delivery");
  await reception.getByTestId(`del-${code}`).getByRole("button", { name: "Open" }).click();
  await reception.getByLabel("Received by").fill("Raj Kumar");
  await reception.getByTestId("mark-delivered").click();
  await expect(reception.getByText(/Proof of delivery is required/).first()).toBeVisible();
  const sig = randomBytes(2048);
  await reception.getByTestId("pod-input").setInputFiles({ name: "signature.jpg", mimeType: "image/jpeg", buffer: sig });
  await reception.getByLabel("POD note").fill("signed at the counter");
  await reception.getByTestId("mark-delivered").click();
  await expect.poll(() => db(code, `select status || '|' || received_by || '|' || proof_path from deliveries where order_id = $O`)).toBe(`delivered|Raj Kumar|${code}/other/POD-signature.jpg-v1`);
  await expect.poll(() => db(code, `select stage from orders where id = $O`)).toBe("delivered");
  expect(readFileSync(path.join(STORE, code, "other", "POD-signature.jpg-v1")).equals(sig)).toBe(true);
  expect(db(code, `select count(*) from production_events where order_id = $O and area = 'delivery'`)).not.toBe("0");
});

test("the database refuses a failed QC round without a defect code and a pass with a failed check", async () => {
  const code = fixtureOrder({ stage: "qc" });
  sql(`insert into qc_inspections(order_id, decision) select id, 'in_progress' from orders where code = '${code}'`);
  expect(() => db(code, `update qc_inspections set decision = 'failed', reason = 'x', return_to = 'printing' where order_id = $O`)).toThrow(/defect/i);
  expect(() => db(code, `update qc_inspections set decision = 'passed', checklist = '{"print":"fail","colour":"pass","align":"pass","binding":"pass","cover":"pass","spec":"pass","pack":"pass"}' where order_id = $O`)).toThrow(/Fail/);
  expect(db(code, `select qc_status from orders where id = $O`)).toBe("in_progress");
});

test("file upload stores the bytes in the private bucket, survives a reload and downloads through a signed URL", async ({ browser }) => {
  const code = fixtureOrder({ stage: "files_received" });
  const page = await as(browser, "reception");
  await page.goto("/files");
  await page.getByRole("button", { name: /Select order/ }).click();
  await page.getByPlaceholder("Type to search…").fill(code);
  await page.getByRole("button", { name: new RegExp(code) }).first().click();
  const bytes = randomBytes(4096 + 17);
  await page.getByTestId("file-input").setInputFiles({ name: "proof sheet.pdf", mimeType: "application/pdf", buffer: bytes });
  await expect(page.getByTestId("file-register")).toContainText("proof sheet.pdf");
  const where = `file_name = 'proof sheet.pdf' and order_id = (select id from orders where code = '${code}')`;
  await expect.poll(() => sql(`select count(*) from order_files where ${where}`)).toBe("1");
  expect(sql(`select size_bytes || '|' || checksum || '|' || state || '|' || version from order_files where ${where}`)).toBe(`${bytes.length}|${createHash("sha256").update(bytes).digest("hex")}|draft|1`);
  const stored = sql(`select storage_path from order_files where ${where}`);
  expect(stored).toBe(`${code}/source_photos/proof_sheet.pdf-v1`);
  expect(sql(`select count(*) from storage.objects where bucket_id = 'order-files' and name = '${stored}'`)).toBe("1");
  expect(readFileSync(path.join(STORE, ...stored.split("/"))).equals(bytes)).toBe(true);

  await page.reload();                                                       // the register is rebuilt from the database
  await page.getByPlaceholder("Search file, order, customer…").fill(code);
  const row = page.getByTestId("file-row").filter({ hasText: "proof sheet.pdf" });
  await expect(row).toHaveCount(1);
  const [dl] = await Promise.all([page.waitForEvent("download"), row.getByRole("button", { name: "Download proof sheet.pdf" }).click()]);
  expect(dl.suggestedFilename()).toBe("proof sheet.pdf");
  const got = readFileSync((await dl.path())!);
  expect(got.equals(bytes)).toBe(true);

  // a second upload under the same name is a new version, never an overwrite
  const bytes2 = randomBytes(999);
  await page.getByRole("button", { name: "Actions for proof sheet.pdf" }).click();
  await page.getByRole("menuitem", { name: "New version" }).click();
  await page.getByTestId("version-input").setInputFiles({ name: "proof sheet.pdf", mimeType: "application/pdf", buffer: bytes2 });
  await expect.poll(() => sql(`select string_agg(version::text, ',' order by version) from order_files where ${where}`)).toBe("1,2");
  expect(readFileSync(path.join(STORE, code, "source_photos", "proof_sheet.pdf-v1")).equals(bytes)).toBe(true);
  expect(readFileSync(path.join(STORE, code, "source_photos", "proof_sheet.pdf-v2")).equals(bytes2)).toBe(true);
  expect(existsSync(path.join(STORE, code, "source_photos", "proof_sheet.pdf-v2"))).toBe(true);
});

test("a locked print file is immutable: cannot be archived, replaced or deleted — a new version is a separate draft", async ({ browser }) => {
  const code = fixtureOrder({ stage: "files_received" });
  sql(`alter table proofs disable trigger proofs_guard_t`);
  sql(`insert into proofs(order_id, version, token_hash, expires_at, status) select id, 1, '${createHash("sha256").update(tag()).digest("hex")}', now() + interval '5 days', 'approved' from orders where code = '${code}'`);
  sql(`alter table proofs enable trigger proofs_guard_t`);

  const admin = await as(browser, "admin");
  await admin.goto("/files");
  await admin.getByRole("button", { name: /Select order/ }).click();
  await admin.getByPlaceholder("Type to search…").fill(code);
  await admin.getByRole("button", { name: new RegExp(code) }).first().click();
  await admin.getByLabel("Upload category").selectOption("Final Print");
  const bytes = randomBytes(3000);
  await admin.getByTestId("file-input").setInputFiles({ name: "final.pdf", mimeType: "application/pdf", buffer: bytes });
  const where = `file_name = 'final.pdf' and order_id = (select id from orders where code = '${code}')`;
  await expect.poll(() => sql(`select count(*) from order_files where ${where}`)).toBe("1");
  await admin.getByPlaceholder("Search file, order, customer…").fill(code);
  await expect(admin.getByTestId("file-row").filter({ hasText: "final.pdf" }).getByText("Draft")).toBeVisible();

  await admin.getByRole("button", { name: "Actions for final.pdf" }).click();
  await admin.getByRole("menuitem", { name: "Lock final print" }).click();
  await admin.getByRole("button", { name: "Lock file" }).click();
  await expect.poll(() => sql(`select state from order_files where ${where}`)).toBe("locked");
  await expect(admin.getByTestId("file-row").filter({ hasText: "final.pdf" }).getByText("Locked")).toBeVisible();

  // UI: archive is refused
  await admin.getByRole("button", { name: "Actions for final.pdf" }).click();
  await admin.getByRole("menuitem", { name: "Archive" }).click();
  await expect(admin.getByText(/Locked files cannot be archived/).first()).toBeVisible();
  // database: every way of changing a locked file is refused
  for (const stmt of [`update order_files set archived = true where ${where}`, `update order_files set storage_path = 'elsewhere' where ${where}`, `update order_files set state = 'draft' where ${where}`,
    `update order_files set checksum = 'abc' where ${where}`, `delete from order_files where ${where}`]) expect(() => sql(stmt), stmt).toThrow(/locked|immutable/i);
  expect(sql(`select state || '|' || archived from order_files where ${where}`)).toBe("locked|false");
  expect(readFileSync(path.join(STORE, code, "final_print", "final.pdf-v1")).equals(bytes)).toBe(true);

  // a new version is a separate Draft; v1 stays locked
  const v2 = randomBytes(1500);
  await admin.getByRole("button", { name: "Actions for final.pdf" }).click();
  await admin.getByRole("menuitem", { name: "New version" }).click();
  await admin.getByRole("button", { name: "Add new version" }).click();
  await admin.getByTestId("version-input").setInputFiles({ name: "final.pdf", mimeType: "application/pdf", buffer: v2 });
  await expect.poll(() => sql(`select string_agg(version || ':' || state, ',' order by version) from order_files where ${where}`)).toBe("1:locked,2:draft");
});

test("role gating: view-only roles see why, and the database holds the line", async ({ browser }) => {
  const code = fixtureOrder({ stage: "printing" });
  sql(`insert into print_jobs(order_id, paper_type, sheets, copies) select id, 'Matte', 40, 1 from orders where code = '${code}'`);
  const reception = await as(browser, "reception");                                  // reception has no printing workspace
  await reception.goto("/printing");
  await expect(reception.getByRole("button", { name: "Release to Printing" })).toHaveCount(0);
  await expect(reception.getByTestId(`pjob-${code}`)).toHaveCount(0);
  const colour = await as(browser, "colour");                                         // grading team has no business in deliveries
  await colour.goto("/delivery");
  await expect(colour.getByTestId(`del-${code}`)).toHaveCount(0);
  // the same limits hold when the API is called directly with that role's session
  const as_ = (role: string, stmt: string) => sql(`begin; select set_config('request.jwt.claim.sub', '${sql(`select id from profiles where role = '${role}'`)}', true); set local role authenticated; ${stmt}; commit;`);
  expect(() => as_("accounts", `insert into order_files(order_id, category, file_name, ext, size_bytes, storage_path) select id, 'other', 'a.pdf', 'pdf', 1, 'x/other/a.pdf-v1' from orders where code = '${code}'`)).toThrow(/row-level security/);
  expect(() => as_("accounts", `insert into storage.objects(bucket_id, name) values ('order-files', '${code}/other/a.pdf-v1')`)).toThrow(/row-level security/);
  expect(() => as_("colour", `insert into print_jobs(order_id) select id from orders where code = '${code}'`)).toThrow(/row-level security|duplicate/);
  expect(as_("reception", `update print_jobs set stage = 'file_prep' where order_id = (select id from orders where code = '${code}')`)).toContain("UPDATE 0");
  expect(sql(`select stage from print_jobs where order_id = (select id from orders where code = '${code}')`)).toBe("waiting");
});
