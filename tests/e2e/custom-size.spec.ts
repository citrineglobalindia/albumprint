import { test, expect, type Page } from "@playwright/test";
import { seedRole } from "./helpers";

const next = (page: Page) => page.getByRole("button", { name: "Next" }).click();

test("a custom album size is typed once, then offered in the size list from then on", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await next(page);
  await page.getByRole("button", { name: /^Search customer/ }).click();
  await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await next(page);
  await page.getByLabel("Other event").fill("Asha & Ravi"); await page.getByLabel("Other event").press("Enter"); await next(page);

  const a1 = page.getByTestId("album-1");
  await a1.getByLabel("Size").selectOption("__custom");
  await a1.getByLabel("Custom size").fill("15 X 24");
  await a1.getByRole("button", { name: "Save" }).click();
  await expect(a1.getByLabel("Size")).toHaveValue("15x24");                         // kept on the album, tidied

  await page.getByRole("button", { name: "Add another album" }).click();
  const a2 = page.getByTestId("album-2");
  await expect(a2.getByLabel("Size").locator("option", { hasText: "15x24" })).toHaveCount(1);   // offered without typing again
  await a2.getByLabel("Size").selectOption("15x24");
  await expect(a2.getByLabel("Size")).toHaveValue("15x24");

  await page.reload();
  await expect(page.getByTestId("album-1").getByLabel("Size").locator("option", { hasText: "15x24" })).toHaveCount(1);   // still there after a reload
});
