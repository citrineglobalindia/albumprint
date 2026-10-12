import { test, expect } from "@playwright/test";
import { loginAs, sql } from "./helpers";

// Scheduled reports live in the database; when one comes due the scheduler job notifies the recipients in AlbumPro.
test("admin schedules a report; it is stored, comes due, and the admin is notified", async ({ page }) => {
  const name = `Weekly sales ${Date.now()}`;
  await loginAs(page, "admin");
  await page.goto("/reports");
  await page.getByText("Custom Report", { exact: true }).first().click();
  await page.locator('input[value="Custom report"]').fill(name);
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await page.getByPlaceholder("owner@studio.com, accounts@studio.com").fill("reception@albumpro.local");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByText(/scheduled weekly at/i).first()).toBeVisible();
  expect(sql(`select freq || ':' || format || ':' || recipients::text from report_schedules where name = '${name}'`)).toBe("Weekly:CSV:{reception@albumpro.local}");

  await page.reload();
  await page.getByText("Custom Report", { exact: true }).first().click();
  await expect(page.getByText(name).first()).toBeVisible();                                  // comes back from the database

  sql(`update report_schedules set last_run_at = now() - interval '9 days' where name = '${name}'`);
  expect(Number(sql(`select run_report_schedules()`))).toBeGreaterThanOrEqual(1);          // what the 15-minute job does
  expect(sql(`select count(*) from notifications where title = 'Scheduled report ready: ${name}'`)).toBe("2");   // admin + the recipient
  await page.reload();
  await page.getByRole("button", { name: /^Notifications/ }).click();                      // the bell
  await expect(page.getByRole("dialog", { name: "Recent notifications" }).getByText(`Scheduled report ready: ${name}`)).toBeVisible();
});
