import { test, expect, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { seedRole, buildOrder } from "./helpers";

// Product list import (the previous system's hierarchy) + the Prices grid + CSV round trip, then the price used in an order.
const items = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("albumpro.v1.cat2_items") ?? "[]") as { name: string; rate: number | null; method: string; unit: string }[]);
const REXINE = "Cover ▸ REXINE COVER ▸ 2 FOLD ▸ ABOVE 12X9";

test("import the product list, price it in bulk, use the price in an order", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Import product list" }).click();
  await expect(page.getByText(/Product list imported — 169 item\(s\) added/).first()).toBeVisible();
  await expect(page.getByTestId("price-grid")).toBeVisible();                       // jumps to the Prices tab
  await expect.poll(async () => (await items(page)).filter((i) => i.name === "ALL LAMINATION" && i.rate == null && i.method === "per_sheet").length).toBe(20);

  // running it again adds nothing
  await page.getByRole("button", { name: "Import product list" }).click();
  await expect(page.getByText("The product list is already in the catalog").first()).toBeVisible();

  // the hierarchy: Cover ▸ REXINE COVER ▸ 2 FOLD ▸ ABOVE 12X9
  await page.getByLabel("Search prices").fill("rexine 2 fold");
  await expect(page.getByLabel(`Rate for ${REXINE}`)).toBeVisible();
  await expect(page.getByLabel("Rate for Bag ▸ NORMAL ▸ 12X18")).toHaveCount(0);
  await page.getByLabel(`Rate for ${REXINE}`).fill("450");
  await expect(page.getByText("1 unsaved change(s)").first()).toBeVisible();

  // bulk fill: every Photo Print size at ₹25
  await page.getByLabel("Search prices").fill("");
  await page.getByLabel("Price group").selectOption({ label: "Photo Print" });
  await page.getByLabel("Rate for all shown").fill("25");
  await page.getByRole("button", { name: "Apply to 17 shown" }).click();
  await expect(page.getByText("18 unsaved change(s)").first()).toBeVisible();
  await page.getByLabel("Rate for Photo Print ▸ 4 x6").fill("-3");
  await page.getByRole("button", { name: /^Save 18 prices/ }).click();
  await expect(page.getByRole("alert")).toContainText("0 or more");                // nothing saved
  expect((await items(page)).filter((i) => i.rate != null && !/\(sample/.test(i.name))).toHaveLength(0);
  await page.getByLabel("Rate for Photo Print ▸ 4 x6").fill("20");
  await page.getByLabel("Price group").selectOption({ label: "Lamination" });
  await page.getByLabel("Rate for Lamination ▸ GLOSSY").fill("5");
  await page.getByRole("button", { name: /^Save 19 prices/ }).click();
  await expect(page.getByText("19 price(s) saved").first()).toBeVisible();
  await expect.poll(async () => (await items(page)).find((i) => i.name === "4 x6")?.rate).toBe(20);             // saved to this browser (autosave)
  expect((await items(page)).find((i) => i.name === "12X24")?.rate).toBe(25);

  // only unpriced
  await page.getByLabel("Price group").selectOption({ label: "Cover" });
  await page.getByRole("switch", { name: "Only unpriced" }).click();
  await expect(page.getByLabel(`Rate for ${REXINE}`)).toHaveCount(0);

  // CSV: export, edit, import (also adds a brand-new item)
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csv = await (await dl).createReadStream().then(async (s) => { let t = ""; for await (const c of s) t += c; return t; });
  expect(csv).toContain("Cover > REXINE COVER > 2 FOLD,ABOVE 12X9,per_unit,pcs,450");
  const edited = csv.replace("Bag > NORMAL,12X18,per_unit,pcs,", "Bag > NORMAL,12X18,per_unit,pcs,175") + "USB,128 GB WITH BOX,per_unit,pcs,\"1,250\"\n";
  const f = test.info().outputPath("prices.csv"); writeFileSync(f, edited);
  await page.getByLabel("Prices CSV file").setInputFiles(f);
  await expect(page.getByText("CSV imported — 1 new item(s), 2 price(s) updated").first()).toBeVisible();
  await expect.poll(async () => (await items(page)).find((i) => i.name === "128 GB WITH BOX")?.rate).toBe(1250);
  expect((await items(page)).find((i) => i.name === "12X18")?.rate).toBe(175);

  // the price is used by the order builder (Design + Printing, 10 sheets: sample printing ₹90 + design ₹40 per sheet)
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: /^Search customer/ }).click();
  await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Event type").selectOption("Wedding"); await page.getByLabel("Event date").fill("2026-12-12"); await page.getByRole("button", { name: "Next" }).click();
  const a1 = page.getByTestId("album-1");
  await a1.getByLabel("Sheets", { exact: true }).fill("10");
  const p1 = page.getByTestId("picker-1");
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: "Cover" });
  await p1.getByLabel("Subcategory").selectOption({ label: "REXINE COVER" });
  await p1.getByLabel("Level 3").selectOption({ label: "2 FOLD" });
  await p1.getByLabel("Item").selectOption({ label: "ABOVE 12X9" }); await p1.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("per-copy-1")).toHaveText("₹1,750");              // 10×90 + 10×40 + 450

  // a per-sheet item: Qty is filled from the album's sheets and keeps following them
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: "Lamination" });
  await p1.getByLabel("Item").selectOption({ label: "GLOSSY" });
  await expect(p1.getByLabel("Quantity")).toHaveValue("10");
  await expect(p1.getByText("auto = album sheets")).toBeVisible();
  await p1.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("per-copy-1")).toHaveText("₹1,800");              // + 10 × 5
  await a1.getByLabel("Sheets", { exact: true }).fill("12");
  await expect(a1.getByLabel("Quantity of GLOSSY")).toHaveValue("12");
  await expect(page.getByTestId("per-copy-1")).toHaveText("₹2,070");              // 12×130 + 450 + 12×5
  await a1.getByLabel("Quantity of GLOSSY").fill("4");                           // override
  await expect(page.getByTestId("per-copy-1")).toHaveText("₹2,030");
  await a1.getByLabel("Sheets", { exact: true }).fill("14");
  await expect(a1.getByLabel("Quantity of GLOSSY")).toHaveValue("4");            // an override stays
  await a1.getByRole("button", { name: "Match GLOSSY to album sheets" }).click();
  await expect(a1.getByLabel("Quantity of GLOSSY")).toHaveValue("14");
  await expect(page.getByTestId("per-copy-1")).toHaveText("₹2,340");              // 14×130 + 450 + 14×5
});

