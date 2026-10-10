import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

test.describe("login and roles", () => {
  const signIn = async (page: import("@playwright/test").Page, role: string) => {
    await page.getByRole("button", { name: role, exact: true }).click();
    await page.getByPlaceholder("••••••••").fill("secret1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByPlaceholder("······").fill("123456");
    await page.getByRole("button", { name: /Verify/ }).click();
  };

  test("signed-out visit redirects to /login and returns to the requested page after sign-in", async ({ page }) => {
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/login$/);
    await signIn(page, "Reception");
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Orders");
  });

  test("signing in directly as Reception lands on the Reception home", async ({ page }) => {
    await page.goto("/login");
    await signIn(page, "Reception");
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Reception Desk");    // role-specific home, not the admin dashboard
    await expect(page.getByRole("link", { name: "Payments" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });

  test("admin lands on the Dashboard, other roles on their own home", async ({ page }) => {
    await seedRole(page, "admin");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Good Morning");
    await page.evaluate(() => { localStorage.setItem("albumpro.role", "reception"); });
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Reception Desk");
  });

  test("role restriction: colour grading cannot open /settings", async ({ page }) => {
    await seedRole(page, "colour");
    await page.goto("/settings");
    await expect(page).toHaveURL(/localhost:\d+\/$/);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Orders", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Colour Grading" }).first()).toBeVisible();
  });

  test("workflow actions are gated by role: reception has no next step at Colour Grading and cannot cancel or override", async ({ page }) => {
    await seedRole(page, "reception");
    await page.goto("/orders/IDP00072");
    await expect(page.getByTestId("no-next-step")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Admin override" })).toHaveCount(0);
  });
});
