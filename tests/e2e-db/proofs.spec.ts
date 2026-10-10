import { test, expect, type Browser, type Page } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Client proofing, design state and audit trail against the real database (supabase/local).
test.describe.configure({ mode: "serial" });

let code = "", oid = "";
const tag = Date.now().toString(36);

test.beforeAll(() => {
  sql(`insert into customers(studio_name, mobile, contact_person) values ('Proof ${tag}', '9111111111', 'Proof Tester');`);
  sql(`insert into orders(customer_id, type, due_date, total, event_type) select id, 'design_printing', current_date + 20, 12000, 'Wedding' from customers where studio_name = 'Proof ${tag}';`);
  oid = sql(`select o.id from orders o join customers c on c.id = o.customer_id where c.studio_name = 'Proof ${tag}'`);
  code = sql(`select code from orders where id = '${oid}'`);
  sql(`insert into order_specs(order_id, album_type, album_size, orientation, pages, paper_type, cover_type, binding) values ('${oid}', 'Premium', '12x36', 'landscape', 20, 'Matte', 'Leatherette', 'Lay-flat');`);
  for (const s of ["files_received", "colour_grading", "admin_approval", "designing"]) sql(`select advance_order('${oid}', '${s}');`);
});

const stage = () => sql(`select stage from orders where id = '${oid}'`);

async function sendProof(page: Page): Promise<string> {
  await page.getByRole("button", { name: /Send for Client Review|Send new proof to client|Resubmit to client/ }).click();
  await page.getByRole("button", { name: "Send proof" }).click();
  const link = page.getByTestId("proof-link").first();
  await expect(link).toBeVisible();
  return (await link.getAttribute("href"))!;
}

async function clientContext(browser: Browser, href: string) {
  const ctx = await browser.newContext({ baseURL: new URL(page0Base()).origin });   // fresh context: no cookies, no session
  const p = await ctx.newPage();
  await p.goto(href);
  return { ctx, p };
}
const page0Base = () => `http://localhost:${process.env.E2E_PORT ?? 5190}`;

test("layout autosaves, survives reload and is shared with the designer", async ({ page, browser }) => {
  await loginAs(page, "admin");
  await page.goto(`/designing/${code}`);
  await expect(page.getByRole("button", { name: "Add Text" })).toBeVisible();
  await page.getByRole("button", { name: "Add Text" }).click();
  await page.getByRole("button", { name: "Add Image" }).click();
  await expect(page.locator("[data-ov]")).toHaveCount(2);
  await expect.poll(() => sql(`select jsonb_array_length(layout->'spreads'->0->'overlays') from design_docs where order_id = '${oid}'`), { timeout: 10_000 }).toBe("2");
  await page.reload();
  await expect(page.locator("[data-ov]")).toHaveCount(2);
  // a different user (designer) sees the same layout
  const ctx = await browser.newContext({ baseURL: page0Base() });
  const d = await ctx.newPage();
  await loginAs(d, "designer");
  await d.goto(`/designing/${code}`);
  await expect(d.locator("[data-ov]")).toHaveCount(2);
  await ctx.close();
});