test("delete an item and a whole category branch; items used on orders are protected", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await page.goto("/catalog");
  await page.getByRole("button", { name: "Import product list" }).click();
  await page.getByRole("tab", { name: "Categories & items" }).or(page.getByRole("button", { name: "Categories & items" })).first().click();

  // one item
  await page.getByTestId("cat-Bag").click();
  await page.getByRole("button", { name: "Delete JUTE BAG" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Bag ▸ JUTE BAG");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("“JUTE BAG” deleted").first()).toBeVisible();
  await expect(page.getByTestId("item-JUTE BAG")).toHaveCount(0);

  // a whole branch: Bag ▸ NORMAL (3 items) and MATHCINGBAG (2) go with Bag
  await page.getByRole("button", { name: "Delete category Bag" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("2 sub-categories and 5 item(s)");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("cat-Bag")).toBeVisible();                        // cancel keeps everything
  await page.getByRole("button", { name: "Delete category Bag" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("“Bag” deleted").first()).toBeVisible();
  await expect(page.getByTestId("cat-Bag")).toHaveCount(0);
  await expect.poll(async () => (await items(page)).filter((i) => ["12X18", "12X15", "12X9", "JUTE BAG"].includes(i.name)).length).toBe(0);

  // an item on a finalized order cannot be deleted (sample cover used by an order)
  await buildOrder(page, { albums: [{ name: "Album", sheets: 10, cover: "Leatherette cover (sample)" }], finalize: true });
  await page.goto("/catalog");
  await page.getByTestId("cat-Sample — Covers").click();
  await page.getByRole("button", { name: "Delete Leatherette cover (sample)" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText(/used on existing orders, so it cannot be deleted/).first()).toBeVisible();
  await expect(page.getByTestId("item-Leatherette cover (sample)")).toBeVisible();
  await page.getByRole("button", { name: "Delete category Sample — Covers" }).click();
  await expect(page.getByText(/holds 1 item\(s\) used on existing orders/).first()).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
