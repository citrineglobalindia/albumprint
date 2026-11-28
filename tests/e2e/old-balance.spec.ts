import { test, expect, type Page } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

// Old balance: money a customer owed before this system. Entered once on the customer, it counts in their dues,
// the pending-payments list and WhatsApp reminders; payments against it get receipts until it is cleared.
const PHONE = "9844455566";

async function openCustomer(page: Page) {
  await page.goto("/customers");
  await page.getByPlaceholder(/Search customer/).fill(PHONE);
  const row = page.locator("tbody tr").filter({ hasText: PHONE });
  await expect(row).toHaveCount(1);
  await row.getByRole("cell").nth(2).click();
  return page.getByTestId("old-balance");
}

test("old balance: enter it, it shows in dues and reminders, part payment with a receipt, limits hold", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await page.addInitScript(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open; });
  await buildOrder(page, { newCustomer: { name: "Old Dues Studio", phone: PHONE }, albums: [{ name: "Fresh album", sheets: 10 }], finalize: true });

  // the customer code column is hidden by default
  await page.goto("/customers");
  await expect(page.getByRole("columnheader", { name: /Customer ID/ })).toHaveCount(0);

  const card = await openCustomer(page);
  await card.getByRole("button", { name: "Add old balance" }).click();
  await card.getByLabel("Old balance amount").fill("25000");
  await card.getByLabel("Old balance note").fill("as per old ledger");
  await card.getByRole("button", { name: "Save old balance" }).click();
  await expect(page.getByText("Old balance of ₹25,000 saved for Old Dues Studio").first()).toBeVisible();
  await expect(card.getByTestId("old-balance-due")).toHaveText("₹25,000");

  // more than what is due is refused
  await card.getByRole("button", { name: "Receive payment" }).click();
  await card.getByLabel("Payment amount").fill("30000");
  await card.getByRole("button", { name: /^Receive/ }).click();
  await expect(page.getByText(/more than the old balance still due/).first()).toBeVisible();
  // a non-cash payment needs a reference
  await card.getByLabel("Payment amount").fill("10000");
  await card.getByLabel("Payment mode").selectOption("UPI");
  await card.getByRole("button", { name: /^Receive/ }).click();
  await expect(page.getByText(/reference \(UTR \/ cheque no\.\) is required/).first()).toBeVisible();
  await card.getByLabel("Payment reference").fill("UTR778899");
  await card.getByRole("button", { name: /^Receive/ }).click();
  await expect(page.getByText(/Received ₹10,000 against the old balance — receipt RCP-\d{4}-\d{4} · ₹15,000 still due/).first()).toBeVisible();
  await expect(card.getByTestId("old-balance-due")).toHaveText("₹15,000");
  await expect(card.getByRole("list", { name: "Payments against the old balance" }).getByRole("listitem")).toHaveCount(1);

  // the balance can't be set below what has been received
  await card.getByRole("button", { name: "Change old balance" }).click();
  await card.getByLabel("Old balance amount").fill("5000");
  await card.getByRole("button", { name: "Save old balance" }).click();
  await expect(page.getByText(/has already been received against the old balance/).first()).toBeVisible();
  await card.getByRole("button", { name: "Cancel" }).click();

  // payments: the customer is in the pending list with the old balance; the reminder names it
  await page.goto("/payments");
  const row = page.getByTestId("pending-dues").locator("[data-testid^=due-]").filter({ hasText: "Old Dues Studio" });
  await expect(row).toContainText("old balance ₹15,000");
  await row.getByRole("button", { name: "Show orders" }).click();
  await expect(row.getByTestId("old-balance-line")).toContainText("₹15,000");
  await row.getByRole("button", { name: /^Remind ₹/ }).click();
  const text = decodeURIComponent((await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.at(-1)!)).split("text=")[1]!);
  expect(text).toContain("• Old balance: ₹15,000");
  expect(text).toMatch(/IDP\d+/);

  // clearing the rest
  const card2 = await openCustomer(page);
  await card2.getByRole("button", { name: "Receive payment" }).click();
  await card2.getByRole("button", { name: /^Receive/ }).click();   // the amount defaults to what is due, cash
  await expect(page.getByText(/old balance cleared/).first()).toBeVisible();
  await expect(card2.getByTestId("old-balance-due")).toHaveText("Cleared");
});

test("old balance: reception can receive against it but cannot set it", async ({ page }) => {
  test.setTimeout(90_000);
  await seedRole(page, "admin");
  await buildOrder(page, { newCustomer: { name: "Old Dues Studio", phone: PHONE }, albums: [{ name: "Fresh album", sheets: 10 }], finalize: true });
  let card = await openCustomer(page);
  await card.getByRole("button", { name: "Add old balance" }).click();
  await card.getByLabel("Old balance amount").fill("8000");
  await card.getByRole("button", { name: "Save old balance" }).click();
  await expect(card.getByTestId("old-balance-due")).toHaveText("₹8,000");

  await page.evaluate(() => localStorage.setItem("albumpro.role", "reception"));
  card = await openCustomer(page);
  await expect(card.getByTestId("old-balance-due")).toHaveText("₹8,000");
  await expect(card.getByRole("button", { name: /old balance/ })).toHaveCount(0);
  await card.getByRole("button", { name: "Receive payment" }).click();
  await card.getByLabel("Payment amount").fill("3000");
  await card.getByRole("button", { name: /^Receive/ }).click();
  await expect(card.getByTestId("old-balance-due")).toHaveText("₹5,000");
});
