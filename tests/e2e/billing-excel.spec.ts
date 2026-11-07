import { test, expect } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

test("billing suggests the most used items; one tap adds the item", async ({ page }) => {
  await seedRole(page, "admin");
  // an order with a catalog item makes it a "most used" item
  await buildOrder(page, { albums: [{ name: "Top A", sheets: 10 }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  const t = page.getByTestId("album-items-1");
  await t.getByRole("button", { name: "Add item" }).click();
  await t.getByLabel("New line product").fill("uv spot"); await t.getByLabel("New line product").press("Enter");
  await expect(t).toContainText(/UV spot/i);
  await page.getByRole("button", { name: /Finalize/ }).first().click(); await page.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(page.getByTestId("finalized")).toBeVisible();

  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /^Search customer/ }).click(); await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  const top = page.getByTestId("album-items-1").getByTestId("top-items");
  await expect(top).toContainText("Most used");
  const chip = top.getByRole("button", { name: /UV spot/i }).first();
  await chip.click();
  await expect(page.getByTestId("album-items-1")).toContainText(/UV spot/i);
  await expect(top.getByRole("button", { name: /UV spot/i })).toHaveCount(0);              // already on the album: no longer suggested
});

test("Excel downloads: orders, customers, payments, pending payments", async ({ page }) => {
  await seedRole(page, "admin");
  for (const [path, aria, file] of [["/orders", "Export orders to Excel", "orders.xlsx"], ["/customers", "Export customers to Excel", "customers.xlsx"], ["/payments", "Export pending payments to Excel", "pending-payments.xlsx"]] as const) {
    await page.goto(path);
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: aria }).click();
    const d = await dl;
    expect(d.suggestedFilename()).toBe(file);
    const buf = await (await d.createReadStream()).toArray();
    expect(Buffer.concat(buf).subarray(0, 2).toString()).toBe("PK");                       // a real .xlsx (zip)
  }
});
