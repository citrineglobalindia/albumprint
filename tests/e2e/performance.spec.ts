import { test, expect } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

// Reports › Team Performance: per-role leaderboard from recorded work.
test("team performance by role: grading work shows up for the grader with photos, score and their orders", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Perf album", sheets: 10 }], finalize: true, photosGiven: "300" }))!;
  await page.goto(`/orders/${code}`);
  await page.getByRole("button", { name: "Move to Files Received" }).click();
  await page.getByRole("button", { name: "Move to Colour Grading" }).click();
  await page.goto("/colour-grading");
  await page.getByPlaceholder(/Search by order ID/).fill(code);
  const start = page.getByTestId(`job-${code}`).getByRole("button", { name: "Start" });
  if (await start.count()) await start.click(); else await page.getByTestId(`job-${code}`).click();
  const g = page.getByTestId("progress-grading");
  await g.getByLabel("Photos graded").fill("250"); await g.getByRole("button", { name: "Update" }).click();
  await expect(g.getByTestId("progress-grading-pct")).toContainText("250 / 300");

  await page.goto("/reports");
  await page.getByRole("tab", { name: "Team Performance" }).click();
  const perf = page.getByTestId("role-performance");
  await expect(perf).toBeVisible();
  await expect(perf.getByRole("tab", { name: "Colour Grading" })).toBeVisible();
  const row = perf.getByTestId("perf-table").locator("tbody tr").filter({ hasText: /\d/ }).first();
  await expect(row).toBeVisible();
  await expect(perf.getByTestId("perf-table")).toContainText("Photos graded");
  await row.click();
  await expect(page.getByTestId("perf-orders")).toBeVisible();
  for (const r of ["Designing", "Printing & Labs", "Quality Control", "Reception & Delivery"]) {
    await perf.getByRole("tab", { name: r }).click();
    await expect(perf.getByTestId("perf-table")).toBeVisible();
  }
  await expect(perf.getByTestId("lab-performance")).toHaveCount(0);
  await perf.getByRole("tab", { name: "Printing & Labs" }).click();
  await expect(perf.getByTestId("lab-performance")).toBeVisible();
});
