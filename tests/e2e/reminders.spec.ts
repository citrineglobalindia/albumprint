import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

// Pending payments / credit balance reminders: one tap opens WhatsApp with the customer's number and a ready message; the send is recorded.
test("payments: pending dues per customer, WhatsApp reminder for the balance and per order, last reminded is shown", async ({ page }) => {
  await seedRole(page, "admin");
  await page.addInitScript(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open; });
  await page.goto("/payments");
  const panel = page.getByTestId("pending-dues");
  await expect(panel).toBeVisible();
  const first = panel.locator("[data-testid^=due-]").first();
  await expect(first).toContainText("not reminded yet");
  await first.getByRole("button", { name: /^Remind ₹/ }).click();
  const url = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.at(-1)!);
  expect(url).toMatch(/^https:\/\/wa\.me\/91\d{10}\?text=/);
  const text = decodeURIComponent(url.split("text=")[1]!);
  expect(text).toContain("outstanding balance is ₹");
  expect(text).toMatch(/IDP\d+/);
  await expect(first).toContainText("reminded today");

  // per order
  await first.getByRole("button", { name: "Show orders" }).click();
  await first.getByRole("button", { name: "Remind", exact: true }).first().click();
  const t2 = decodeURIComponent((await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.at(-1)!)).split("text=")[1]!);
  expect(t2).toMatch(/is pending for order IDP\d+/);

  // the order page has the same one-tap reminder
  const code = (await first.getByRole("link").first().innerText()).trim();
  await page.goto(`/orders/${code}`);
  await page.getByTestId("remind-order").click();
  await expect(page.getByText(/WhatsApp opened with a reminder for ₹/).first()).toBeVisible();
});