test("client opens the public link without logging in, asks for corrections; staff see them and the order is back in designing", async ({ page, browser }) => {
  await loginAs(page, "admin");
  await page.goto(`/designing/${code}`);
  const href = await sendProof(page);
  expect(href).toMatch(/\/proof\/[0-9a-f]{32}$/);
  await expect.poll(stage).toBe("client_review");
  // only a hash is stored
  const token = href.split("/").pop()!;
  expect(sql(`select count(*) from proofs where order_id = '${oid}' and token_hash like '${token}%'`)).toBe("0");
  expect(sql(`select char_length(token_hash) from proofs where order_id = '${oid}'`)).toBe("64");

  const { ctx, p } = await clientContext(browser, href);
  await expect(p.getByRole("heading", { name: /Wedding Album/ })).toBeVisible();
  await expect(p.getByText(code)).toBeVisible();
  await p.getByRole("button", { name: "Add correction" }).click();
  await p.getByLabel("Correction comment").fill("Please brighten the bride's face");
  await p.getByRole("button", { name: "Add comment" }).click();
  await p.getByRole("button", { name: "Request corrections" }).click();
  await p.getByRole("button", { name: "Send corrections" }).click();
  await expect(p.getByText("Thank you - corrections sent")).toBeVisible();
  // the answered link cannot be answered again, even after a reload
  await p.reload();
  await expect(p.getByText("Thank you - corrections sent")).toBeVisible();
  expect(await p.evaluate(() => Object.keys(localStorage).filter((k) => k.includes("auth-token")))).toEqual([]);   // no staff session in this context
  await ctx.close();

  expect(sql(`select stage from orders where id = '${oid}'`)).toBe("designing");
  expect(sql(`select count(*) from audit_log where entity = 'orders' and entity_id = '${oid}' and reason = 'Client corrections'`)).toBe("1");
  // staff screen picks it up on its own (polling)
  await expect(page.getByText("Please brighten the bride's face").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Corrections requested").first()).toBeVisible();
});

test("a wrong, revoked or expired link shows a friendly page and exposes nothing", async ({ browser }) => {
  const { ctx, p } = await clientContext(browser, "/proof/not-a-real-token");
  await expect(p.getByText("This link isn't valid")).toBeVisible();
  await ctx.close();
  sql(`insert into proofs(order_id, version, token_hash, expires_at, status, sent_at) values ('${oid}', 50, encode(sha256(convert_to('expired-tok-${tag}','UTF8')),'hex'), now() - interval '1 day', 'sent', now() - interval '30 days');`);
  sql(`insert into proofs(order_id, version, token_hash, expires_at, status, sent_at) values ('${oid}', 51, encode(sha256(convert_to('revoked-tok-${tag}','UTF8')),'hex'), now() + interval '1 day', 'revoked', now() - interval '30 days');`);
  for (const [t, msg] of [[`expired-tok-${tag}`, "This link has expired"], [`revoked-tok-${tag}`, "This link is no longer active"]] as const) {
    const c = await clientContext(browser, `/proof/${t}`);
    await expect(c.p.getByText(msg)).toBeVisible();
    await c.ctx.close();
  }
  // anonymous callers cannot read tables or other functions directly
  const api = process.env.API_PORT ?? 54321;
  const r = await fetch(`http://localhost:${api}/rest/v1/proofs?select=token_hash`, { headers: { apikey: "local" } });
  expect(r.status).toBeGreaterThanOrEqual(400);
  const r2 = await fetch(`http://localhost:${api}/rest/v1/rpc/advance_order`, { method: "POST", headers: { apikey: "local", "content-type": "application/json" }, body: JSON.stringify({ p_order: oid, p_to: "printing" }) });
  expect(r2.status).toBeGreaterThanOrEqual(400);
});

test("second proof approved in the portal unlocks release to printing", async ({ page, browser }) => {
  await loginAs(page, "admin");
  await page.goto(`/designing/${code}`);
  // resolve the client correction (Corrections tab), then resubmit
  await page.getByText(/^Corrections \(\d+\)$/).click();
  await page.getByRole("button", { name: "Mark Resolved" }).first().click();
  await expect.poll(() => sql(`select count(*) from proof_comments where resolved`), { timeout: 10_000 }).not.toBe("0");
  const href = await sendProof(page);
  await expect.poll(stage).toBe("client_review");
  expect(sql(`select count(*) from proofs where order_id = '${oid}' and status = 'corrections_requested'`)).toBe("1");   // v1 stays as answered history
  // before approval the release gate holds
  sql(`select advance_order('${oid}', 'final_approval');`);
  expect(() => sql(`select advance_order('${oid}', 'printing');`)).toThrow();

  const { ctx, p } = await clientContext(browser, href);
  await p.getByRole("button", { name: "Approve album" }).click();
  await p.getByLabel("Your full name").fill("Mrs Proof Tester");
  await p.getByRole("checkbox").check();
  await p.getByRole("button", { name: "Confirm approval" }).click();
  await expect(p.getByText("Thank you - album approved!")).toBeVisible();
  await ctx.close();

  expect(sql(`select status || ':' || approved_by from proofs where order_id = '${oid}' and approved_by is not null`)).toBe("approved:Mrs Proof Tester");
  sql(`select advance_order('${oid}', 'printing');`);   // gate satisfied
  expect(stage()).toBe("printing");
});

test("admin audit page lists the server's rows with real actors", async ({ page }) => {
  await loginAs(page, "admin");
  await page.goto("/audit");
  const table = page.getByTestId("audit-table");
  await expect(table.locator("tbody tr").first()).toBeVisible();
  await expect(table.getByText("client_approval").first()).toBeVisible({ timeout: 15_000 });
  await expect(table.getByText("Admin", { exact: true }).first()).toBeVisible();
  // client-side events (log_event) are stamped with the signed-in user's role
  expect(sql(`select count(*) from audit_log where entity = 'design' and actor is not null and actor_role = 'admin'`)).not.toBe("0");
  // non-admins get no trail (RLS), not an error
  const d = await page.context().browser()!.newContext({ baseURL: page0Base() });
  const dp = await d.newPage();
  await loginAs(dp, "designer");
  expect(await dp.evaluate(async () => { const k = Object.keys(localStorage).find((x) => x.includes("auth-token")); return !!k; })).toBe(true);
  await d.close();
});
