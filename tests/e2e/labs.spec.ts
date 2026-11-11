import { test, expect } from "@playwright/test";
import { seedRole, buildOrder, invoiceNow } from "./helpers";

// Printing labs: the admin keeps the lab list; each album gets a lab and a purchase amount (profit = selling − purchase);
// staff send the album to the lab and mark it received back, from the order page or the Labs page.
test("labs: add a lab, choose it for an album with a purchase amount, see profit, send and receive", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/labs");
  await page.getByRole("button", { name: "Add lab" }).click();
  await page.getByLabel("Lab name").fill("Sharp Print Lab"); await page.getByLabel("Lab phone").fill("9876500011");
  await page.getByRole("button", { name: "Save lab" }).click();
  await expect(page.getByTestId("lab-list")).toContainText("Sharp Print Lab");

  const code = (await buildOrder(page, { albums: [{ name: "Lab album", sheets: 10 }], finalize: false }))!;
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await page.getByTestId("album-1").getByLabel("Album lab").selectOption({ label: "Sharp Print Lab" });
  await page.getByTestId("album-1").getByLabel("Album purchase amount").fill("500");
  await page.getByRole("button", { name: /Finalize/ }).first().click();
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(page.getByTestId("finalized")).toBeVisible();
  const id = code || (await page.getByTestId("finalized").locator("h2").innerText()).match(/IDP\d+/)![0];

  await page.goto(`/orders/${id}`);
  const a1 = page.getByTestId("lab-album-1");
  await expect(a1.getByLabel(/^Lab for/)).toHaveValue(/.+/);
  await expect(a1.getByLabel(/^Purchase amount for/)).toHaveValue("500");
  const total = Number((await page.getByTestId("order-pricing").getByTestId("final-amount").innerText()).replace(/[^\d.]/g, ""));
  await expect(page.getByTestId("profit-value")).toContainText(`₹${(total - 500).toLocaleString("en-IN")}`);
  await a1.getByRole("button", { name: "Send to lab" }).click();
  await expect(a1.getByTestId("lab-status")).toHaveText("At lab");

  await page.goto("/labs");
  const row = page.getByTestId(`labrow-${id}-1`);
  await expect(row).toContainText("Sharp Print Lab");
  await row.getByRole("button", { name: "Receive" }).click();
  await page.getByRole("tab", { name: /Received/ }).click();
  await expect(page.getByTestId(`labrow-${id}-1`)).toContainText("Received");
  await expect(page.getByTestId("profit-table")).toContainText(id);
});

test("purchase rates per lab and item: the album's purchase cost and the profit are worked out from them", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/labs");
  await page.getByRole("button", { name: "Add lab" }).click();
  await page.getByLabel("Lab name").fill("Rate Lab"); await page.getByRole("button", { name: "Save lab" }).click();
  await expect(page.getByTestId("lab-list")).toContainText("Rate Lab");

  // Catalog › Prices: choose the lab, type its purchase rate for the cover; the margin shows next to the sales rate (₹600)
  await page.goto("/catalog");
  await page.getByRole("tab", { name: "Prices" }).click();
  await page.getByTestId("purchase-lab").selectOption({ label: "Purchase rates · Rate Lab" });
  await page.getByLabel("Search prices").fill("Leatherette cover");
  await page.getByLabel(/^Purchase rate for .*Leatherette cover/).fill("250");
  await expect(page.getByTestId("price-grid")).toContainText("₹350 · 58%");
  await page.getByRole("button", { name: /^Save 1 change/ }).click();
  await expect(page.getByText(/1 purchase rate\(s\) for Rate Lab saved/).first()).toBeVisible();

  // an order: 2 copies with that cover at Rate Lab, no purchase amount typed → 2 × ₹250 from the lab's rates
  await buildOrder(page, { albums: [{ name: "Rated album", sheets: 10, copies: 2, cover: "Leatherette cover (sample)" }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await page.getByTestId("album-1").getByLabel("Album lab").selectOption({ label: "Rate Lab" });
  await expect(page.getByTestId("album-1")).toContainText("From Rate Lab rates: ₹500");
  await page.getByRole("button", { name: /Finalize/ }).first().click();
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  const id = (await page.getByTestId("finalized").locator("h2").innerText()).match(/IDP\d+/)![0];
  await page.goto(`/orders/${id}`);
  await expect(page.getByTestId("lab-estimate-1")).toContainText("Using Rate Lab rates: ₹500");
  const total = Number((await page.getByTestId("order-pricing").getByTestId("final-amount").innerText()).replace(/[^\d.]/g, ""));
  await expect(page.getByTestId("profit-value")).toContainText(`₹${(total - 500).toLocaleString("en-IN")}`);
  // a typed amount wins over the lab rates
  await page.getByTestId("lab-album-1").getByLabel(/^Purchase amount for/).fill("650");
  await page.getByTestId("lab-album-1").getByLabel(/^Purchase amount for/).blur();
  await expect(page.getByTestId("profit-value")).toContainText(`₹${(total - 650).toLocaleString("en-IN")}`);
});
