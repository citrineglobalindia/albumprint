import { test, expect } from "@playwright/test";
import { seedRole, buildOrder, invoiceNow } from "./helpers";

// Catalog standard purchase cost per item → the order's purchase (expense) is estimated from it without choosing a lab;
// the real purchase bill (amount, bill no., date) entered on the order wins; profit = customer billing − purchase;
// Reports › Financial lists profit & expense per order with the bill numbers. Admin / accounts only.
test("standard purchase cost, purchase bill on the order, profit & expense report", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");

  // Catalog › Prices: standard purchase cost for the cover (sales rate ₹600)
  await page.goto("/catalog");
  await page.getByRole("tab", { name: "Prices" }).click();
  await page.getByTestId("purchase-lab").selectOption({ label: "Purchase cost · Standard (any lab)" });
  await page.getByLabel("Search prices").fill("Leatherette cover");
  await page.getByLabel(/^Purchase rate for .*Leatherette cover/).fill("250");
  await expect(page.getByTestId("price-grid")).toContainText("₹350 · 58%");
  await page.getByRole("button", { name: /^Save 1 change/ }).click();
  await expect(page.getByText(/1 purchase rate\(s\) for Standard cost saved/).first()).toBeVisible();

  // an order with 2 copies of that cover, no lab chosen: the purchase is estimated from the standard cost
  await buildOrder(page, { albums: [{ name: "Costed album", sheets: 10, copies: 2, cover: "Leatherette cover (sample)" }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await expect(page.getByTestId("album-1")).toContainText("From standard purchase costs: ₹500");
  await page.getByRole("button", { name: /Finalize/ }).first().click();
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  const id = (await page.getByTestId("finalized").locator("h2").innerText()).match(/IDP\d+/)![0];

  await page.goto(`/orders/${id}`);
  await expect(page.getByRole("heading", { name: "Lab, purchase & profit" })).toBeVisible();
  await expect(page.getByTestId("lab-estimate-1")).toContainText("Estimated from standard purchase costs: ₹500");
  const total = Number((await page.getByTestId("order-pricing").getByTestId("final-amount").innerText()).replace(/[^\d.]/g, ""));
  await expect(page.getByTestId("profit-value")).toContainText(`₹${(total - 500).toLocaleString("en-IN")}`);

  // the real purchase bill
  const a1 = page.getByTestId("lab-album-1");
  await a1.getByLabel(/^Purchase amount for/).fill("450");
  await a1.getByLabel(/^Bill number for/).fill("SUP-77");
  await a1.getByLabel(/^Bill date for/).fill("2026-10-02");
  await a1.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.getByText("Purchase saved · bill SUP-77").first()).toBeVisible();
  await expect(page.getByTestId("profit-value")).toContainText(`₹${(total - 450).toLocaleString("en-IN")}`);
  await expect(a1.getByRole("button", { name: "Save purchase" })).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("lab-album-1").getByLabel(/^Bill number for/)).toHaveValue("SUP-77");
  await expect(page.getByTestId("lab-album-1").getByLabel(/^Purchase amount for/)).toHaveValue("450");

  // Reports › Financial: profit & expense with the bill number
  await page.goto("/reports");
  await page.getByRole("tab", { name: "Financial" }).click();
  const report = page.getByTestId("profit-expense");
  await expect(report).toBeVisible();
  await expect(report.getByTestId("profit-table")).toContainText(id);
  await expect(report.getByTestId("profit-table")).toContainText("SUP-77");

  // reception sees neither purchase bills nor profit
  await page.evaluate(() => localStorage.setItem("albumpro.role", "reception"));
  await page.goto(`/orders/${id}`);
  await expect(page.getByTestId("lab-album-1")).toBeVisible();
  await expect(page.getByTestId("lab-album-1").getByLabel(/^Bill number for/)).toHaveCount(0);
  await expect(page.getByTestId("profit")).toHaveCount(0);
});
