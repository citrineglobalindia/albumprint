import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

test.describe("login and roles", () => {
  test("signed-out visit redirects to /login, then returns the user to the page they wanted", async ({ page }) => {
    await page.goto("/orders");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("button", { name: "Reception", exact: true }).click();
    await page.getByPlaceholder("••••••••").fill("secret1");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByPlaceholder("······").fill("123456");
    await page.getByRole("button", { name: /Verify/ }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByRole("heading", { name: "Orders", level: 1 })).toBeVisible();
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
});
