import { test, expect } from "@playwright/test";
import { seedRole, buildOrder } from "./helpers";

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
  await page.getByRole("button", { name: /^Finalize order/ }).click();
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
