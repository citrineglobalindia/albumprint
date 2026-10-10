import { test, expect, type Page } from "@playwright/test";
import { loginAs, sql, type Role } from "./helpers";

// Finance against the real database: receipts, refund cap, invoice numbering/lines and the discount-approval gate.
const TAG = String(Date.now());
const STUDIO = `Fin Spec ${TAG}`;
let orderCode = "";
let orderId = "";

function fixture(total: number) {
  const cust = sql(`insert into customers(studio_name, mobile, code) values ('${STUDIO}', '9${String(Date.now()).slice(-9)}', 'pending') returning id`).split("\n")[0]!;
  const row = sql(`insert into orders(customer_id, type, due_date, total, code) values ('${cust}', 'design_printing', current_date + 14, ${total}, 'pending') returning id || '|' || code`).split("\n")[0]!;
  [orderId, orderCode] = row.split("|") as [string, string];
}
async function pickOrder(page: Page) {
  await page.getByRole("button", { name: /^Order/ }).last().click();
  await page.getByPlaceholder("Type to search…").fill(orderCode);
  await page.getByPlaceholder("Type to search…").press("Enter");   // picks the first match
}
async function as(page: Page, role: Role, path: string) {
  await loginAs(page, role);
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

test.beforeAll(() => { fixture(10000); });

test("reception records a payment: DB row, server receipt no, order paid after reload", async ({ page }) => {
  await as(page, "reception", "/payments");
  await page.getByTestId(`pay-${orderCode}`).click();
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await page.getByLabel("Amount").fill("4000");
  await page.getByLabel("Reference").fill(`UTR-${TAG}-1`);
  await page.getByRole("button", { name: "Save payment" }).click();
  await expect(page.getByText(/Received ₹4,000 — receipt RCP\d{4}\d{3,}/)).toBeVisible();
  const row = sql(`select receipt_no || '|' || amount || '|' || mode from payments where reference = 'UTR-${TAG}-1'`);
  expect(row).toMatch(/^RCP\d{7,}\|4000\.00\|upi$/);
  expect(sql(`select paid || '/' || pay_status from orders where code = '${orderCode}'`)).toBe("4000.00/partially_paid");
  await page.reload(); await page.waitForLoadState("networkidle");
  await page.getByTestId(`pay-${orderCode}`).click();
  await expect(page.getByTestId("fin-panel")).toContainText("4,000");
  await expect(page.getByTestId("pay-history")).toContainText("Payment");
});

test("reception cannot take more than the balance (database rule)", async ({ page }) => {
  await as(page, "reception", "/payments");
  await page.getByTestId(`pay-${orderCode}`).click();
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  await page.getByLabel("Amount").fill("9000");
  await page.getByLabel("Reference").fill(`UTR-${TAG}-2`);
  await page.getByRole("button", { name: "Save payment" }).click();
  await expect(page.locator("#main").getByText(/exceeds the balance/)).toBeVisible();
  expect(sql(`select count(*) from payments where reference = 'UTR-${TAG}-2'`)).toBe("0");
});

test("refund over the paid amount is refused with the database message; a valid refund issues a credit note", async ({ page }) => {
  await as(page, "accounts", "/payments");
  await page.getByTestId(`pay-${orderCode}`).click();
  await page.getByRole("button", { name: "Refund", exact: true }).click();
  await page.getByLabel("Amount").fill("5000");
  await page.getByLabel("Refund reason").fill("spec over-refund");
  await page.getByRole("button", { name: "Issue refund" }).click();
  await expect(page.getByText(/refund 5000\.00 exceeds amount paid 4000\.00/)).toBeVisible();
  expect(sql(`select count(*) from payments where order_id = '${orderId}' and kind = 'refund'`)).toBe("0");

  await page.getByLabel("Amount").fill("1000");
  await page.getByRole("button", { name: "Issue refund" }).click();
  await expect(page.locator("#main").getByText(/Refunded ₹1,000 — credit note CN-\d{4}-\d{4}/)).toBeVisible();
  expect(sql(`select paid::text from orders where code = '${orderCode}'`)).toBe("3000.00");
  expect(sql(`select count(*) from invoices where order_id = '${orderId}' and kind = 'credit_note' and total = 1000`)).toBe("1");
});

test("colour, designer, printing and qc see no money in the database", async () => {
  // RLS: those roles have no payments/invoices access. (UI route gating is covered by the app's role tests.)
  for (const r of ["colour", "designer", "printing", "qc"] as Role[]) {
    const n = sql(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', (select id::text from profiles where role = '${r}' limit 1), true); select count(*) from payments; commit;`).split("\n").at(-2);
    expect(n, r).toBe("0");
  }
});

test("accounts creates an invoice with lines and gets the server number", async ({ page }) => {
  await as(page, "accounts", "/invoices");
  await page.getByRole("button", { name: /New Invoice/ }).click();
  await pickOrder(page);
  await page.getByLabel("Line 1 description").fill("Spec album");
  await page.getByLabel("Line 1 qty").fill("2");
  await page.getByLabel("Line 1 price").fill("3000");
  await page.getByRole("button", { name: "+ Add line" }).click();
  await page.getByLabel("Line 2 description").fill("Spec box");
  await page.getByLabel("Line 2 price").fill("500");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.locator("#main").getByText(/INV-\d{4}-\d{4} created as draft/)).toBeVisible();
  const r = sql(`select number || '|' || status || '|' || subtotal || '|' || total || '|' || (select count(*) from invoice_lines l where l.invoice_id = i.id) from invoices i where order_id = '${orderId}' and kind = 'invoice'`);
  expect(r).toMatch(/^INV-\d{4}-\d{4}\|draft\|6500\.00\|7670\.00\|2$/);
  await page.reload(); await page.waitForLoadState("networkidle");
  await expect(page.getByText(r.split("|")[0]!).first()).toBeVisible();
});

test("a discount above 10% cannot be sent until an admin approves", async ({ page, browser }) => {
  await as(page, "accounts", "/invoices");
  await page.getByRole("button", { name: /New Invoice/ }).click();
  await pickOrder(page);
  await page.getByLabel("Line 1 description").fill("Discounted album");
  await page.getByLabel("Line 1 price").fill("5000");
  await page.getByLabel("Discount %").fill("15");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.locator("#main").getByText(/needs admin approval before sending/).first()).toBeVisible();
  const no = sql(`select number from invoices where order_id = '${orderId}' and discount_pct = 15`);
  // the new invoice's detail panel is already open
  await page.getByTestId("send-invoice").click();
  await expect(page.locator("#main").getByText(/Discount 15% is above the 10% limit/)).toBeVisible();
  expect(sql(`select status from invoices where number = '${no}'`)).toBe("draft");
  // the database enforces it too, regardless of the UI
  expect(() => sql(`update invoices set status = 'sent' where number = '${no}'`)).toThrow();
  expect(sql(`select status from invoices where number = '${no}'`)).toBe("draft");

  // accounts has no approve button; admin does
  await expect(page.getByRole("button", { name: "Approve (admin only)" })).toBeVisible();
  const ctx = await browser.newContext(); const admin = await ctx.newPage();
  await as(admin, "admin", "/invoices");
  await admin.getByTestId(`inv-${no}`).click();
  await admin.getByTestId("approve-discount").click();
  await expect(admin.locator("#main").getByText(`Discount approved on ${no}`)).toBeVisible();
  await expect.poll(() => sql(`select (discount_approved_by is not null)::text from invoices where number = '${no}'`)).toBe("true");
  await admin.getByTestId("send-invoice").click();
  await expect.poll(() => sql(`select status from invoices where number = '${no}'`)).toBe("sent");
  expect(sql(`select (sent_at is not null)::text from invoices where number = '${no}'`)).toBe("true");
  await ctx.close();
});
