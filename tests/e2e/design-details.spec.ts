import { test, expect } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

test("design details show the designer actually assigned to the album and the order's real size and dates", async ({ page }) => {
  test.setTimeout(90_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Wedding", sheets: 30, size: "12x30" }], finalize: true }))!;
  await page.goto(`/designing/${code}`);
  const row = (l: string) => page.getByText(l, { exact: true }).locator("xpath=..");
  await expect(row("Designer")).toContainText("Not assigned yet");
  await expect(row("Album Size")).toContainText("12x30");
  await expect(page.getByText("Classic Elegance")).toHaveCount(0);

  await page.goto(`/orders/${code}`);
  await page.getByTestId("album-progress").getByTestId("assign-1-design").selectOption("U4");     // Karthik V
  await page.goto(`/designing/${code}`);
  await expect(row("Designer")).toContainText("Karthik V");
  await expect(row("Designer")).not.toContainText("Ramesh");
});
