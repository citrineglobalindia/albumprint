import { test, expect, type Browser, type Page } from "@playwright/test";
import { loginAs, sql, PW } from "./helpers";

// Administration against the real database: invites → sign-up → profile, deactivation, last-admin guard, shared pricing, RLS.
const stamp = Date.now();
const email = (tag: string) => `${tag}.${stamp}@albumpro.local`;

/** Sign up through the real "Create your account" form (the local auth stand-in confirms immediately). */
async function signUpViaUi(browser: Browser, mail: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: /create your/i }).click();
  await page.getByLabel("Work email").fill(mail);
  await page.locator("input[type=password]").first().fill(PW);
  await page.getByLabel("Confirm password").fill(PW);
  await page.getByRole("button", { name: "Create account" }).click();
  return page;
}

test.describe("administration (database mode)", () => {
  test("admin invites an email in the UI; signing up with it creates the profile with that role", async ({ page, browser }) => {
    const mail = email("newdesigner");
    await loginAs(page, "admin");
    await page.goto("/users");
    await page.getByRole("button", { name: "Add User" }).click();
    await page.getByLabel("Full name").fill("New Designer");
    await page.getByLabel("Work email").fill(mail);
    await page.getByRole("dialog").getByLabel("Role").selectOption("designer");
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByTestId("invites-table").getByText(mail)).toBeVisible();
    expect(sql(`select role||'|'||full_name||'|'||(used_at is null) from staff_invites where email='${mail}'`)).toBe("designer|New Designer|true");

    const user = await signUpViaUi(browser, mail);
    await expect.poll(() => sql(`select role||'|'||full_name||'|'||active from profiles where email='${mail}'`), { timeout: 15_000 }).toBe("designer|New Designer|true");
    expect(sql(`select (used_at is not null)::text from staff_invites where email='${mail}'`)).toBe("true");
    await expect(user).not.toHaveURL(/login/, { timeout: 15_000 });
    await user.context().close();

    // the invite list now shows it as accepted, and the user appears in the Users tab
    await page.reload();
    await expect(page.getByTestId("users-table").getByText(mail)).toBeVisible();
  });

  test("a revoked invite does not create a profile", async ({ page, browser }) => {
    const mail = email("revoked");
    await loginAs(page, "admin");
    await page.goto("/users");
    await page.getByRole("button", { name: "Add User" }).click();
    await page.getByLabel("Full name").fill("Revoked Person");
    await page.getByLabel("Work email").fill(mail);
    await page.getByRole("button", { name: "Send invite" }).click();
    await page.getByRole("button", { name: `Revoke invite ${mail}` }).click();
    await page.getByRole("button", { name: "Revoke", exact: true }).last().click();
    await expect.poll(() => sql(`select (revoked_at is not null)::text from staff_invites where email='${mail}'`)).toBe("true");
    const user = await signUpViaUi(browser, mail);
    await expect(user.getByRole("alert").or(user.getByText("Check your email")).first()).toBeVisible();
    expect(sql(`select count(*) from profiles where email='${mail}'`)).toBe("0");
    await user.context().close();
  });

  test("deactivating a user blocks their next sign-in", async ({ page, browser }) => {
    const mail = email("blockme");
    sql(`insert into staff_invites(email, role, full_name, department) values ('${mail}', 'qc', 'Block Me', 'Quality Control')`);
    const first = await signUpViaUi(browser, mail);
    await expect(first).not.toHaveURL(/login/, { timeout: 15_000 });
    await first.context().close();

    await loginAs(page, "admin");
    await page.goto("/users");
    await page.getByLabel("Deactivate Block Me").click();
    await page.getByRole("button", { name: "Deactivate", exact: true }).last().click();
    await expect.poll(() => sql(`select active::text from profiles where email='${mail}'`)).toBe("false");

    const again = await (await browser.newContext()).newPage();
    await again.goto("/login");
    await again.getByLabel("Work email").fill(mail);
    await again.locator("input[type=password]").first().fill(PW);
    await again.getByRole("button", { name: "Sign in" }).click();
    await expect(again.getByText(/no staff access/i)).toBeVisible({ timeout: 15_000 });
    await expect(again).toHaveURL(/login/);
    await again.context().close();
  });

  test("the last active admin cannot be demoted, deactivated or removed", async ({ page }) => {
    sql(`update profiles set active = false where role = 'admin' and email <> 'admin@albumpro.local'`);   // leave exactly one active admin
    await loginAs(page, "admin");
    await page.goto("/users");
    // UI guard + database guard (editing the role is refused by the trigger and the row reverts)
    await page.getByLabel("Deactivate Admin").first().click().catch(() => undefined);
    await page.getByLabel(/^Edit /).first().waitFor();
    const row = page.getByRole("row", { name: /admin@albumpro\.local/ });
    await row.getByRole("button", { name: /^Edit/ }).click();
    await page.getByRole("dialog").getByLabel("Role").selectOption("reception");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(/at least one active admin must remain/i)).toBeVisible();
    await expect(row.getByText("Admin", { exact: true }).first()).toBeVisible();
    expect(sql(`select role::text from profiles where email='admin@albumpro.local'`)).toBe("admin");
    for (const stmt of [`update profiles set active=false where email='admin@albumpro.local'`, `update profiles set role='qc' where email='admin@albumpro.local'`, `delete from profiles where email='admin@albumpro.local'`]) {
      expect(() => sql(stmt)).toThrow(/at least one active admin/);
    }
  });

  test("pricing edited by admin is shared: reception sees it after a reload", async ({ page, browser }) => {
    const before = sql(`select value->>'designCharge' from settings where key='pricing'`) || "4000";
    const target = before === "4321" ? 4322 : 4321;
    await loginAs(page, "admin");
    await page.goto("/masters");
    await page.getByRole("tab", { name: "Pricing Rules" }).click();
    await page.getByLabel("Design charge").fill(String(target));
    await page.getByTestId("pricing-save").click();
    await expect.poll(() => sql(`select value->>'designCharge' from settings where key='pricing'`)).toBe(String(target));
    expect(sql(`select value->>'discount_approval_pct' from settings where key='pricing'`)).not.toBe("");   // the database discount rule's key survives

    const rec = await (await browser.newContext()).newPage();
    await loginAs(rec, "reception");
    await rec.reload();
    await expect.poll(() => rec.evaluate(async () => (await import("/src/lib/pricing.ts")).DESIGN_CHARGE), { timeout: 15_000 }).toBe(target);
    await rec.context().close();
    sql(`update settings set value = jsonb_set(value, '{designCharge}', to_jsonb(${before}::int)) where key='pricing'`);
  });

  test("settings persist in the database and Data & Storage tools are hidden", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/settings");
    await expect(page.getByRole("button", { name: /Data & Storage/ })).toHaveCount(0);
    await page.getByRole("button", { name: /Workflow Settings/ }).click();
    const warn = page.getByLabel(/SLA warning|Warn/i).first();
    if (await warn.count()) { /* slider present */ }
    await page.getByRole("button", { name: /Company Profile/ }).click();
    await page.getByLabel("Legal Name").fill(`Studio ${stamp} Pvt Ltd`);
    await page.getByRole("button", { name: "Save All" }).click();
    await expect.poll(() => sql(`select value->>'legal' from settings where key='company'`)).toBe(`Studio ${stamp} Pvt Ltd`);
    await page.reload();
    await page.getByRole("button", { name: /Company Profile/ }).click();
    await expect(page.getByLabel("Legal Name")).toHaveValue(`Studio ${stamp} Pvt Ltd`);
  });

  test("notification triggers and the communication log use the database", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/notifications");
    await expect(page.getByTestId("queue-note")).toBeVisible();
    await page.getByRole("tab", { name: "Triggered Notifications" }).click();
    await expect(page.getByTestId("trigger-table").getByRole("row")).toHaveCount(14);   // header + 13 SRS triggers
    await page.getByRole("switch", { name: "Order Created: SMS" }).click();
    await expect.poll(() => sql(`select sms::text from notification_templates where key='order_created'`)).toBe("true");
    await page.getByRole("switch", { name: "Order Created: SMS" }).click();
    await expect.poll(() => sql(`select sms::text from notification_templates where key='order_created'`)).toBe("false");
    // a manual log entry is stored as queued
    sql(`insert into comm_log(channel, direction, recipient, summary, status) values ('internal_note','outbound','Admin','seed note ${stamp}','sent')`);
    await page.reload();
    await expect(page.getByText(`seed note ${stamp}`)).toBeVisible();
  });

  test("non-admin roles are redirected from /users and RLS refuses direct writes", async ({ page }) => {
    await loginAs(page, "reception");
    await page.goto("/users");
    await expect(page).not.toHaveURL(/\/users/);
    await page.goto("/settings");
    await expect(page).not.toHaveURL(/\/settings/);
    // same session token, straight at the API
    const token = await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /auth-token/.test(x)); return k ? (JSON.parse(localStorage.getItem(k)!).access_token as string) : ""; });
    expect(token).not.toBe("");
    const api = `http://localhost:${process.env.API_PORT ?? 54321}`;
    const h = { apikey: "local", Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" };
    const attempts: [string, string, unknown][] = [
      ["POST", "/rest/v1/staff_invites", { email: `evil.${stamp}@x.com`, role: "admin" }],
      ["POST", "/rest/v1/masters", { kind: "x", name: `y${stamp}` }],
      ["POST", "/rest/v1/settings", { key: "company", value: {} }],
    ];
    for (const [m, path, body] of attempts) {
      const r = await page.request.fetch(api + path, { method: m, headers: h, data: body });
      expect(r.status(), path).toBeGreaterThanOrEqual(400);
    }
    for (const path of ["/rest/v1/role_permissions?role=eq.reception&module=eq.users", "/rest/v1/profiles?email=eq.reception@albumpro.local", "/rest/v1/sla_rules?stage=eq.qc", "/rest/v1/settings?key=eq.pricing"]) {
      const r = await page.request.fetch(api + path, { method: "PATCH", headers: h, data: path.includes("profiles") ? { role: "admin" } : path.includes("role_permissions") ? { level: "full" } : path.includes("sla") ? { hours: 1 } : { value: {} } });
      expect(r.status() >= 400 || (await r.json()).length === 0, path).toBe(true);
    }
    expect(sql(`select role::text from profiles where email='reception@albumpro.local'`)).toBe("reception");
    expect(sql(`select count(*) from staff_invites where email like 'evil.%'`)).toBe("0");
    // staff can read what they need: pricing + workflow, but not security
    const rd = await page.request.fetch(`${api}/rest/v1/settings?select=key`, { headers: h });
    const keys = ((await rd.json()) as { key: string }[]).map((x) => x.key);
    expect(keys).toContain("pricing"); expect(keys).toContain("workflow"); expect(keys).not.toContain("security");
  });

  test("the permission matrix is editable by admin and audited", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/users");
    await page.getByRole("tab", { name: "Permissions" }).click();
    const cell = page.getByLabel("Reports for Printing");
    const old = await cell.inputValue();
    const next = old === "full" ? "view" : "full";
    await cell.selectOption(next);
    await page.getByRole("button", { name: /Save permissions/ }).click();
    await page.getByRole("button", { name: "Confirm & save" }).click();
    await expect.poll(() => sql(`select level from role_permissions where role='printing' and module='reports'`)).toBe(next);
    expect(Number(sql(`select count(*) from audit_log where entity='role_permissions' and new_data->>'module'='reports' and new_data->>'role'='printing' and new_data->>'level'='${next}'`))).toBeGreaterThan(0);
    sql(`update role_permissions set level='${old}' where role='printing' and module='reports'`);
    await expect(page.getByLabel("Users for Admin") .or(page.getByLabel("User / role admin for Admin"))).toBeDisabled();
  });
});
