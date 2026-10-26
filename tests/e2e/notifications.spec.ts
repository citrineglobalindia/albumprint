import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

// Demo mode: the same events the database announces (supabase/migrations/0035) reach the right roles, and not the person who did it.
test("approving a grading tells the designer (and only the designer); the bell keeps it across reloads", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/control");
  await page.getByRole("tab", { name: /^Approvals & SLA/ }).click();
  const row = page.getByTestId("approval-row").filter({ hasText: "Grading approval" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Approve" }).click();

  // the actor is not told about their own action
  await page.getByRole("button", { name: /^Notifications/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Recent notifications" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Recent notifications" }).getByText("Design assigned")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // the designer sees it, and it is still there after a reload; opening it marks it read
  await page.evaluate(() => localStorage.setItem("albumpro.role", "designer"));
  await page.reload();
  const bell = page.getByRole("button", { name: /^Notifications/ }).first();
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Recent notifications" });
  await expect(panel.getByText("Design assigned")).toBeVisible();
  await expect(panel.getByText(/\d+ new/)).toBeVisible();
  await panel.getByText("Design assigned").first().click();
  await expect(page).toHaveURL(/\/designing\/IDP\d+/);                              // a page the designer can open
  await page.reload();
  await page.getByRole("button", { name: /^Notifications/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Recent notifications" }).getByText("Design assigned")).toBeVisible();

  // other roles do not get it
  await page.evaluate(() => localStorage.setItem("albumpro.role", "reception"));
  await page.reload();
  await page.getByRole("button", { name: /^Notifications/ }).first().click();
  await expect(page.getByRole("dialog", { name: "Recent notifications" }).getByText("Design assigned")).toHaveCount(0);
});

test("a new order tells admin and reception; mark all read clears the badge", async ({ page }) => {
  await seedRole(page, "reception");
  await page.goto("/orders");
  await page.getByRole("button", { name: "Create Order" }).first().click();
  const dlg = page.getByRole("dialog", { name: "New Order" });
  await dlg.getByRole("button", { name: /^Customer/ }).click();
  await page.getByRole("button", { name: "Sharma Studio Rahul Sharma · +91 98765 43210", exact: true }).click();
  for (let i = 0; i < 3; i++) await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByRole("button", { name: "Create Order" }).click();
  await expect(page).toHaveURL(/\/orders\/IDP\d+$/);
  const code = page.url().split("/").pop()!;

  // reception created it, so reception is not told; admin is
  await page.evaluate(() => localStorage.setItem("albumpro.role", "admin"));
  await page.reload();
  await page.getByRole("button", { name: /^Notifications/ }).first().click();
  const panel = page.getByRole("dialog", { name: "Recent notifications" });
  await expect(panel.getByText("Order created").first()).toBeVisible();
  await expect(panel.getByText(new RegExp(code))).toBeVisible();
  await panel.getByRole("button", { name: /Mark all read/i }).click();
  await expect(panel.getByText(/\d+ new/)).toHaveCount(0);
});
