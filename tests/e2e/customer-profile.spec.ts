import { test, expect } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

// A customer saved twice with the same mobile shows once; the full profile shows every order, albums and the account.
test("customers: one line per mobile, merge duplicates, full profile with orders, albums and ledger", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  // two "new" customers with the same number → the second order reuses the first customer
  await buildOrder(page, { newCustomer: { name: "Dup Studio", phone: "9811122233" }, albums: [{ name: "One", sheets: 10 }], finalize: true });
  await buildOrder(page, { newCustomer: { name: "Dup Studio Again", phone: "9811122233" }, albums: [{ name: "Two", sheets: 10 }], finalize: true });
  await page.goto("/customers");
  await page.getByPlaceholder(/Search customer/).fill("9811122233");
  await expect(page.locator("tbody tr").filter({ hasText: "9811122233" })).toHaveCount(1);

  // a duplicate made the old way (two records, same mobile) shows as one line with "+1 duplicate" and can be merged
  await page.evaluate(() => {
    const k = "albumpro.v1.customers"; const list = JSON.parse(localStorage.getItem(k) ?? "[]") as Record<string, unknown>[];
    const base = list.find((c) => c.mobile === "9811122233")!;
    list.push({ ...base, id: "IDC999999", studio: "Dup Studio (old)", name: "Dup Studio (old)", since: "2026-12-31" });
    localStorage.setItem(k, JSON.stringify(list));
  });
  await page.reload();
  await page.getByPlaceholder(/Search customer/).fill("9811122233");
  const row = page.locator("tbody tr").filter({ hasText: "9811122233" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("+1 duplicate");
  page.once("dialog", (d) => void d.accept());
  await row.getByRole("button", { name: "Merge" }).click();
  await expect(page.getByText(/1 duplicate record\(s\) merged/).first()).toBeVisible();
  await expect(row).not.toContainText("duplicate");

  // full profile
  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/customers\/IDC/);
  await expect(page.getByTestId("customer-contact")).toContainText("9811122233");
  await expect(page.getByTestId("customer-orders").locator("tbody tr")).toHaveCount(2);
  await page.getByRole("tab", { name: /Albums/ }).click();
  await expect(page.getByTestId("customer-albums")).toContainText("One");
  await expect(page.getByTestId("customer-albums")).toContainText("Two");
  await page.getByRole("tab", { name: /Accounts/ }).click();
  await expect(page.getByTestId("customer-ledger").locator("tbody tr")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /Statement/ })).toBeVisible();
});
