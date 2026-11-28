import { test, expect } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

// Couple name: a column after Customer in the orders lists and on the order page; Edit order changes couple, event, due date, priority.
test("orders show the couple name; Edit order updates couple, event, due date and priority", async ({ page }) => {
  test.setTimeout(90_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Wedding album", sheets: 10 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  await page.getByRole("button", { name: "Edit order" }).click();
  const f = page.getByTestId("edit-order");
  await f.getByLabel("Couple name").fill("Asha & Ravi");
  await f.getByLabel("Event").fill("Reception");
  await f.getByLabel("Due date").fill("2026-12-20");
  await f.getByLabel("Priority").selectOption("High");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(`${code} updated`).first()).toBeVisible();
  await expect(page.getByText(/Asha & Ravi · Reception · .* · due 20 Dec 2026/)).toBeVisible();

  for (const list of ["/orders", "/design-orders"]) {
    await page.goto(list);
    await expect(page.getByRole("columnheader", { name: /Couple/ })).toBeVisible();
    await page.getByPlaceholder(/^Search by Order ID/).fill(code);
    await expect(page.getByTestId(`couple-${code}`)).toHaveText("Asha & Ravi");
  }
  await page.reload();
  await page.getByPlaceholder(/^Search by Order ID/).fill(code);
  await expect(page.getByTestId(`couple-${code}`)).toHaveText("Asha & Ravi");      // kept

  // reception can edit too; other roles can't
  await page.evaluate(() => localStorage.setItem("albumpro.role", "accounts"));
  await page.goto(`/orders/${code}`);
  await expect(page.getByRole("button", { name: "Edit order" })).toHaveCount(0);
});
