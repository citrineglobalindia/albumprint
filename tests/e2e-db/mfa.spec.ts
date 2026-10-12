import { test, expect } from "@playwright/test";
import { loginAs, sql, totp, PW } from "./helpers";

// Two-step login: enrol an authenticator, then a password alone no longer gets in — neither through the app nor straight at the API.
test("a user turns on two-step login; password alone is refused everywhere; an admin can reset it", async ({ page, browser }) => {
  sql("delete from auth.mfa_factors");
  await loginAs(page, "reception");
  await page.goto("/account");
  await page.getByRole("button", { name: "Set up two-step login" }).click();
  const secret = (await page.getByTestId("mfa-secret").textContent())!.trim();
  await page.getByLabel("Authenticator code").fill("000000");
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByRole("alert")).toBeVisible();                                         // a wrong code is refused
  await page.getByLabel("Authenticator code").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on" }).click();
  await expect(page.getByText("Two-step login is on").first()).toBeVisible();
  expect(sql("select count(*) from auth.mfa_factors where status = 'verified'")).toBe("1");

  // a new browser: password only → the code screen, and nothing is loaded
  const ctx = await browser.newContext({ baseURL: page.url().split("/account")[0] });
  const p = await ctx.newPage();
  await p.goto("/login");
  await p.getByLabel("Work email").fill("reception@albumpro.local");
  await p.locator("input[type=password]").first().fill(PW);
  await p.getByRole("button", { name: "Sign in" }).click();
  await expect(p.getByRole("heading", { name: "Verify it's you" })).toBeVisible();
  await p.getByLabel("6-digit code").fill("111111");
  await p.getByRole("button", { name: "Verify & continue" }).click();
  await expect(p.getByRole("alert")).toContainText("not valid");
  await p.getByLabel("6-digit code").fill(totp(secret));
  await p.getByRole("button", { name: "Verify & continue" }).click();
  await expect(p.getByRole("heading", { name: "Reception Desk" })).toBeVisible({ timeout: 15_000 });
  await ctx.close();

  // the API itself refuses a password-only session: row-level security sees no role until the code is entered
  const api = `http://localhost:${process.env.API_PORT ?? 54321}`;
  const tok = await (await fetch(`${api}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: "local", "content-type": "application/json" }, body: JSON.stringify({ email: "reception@albumpro.local", password: PW }) })).json() as { access_token: string };
  const rows = await (await fetch(`${api}/rest/v1/profiles?select=id`, { headers: { apikey: "local", authorization: `Bearer ${tok.access_token}` } })).json() as unknown[];
  expect(rows).toEqual([]);                                                                      // aal1 token: no data at all

  // admin resets it (lost phone) and the user can sign in with the password again
  const adminCtx = await browser.newContext({ baseURL: page.url().split("/account")[0] });
  const a = await adminCtx.newPage();
  await loginAs(a, "admin");
  await a.goto("/users");
  await a.getByRole("button", { name: /^Reset two-step login for/ }).first().waitFor();
  const resetBtn = a.locator("tr", { hasText: "reception@albumpro.local" }).getByRole("button", { name: /^Reset two-step login for/ });
  await resetBtn.click();
  await a.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(a.getByText(/Two-step login reset for/).first()).toBeVisible();
  await adminCtx.close();
  const rows2 = await (await fetch(`${api}/rest/v1/profiles?select=id`, { headers: { apikey: "local", authorization: `Bearer ${tok.access_token}` } })).json() as unknown[];
  expect(rows2.length).toBeGreaterThan(0);                                                       // same password-only token works again
});
