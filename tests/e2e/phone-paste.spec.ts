import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

// Pasting a copied mobile number keeps the whole number: spaces, dashes, brackets, +91 / 91 and a leading 0 are dropped.
const CASES: [string, string][] = [
  ["+91 98765 43210", "9876543210"], ["+91-98765-43210", "9876543210"], ["919876543210", "9876543210"],
  ["09876543210", "9876543210"], ["98765 43210", "9876543210"], ["(987) 654-3210", "9876543210"], ["9876543210", "9876543210"],
];

test("new order: pasting a copied phone number keeps all of it", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "New customer" }).click();
  const phone = page.getByLabel("Phone number");
  for (const [pasted, want] of CASES) {
    await phone.fill("");
    await phone.focus();
    await page.keyboard.insertText(pasted);           // like a paste: the whole text at once
    await expect(phone, pasted).toHaveValue(want);
  }
});

test("customers: pasting a copied mobile number keeps all of it", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/customers");
  await page.getByRole("button", { name: "Add Customer" }).click();
  const m = page.getByRole("textbox", { name: "Mobile number", exact: true });
  await m.focus(); await page.keyboard.insertText("+91 91812 38475");
  await expect(m).toHaveValue("9181238475");
});
