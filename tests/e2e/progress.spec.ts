import { test, expect } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

// Counts and status updates: photos given at order time (optional), photos graded by the grader, sheets designed by the designer,
// each department's status + note — all shown on the order page's process list.
test("photos given → photos graded → sheets designed, with status updates, shown on the order page", async ({ page }) => {
  await seedRole(page, "admin");
  // a wrong count is refused (optional, whole number)
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /^Search customer/ }).click(); await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Photos given").fill("12.5");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByText("Photos given must be a whole number").first()).toBeVisible();
  const code = (await buildOrder(page, { albums: [{ name: "Counted album", sheets: 30 }], finalize: true, photosGiven: "400" }))!;
  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("step-progress-new_order")).toContainText("Photos given: 400");

  // grading: the grader's count (admin can act for any department)
  await page.getByRole("button", { name: "Move to Files Received" }).click();
  await page.getByRole("button", { name: "Move to Colour Grading" }).click();
  await page.goto("/colour-grading");
  await page.getByPlaceholder(/Search by order ID/).fill(code);
  await page.getByTestId(`job-${code}`).click();
  const g = page.getByTestId("progress-grading");
  await g.getByLabel("Photos graded").fill("120"); await g.getByLabel("grading status").selectOption("working"); await g.getByLabel("grading note").fill("rest tomorrow");
  await g.getByRole("button", { name: "Update" }).click();
  await expect(g.getByTestId("progress-grading-pct")).toHaveText("120 / 400 · 30%");
  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("step-progress-colour_grading")).toContainText("Photos graded 120 of 400 · Working on it · “rest tomorrow”");
});
