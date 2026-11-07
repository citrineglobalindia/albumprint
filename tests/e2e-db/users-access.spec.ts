import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Users: the admin creates a ready-to-use login with a password (no e-mail), the person signs in and changes it;
// the admin gives a designer the Printing module and they can open Printing and Labs.
test("admin creates a user with a password; they sign in; extra modules open other modules", async ({ browser }) => {
  const tag = Date.now().toString(36), email = `helper.${tag}@albumpro.local`;
  const ctx = () => browser.newContext({ baseURL: `http://localhost:${Number(process.env.E2E_PORT ?? 5190)}` });
  const admin = await (await ctx()).newPage();
  await loginAs(admin, "admin");
  await admin.goto("/users");
  await admin.getByRole("button", { name: "Add User" }).first().click();
  await expect(admin.getByRole("radio", { name: "Create with password" })).toHaveAttribute("aria-checked", "true");
  await admin.getByRole("dialog").getByLabel(/^Full name/).fill(`Helper ${tag}`);
  await admin.getByRole("dialog").getByLabel(/^Work email/).fill(email);
  await admin.getByRole("dialog").getByLabel(/^Role/).selectOption("designer");
  await admin.getByLabel("Password", { exact: true }).fill("short");
  await admin.getByRole("button", { name: "Create user" }).click();
  await expect(admin.getByText("at least 8 characters").first()).toBeVisible();
  await admin.getByLabel("Password", { exact: true }).fill("Helper-Pass-1");
  await admin.getByRole("button", { name: "Create user" }).click();
  await expect(admin.getByText(/can sign in now with/).first()).toBeVisible();
  expect(sql(`select role || '|' || must_change_password from profiles where email = '${email}'`)).toBe("designer|true");

  // the new person signs in with that password and is asked to set their own
  const u = await (await ctx()).newPage();
  await u.goto("/login");
  await u.getByLabel("Work email").fill(email); await u.locator("input[type=password]").first().fill("Helper-Pass-1");
  await u.getByRole("button", { name: "Sign in" }).click();
  await expect(u.getByRole("heading", { name: /password/i }).first()).toBeVisible();

  // extra module: Printing for this designer
  sql(`update profiles set must_change_password = false where email = '${email}'`);
  await admin.reload();
  await admin.getByRole("button", { name: `Edit Helper ${tag}` }).click();
  await admin.getByTestId("extra-modules").getByLabel("Module Printing & Labs").check();
  await admin.getByRole("button", { name: "Save changes" }).click();
  await expect.poll(() => sql(`select string_agg(module, ',') from user_modules where user_id = (select id from profiles where email = '${email}')`)).toBe("printing");

  const u2 = await (await ctx()).newPage();
  await u2.goto("/login");
  await u2.getByLabel("Work email").fill(email); await u2.locator("input[type=password]").first().fill("Helper-Pass-1");
  await u2.getByRole("button", { name: "Sign in" }).click();
  await u2.waitForURL((x) => !x.pathname.includes("login"));
  await expect(u2.getByRole("link", { name: "Printing", exact: true })).toBeVisible();
  await expect(u2.getByRole("link", { name: "Labs", exact: true })).toBeVisible();
  await u2.goto("/printing");
  await expect(u2).toHaveURL(/\/printing$/);
  await expect(u2.getByRole("heading", { level: 1 })).toContainText("Printing");
});
