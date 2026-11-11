import { test, expect } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

// Department dashboards count real work only: graders and designers see their own (assigned) work, no made-up numbers.
test("designer dashboard counts only the designer's own work; an album assigned to them shows up", async ({ page }) => {
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Engagement", sheets: 20 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  await page.getByTestId("album-progress").getByTestId("assign-1-design").selectOption("U2");          // Ramesh Kumar, the demo designer
  await expect(page.getByTestId("album-progress").getByTestId("assign-1-design")).toHaveValue("U2");
  await page.evaluate(() => { localStorage.setItem("albumpro.role", "designer"); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Designer Dashboard" })).toBeVisible();
  await expect(page.getByText("Orders assigned to you")).toBeVisible();
  await expect(page.getByText("Client Correction")).toHaveCount(0);
  await expect(page.getByText("Admin Correction")).toHaveCount(0);
  await expect(page.getByRole("cell", { name: code })).toHaveCount(0);   // at New Order: not in the design queue yet…
  await expect(page.locator("main")).toContainText("Awaiting Design");
  const awaiting = page.getByText("Awaiting Design").locator("xpath=..");
  await expect(awaiting).toContainText(/[1-9]/);                         // …but counted as awaiting design for this designer
});

test("printing / QC / accounts dashboards have no fixed sample numbers", async ({ page }) => {
  for (const [role, gone] of [["printing", "Today Target"], ["qc", "Rework Pending"], ["accounts", "Refunds Pending"]] as const) {
    await page.goto("/");
    await page.evaluate((r) => { localStorage.setItem("albumpro.role", r); }, role);
    await page.goto("/");
    await expect(page.getByText(gone)).toHaveCount(0);
  }
});
