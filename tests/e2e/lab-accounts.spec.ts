import { test, expect } from "@playwright/test";
import path from "node:path";
import { seedRole, buildOrder } from "./helpers";

// Purchase bill file on the order; Labs page: lab-wise purchase history (view / upload bill), payments made and payable.
test("purchase bill upload, lab-wise purchase history, payments to the lab and what is still payable", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await page.addInitScript(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open; });
  await page.goto("/labs");
  await page.getByRole("button", { name: "Add lab" }).click();
  await page.getByLabel("Lab name").fill("Bill Lab"); await page.getByRole("button", { name: "Save lab" }).click();
  await expect(page.getByTestId("lab-list")).toContainText("Bill Lab");

  const code = (await buildOrder(page, { albums: [{ name: "Lab album", sheets: 10 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  const a1 = page.getByTestId("lab-album-1");
  await a1.getByLabel(/^Lab for/).selectOption({ label: "Bill Lab" });
  // the bill can't be attached before the purchase is saved
  await expect(a1.getByLabel(/^Attach purchase bill for/)).toBeDisabled();
  await a1.getByLabel(/^Purchase amount for/).fill("500");
  await a1.getByLabel(/^Bill number for/).fill("SUP-1");
  await a1.getByRole("button", { name: "Save purchase" }).click();
  await expect(page.getByText("Purchase saved · bill SUP-1").first()).toBeVisible();
  await a1.getByLabel(/^Attach purchase bill for/).setInputFiles(path.join(process.cwd(), "tests", "fixtures", "purchase-bill.pdf"));
  await expect(page.getByText("Bill attached: purchase-bill.pdf").first()).toBeVisible();
  await a1.getByTestId("bill-file-1").getByRole("button", { name: "purchase-bill.pdf" }).click();
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.at(-1)!)).toMatch(/^blob:/);

  // Labs page: payable, history, payment
  await page.goto("/labs");
  const lab = page.getByTestId("lab-payables").locator("tr").filter({ hasText: "Bill Lab" });
  await expect(lab).toContainText("₹500");
  await lab.click();
  const detail = page.getByTestId("lab-detail");
  await expect(detail.getByTestId("lab-payable")).toContainText("Payable ₹500");
  await expect(detail.getByTestId("lab-purchases")).toContainText(code);
  await expect(detail.getByTestId("lab-purchases")).toContainText("SUP-1");
  await expect(detail.getByRole("button", { name: `View bill for ${code} album 1` })).toBeVisible();
  await detail.getByLabel("Lab payment amount").fill("200");
  await detail.getByLabel("Lab payment reference").fill("UTR-55");
  await detail.getByRole("button", { name: "Save payment" }).click();
  await expect(page.getByText(/Payment of ₹200 to Bill Lab saved · still payable ₹300/).first()).toBeVisible();
  await expect(detail.getByTestId("lab-payable")).toContainText("Payable ₹300");
  await expect(detail.getByTestId("lab-payments")).toContainText("UTR-55");
  await expect(lab).toContainText("₹300");

  // reception sees none of it
  await page.evaluate(() => localStorage.setItem("albumpro.role", "reception"));
  await page.goto("/labs");
  await expect(page.getByTestId("lab-payables")).toHaveCount(0);
});
