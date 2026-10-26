import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

test("an employee checks in, takes a break and checks out; the ledger and timeline follow, and the rules hold", async ({ page }) => {
  await seedRole(page, "reception");
  await page.goto("/attendance");
  const today = page.getByTestId("today-card");
  await expect(today.getByText("Not in yet").or(today.getByText("Absent"))).toBeVisible();
  await expect(page.getByTestId("ledger")).toBeVisible();
  await expect(page.getByTestId("ledger").getByText("Opening balance")).toBeVisible();
  await expect(page.getByTestId("ledger").getByText("Closing balance")).toBeVisible();
  await expect(page.getByRole("button", { name: "Check out" })).toHaveCount(0);

  await today.getByLabel("Note (optional)").fill("at the studio");
  await today.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(today.getByText("Working")).toBeVisible();
  await expect(page.getByTestId("timeline").getByText("Checked in")).toBeVisible();
  await expect(page.getByTestId("timeline").getByText("at the studio")).toBeVisible();
  await expect(today.getByRole("button", { name: "Check in", exact: true })).toHaveCount(0);   // cannot check in twice

  await today.getByRole("button", { name: "Start break" }).click();
  await expect(today.getByText("On break")).toBeVisible();
  await expect(today.getByRole("button", { name: "Check out" })).toHaveCount(0);               // must end the break first
  await today.getByRole("button", { name: "End break" }).click();
  await expect(today.getByText("Working")).toBeVisible();
  await today.getByRole("button", { name: "Check out" }).click();
  await expect(page.getByTestId("timeline").getByText("Checked out")).toBeVisible();
  await expect(today.getByRole("button", { name: "Check in again" })).toBeVisible();
  await expect(page.getByTestId("timeline").getByRole("listitem")).toHaveCount(4);

  // the punches survive a reload (demo data is kept in the browser)
  await page.reload();
  await expect(page.getByTestId("timeline").getByRole("listitem")).toHaveCount(4);

  // staff do not see the team or settings tabs
  await expect(page.getByRole("tab", { name: "Team" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Shift & holidays" })).toHaveCount(0);
});

test("admin sees the team register, corrects a day with a reason, and manages leave and holidays", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/attendance");
  await page.getByRole("tab", { name: "Team" }).click();
  await expect(page.getByTestId("today-board")).toBeVisible();
  const reg = page.getByTestId("register");
  await expect(reg.getByText("Ramesh Kumar")).toBeVisible();

  // correct a past day for one employee: a reason is required
  const cell = reg.getByRole("button", { name: /^Ramesh Kumar \d{4}-\d{2}-\d{2} (Present|Late|Absent|Half day|Incomplete)$/ }).first();
  await cell.click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Check-in time").fill("09:00");
  await sheet.getByLabel("Check-out time").fill("18:00");
  await sheet.getByRole("button", { name: "Save correction" }).click();
  await expect(sheet.getByRole("alert")).toContainText("reason");
  await sheet.getByLabel("Check-out time").fill("08:00");
  await sheet.getByLabel("Reason for correction").fill("forgot to punch");
  await sheet.getByRole("button", { name: "Save correction" }).click();
  await expect(sheet.getByRole("alert")).toContainText("after check-in");
  await sheet.getByLabel("Check-out time").fill("18:00");
  await sheet.getByRole("button", { name: "Save correction" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(reg.getByRole("button", { name: /^Ramesh Kumar \d{4}-\d{2}-\d{2} Present$/ }).first()).toBeVisible();

  // leave: file as admin is not approvable by self; approve one from reception
  await page.getByRole("tab", { name: /^Leave/ }).click();
  await expect(page.getByText("Waiting for your decision")).toBeVisible();

  // holidays
  await page.getByRole("tab", { name: "Shift & holidays" }).click();
  await page.getByLabel("Holiday date").fill("2026-12-25");
  await page.getByLabel("Holiday name").fill("Christmas");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Christmas")).toBeVisible();
  await page.getByLabel("Grace period").fill("5");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Attendance settings saved").first()).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Shift & holidays" }).click();
  await expect(page.getByText("Christmas")).toBeVisible();
  await expect(page.getByLabel("Grace period")).toHaveValue("5");
});

test("an employee files leave; an overlapping request is refused and a pending one can be cancelled", async ({ browser }) => {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await seedRole(page, "reception");
  await page.goto("/attendance");
  await page.getByRole("tab", { name: /^Leave/ }).click();
  const d = new Date(); d.setDate(d.getDate() - 2);
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  await page.getByLabel("Leave from").fill(iso);
  await page.getByLabel("Leave to").fill(iso);
  await page.getByLabel("Leave reason").fill("fever");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Leave request sent").first()).toBeVisible();
  await expect(page.getByTestId(/^leave-/).getByText("Pending")).toBeVisible();
  await page.getByLabel("Leave from").fill(iso);
  await page.getByLabel("Leave to").fill(iso);
  await page.getByLabel("Leave reason").fill("again");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("alert")).toContainText("already have a leave request");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Request cancelled").first()).toBeVisible();
  await expect(page.getByTestId(/^leave-/).getByText("Cancelled")).toBeVisible();
  await ctx.close();
});
