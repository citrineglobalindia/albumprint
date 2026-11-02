import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedRole, buildOrder } from "./helpers";

// Order builder verification (demo mode, with the labelled SAMPLE catalog and its demonstration prices):
//   printing 12x36 = ₹120/sheet, 12x36 + Metallic = ₹150, 12x30 = ₹110, Silk = ₹95, otherwise ₹90 · design ₹40/sheet
//   Leatherette cover ₹600 · Premium box ₹900 · Name foiling ₹800 per album · UV spot ₹15/sheet · Mini book ₹450 · Courier packing ₹250 per order
const next = (page: Page) => page.getByRole("button", { name: "Next" }).click();
const invoicesFor = (page: Page, code: string) => page.evaluate((c) => (JSON.parse(localStorage.getItem("albumpro.v1.invoices") ?? "[]") as { orderId: string; status: string; no: string }[]).filter((i) => i.orderId === c), code);

test("Design + Printing: multiple independent albums, dependent categories, all charge scopes, discount, PDF, one invoice, history kept, authorized edit", async ({ page }) => {
  test.setTimeout(180_000);
  await seedRole(page, "admin");
  page.on("dialog", (d) => void d.accept());
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await next(page);
  await page.getByRole("button", { name: /^Search customer/ }).click();
  await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await next(page);
  await page.getByLabel("Event type").selectOption("Wedding"); await page.getByLabel("Event name").fill("Asha & Ravi"); await page.getByLabel("Event date").fill("2026-12-12"); await next(page);

  // album 1: 30 sheets × 2 copies, 12x36 Metallic, cover + box (per copy), UV spot per sheet (Extras ▸ Premium), name foiling (per album)
  const a1 = page.getByTestId("album-1");
  await a1.getByLabel("Album name").fill("Wedding album"); await a1.getByLabel("Copies").fill("2");
  await a1.getByLabel("Size").selectOption("12x36"); await a1.getByLabel("Paper type").selectOption("Metallic");
  await a1.getByLabel("Cover").selectOption({ label: "Leatherette cover (sample)" }); await a1.getByLabel("Box").selectOption({ label: "Premium box (sample)" });
  const p1 = page.getByTestId("picker-1");
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: "Sample — Extras" });
  await p1.getByLabel("Subcategory").selectOption({ label: "Premium" });
  await p1.getByLabel("Item").selectOption({ label: "UV spot finish (sample, per sheet)" }); await p1.getByRole("button", { name: "Add" }).click();
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: "Sample — Extras" });
  await expect(p1.getByLabel("Subcategory")).toHaveValue("");                     // changing a parent cleared the child selection
  await p1.getByLabel("Item").selectOption({ label: "Name foiling (sample)" }); await p1.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("per-copy-1")).toHaveText("₹7,650");             // 30×150 + 30×40 + 600 + 900 + 30×15
  await expect(page.getByTestId("album-total-1")).toHaveText("₹16,100");          // 7,650 × 2 + 800 once

  // album 2: a level-3 item, the size rule beats the paper rule
  await page.getByRole("button", { name: "Add another album" }).click();
  const a2 = page.getByTestId("album-2");
  await a2.getByLabel("Album name").fill("Engagement album"); await a2.getByLabel("Sheets").fill("20");
  await a2.getByLabel("Size").selectOption("12x30"); await a2.getByLabel("Paper type").selectOption("Silk");
  const p2 = page.getByTestId("picker-2");
  await p2.getByLabel("Category", { exact: true }).selectOption({ label: "Sample — Extras" }); await p2.getByLabel("Subcategory").selectOption({ label: "Premium" });
  await p2.getByLabel("Level 3").selectOption({ label: "Keepsakes" }); await p2.getByLabel("Item").selectOption({ label: "Mini book (sample)" });
  await p2.getByLabel("Quantity").fill("2"); await p2.getByRole("button", { name: "Add" }).click();
  await p2.getByLabel("Category", { exact: true }).selectOption({ label: "Sample — Covers" });
  await expect(p2.getByLabel("Subcategory")).toHaveCount(0);                       // no empty levels: covers has no sub-categories
  await expect(page.getByTestId("album-total-2")).toHaveText("₹3,900");           // 20×110 + 20×40 + 2×450
  await expect(page.getByTestId("album-lines-2")).toContainText("size 12x30");

  // duplicate is independent; then remove it
  await page.getByRole("button", { name: "Duplicate" }).click();
  const a3 = page.getByTestId("album-3");
  await expect(a3.getByLabel("Album name")).toHaveValue("Engagement album (copy)");
  await a3.getByLabel("Copies").fill("3");
  await expect(page.getByTestId("album-total-3")).toHaveText("₹11,700");
  await page.getByRole("tab", { name: /^Engagement album\s*₹/ }).click();
  await expect(page.getByTestId("album-total-2")).toHaveText("₹3,900");
  await page.getByRole("tab", { name: /Engagement album \(copy\)/ }).click();
  await page.getByTestId("album-3").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("tab", { name: /\(copy\)/ })).toHaveCount(0);

  // a one-time order charge
  const oc = page.getByTestId("order-charge-picker");
  await oc.getByLabel("Category", { exact: true }).selectOption({ label: "Sample — Order charges" }); await oc.getByLabel("Item").selectOption({ label: "Courier packing (sample)" }); await oc.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("sum-subtotal")).toHaveText("₹20,250");           // 16,100 + 3,900 + 250
  await next(page);

  // invoice step: fixed discount, validation, preview
  await page.getByLabel("Discount type").selectOption("fixed"); await page.getByLabel("Discount value").fill("99999");
  await expect(page.getByText("The discount cannot be more than the order subtotal").first()).toBeVisible();
  await page.getByLabel("Discount value").fill("250");
  await expect(page.getByTestId("final-amount")).toHaveText("₹20,000");
  await expect(page.getByRole("region", { name: "Invoice section Wedding album" })).toContainText("Per album");
  await expect(page.getByRole("region", { name: "Invoice section Engagement album" })).toBeVisible();
  await next(page);

  // finalize (double click → still one order, one invoice)
  await page.getByRole("button", { name: /^Finalize order/ }).dblclick();
  await expect(page.getByTestId("finalized")).toBeVisible();
  const inv1 = (await page.getByTestId("done-invoice").textContent())!;
  expect(inv1).toMatch(/^INV-\d{4}-\d{4}$/);
  const code = (await page.getByRole("link", { name: "Open the order" }).getAttribute("href"))!.split("/").pop()!;
  await expect.poll(async () => (await invoicesFor(page, code)).length).toBe(1);

  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download invoice PDF" }).click()]);
  expect(dl.suggestedFilename()).toBe(`${inv1}.pdf`);
  const pdf = readFileSync((await dl.path())!);
  expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  expect(pdf.length).toBeGreaterThan(3000);

  // the order keeps its pricing; a catalog change later does not alter it
  await page.getByRole("link", { name: "Open the order" }).click();
  const panel = page.getByTestId("order-pricing");
  await expect(panel.getByTestId("final-amount")).toHaveText("₹20,000");
  await expect(panel.getByTestId("invoice-number")).toHaveText(inv1);
  await page.goto("/catalog");
  await page.getByTestId("cat-Sample — Printing").click();
  await page.getByRole("button", { name: "Edit Album printing (sample rates)" }).click();
  const rules = page.getByTestId("rate-rules");
  await rules.getByRole("row", { name: /12x36 Metallic/ }).getByRole("button", { name: "Remove rule" }).click();
  await expect(rules.getByRole("row", { name: /12x36 Metallic/ })).toHaveCount(0);
  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("order-pricing").getByTestId("final-amount")).toHaveText("₹20,000");
  await expect(page.getByTestId("order-pricing")).toContainText("size 12x36 · paper Metallic");

  // authorized edit: admin reopens with a reason → new revision, new invoice number, old invoice void
  await page.getByRole("button", { name: "Edit (reopen)" }).click();
  await page.getByRole("button", { name: "Reopen for editing" }).click();
  await expect(page.getByRole("dialog", { name: "Reopen order" }).getByRole("alert")).toContainText("reason");
  await page.getByLabel("Reason for reopening").fill("customer wants 2 engagement copies");
  await page.getByRole("button", { name: "Reopen for editing" }).click();
  await expect(page).toHaveURL(/\/orders\/new\?draft=/);
  await expect(page.getByText("Authorized edit of a finalized order")).toBeVisible();
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await page.getByRole("tab", { name: /^Engagement album/ }).click();
  await page.getByTestId("album-2").getByLabel("Copies").fill("2");
  await expect(page.getByTestId("sum-total")).toHaveText("₹22,100");            // album 1 now prices at the 12x36 rule (₹120): 14,300 + 7,800 + 250 − 250
  await page.getByRole("button", { name: /Finalize/ }).first().click();
  await page.getByRole("button", { name: /Finalize changes/ }).click();
  await expect(page.getByTestId("finalized")).toContainText("revision 2");
  const inv2 = (await page.getByTestId("done-invoice").textContent())!;
  expect(inv2).not.toBe(inv1);
  await expect.poll(async () => (await invoicesFor(page, code)).map((i) => `${i.no}:${i.status}`).sort()).toEqual([`${inv1}:Void`, `${inv2}:Sent`].sort());
});

test("Album Printing Only: no design charge; new customer; discount above the threshold needs an admin", async ({ page }) => {
  await seedRole(page, "reception");
  await buildOrder(page, { type: /Album Printing Only/, newCustomer: { name: "Walk-in Studio", phone: "9123456780" }, albums: [{ name: "Print job", sheets: 30, size: "12x36" }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await expect(page.getByTestId("album-lines-1")).not.toContainText("design");
  await expect(page.getByTestId("album-total-1")).toHaveText("₹3,600");
  await page.getByRole("button", { name: /^(5\s*)?Invoice$/ }).click();
  await page.getByLabel("Discount type").selectOption("percent"); await page.getByLabel("Discount value").fill("20");
  await next(page);
  await page.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(page.getByRole("alert")).toContainText("needs an admin");
  await page.getByRole("button", { name: /^(5\s*)?Invoice$/ }).click();
  await page.getByLabel("Discount value").fill("5");
  await expect(page.getByTestId("final-amount")).toHaveText("₹3,420");
  await next(page);
  await page.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(page.getByTestId("finalized")).toContainText("₹3,420");
});

test("a missing price shows “Price not configured” and blocks finalizing", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/catalog");
  await page.getByTestId("cat-Sample — Extras").click();
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Item name").fill("Gold edges (unpriced)");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.getByText("Item added").first()).toBeVisible();
  await buildOrder(page, { finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  const p1 = page.getByTestId("picker-1");
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: "Sample — Extras" }); await p1.getByLabel("Item").selectOption({ label: "Gold edges (unpriced)" }); await p1.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("album-lines-1")).toContainText("Price not configured");
  await expect(page.getByTestId("summary")).toContainText("Price not configured");
  await page.getByRole("button", { name: /^6\s*Finalize/ }).click();
  await expect(page.getByTestId("blocking")).toContainText("price not configured for “Gold edges (unpriced)”");
  await expect(page.getByRole("button", { name: /^Finalize order/ })).toBeDisabled();
});

test("drafts: save, leave, resume with everything kept; steps keep their data", async ({ page }) => {
  await seedRole(page, "admin");
  await buildOrder(page, { albums: [{ name: "Draft album", sheets: 44, copies: 3 }], finalize: false });
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved").first()).toBeVisible();
  await page.goto("/orders");
  await page.getByRole("button", { name: /^Drafts/ }).click();
  await page.getByRole("dialog", { name: "Saved drafts" }).getByRole("button", { name: /Sharma Studio/ }).first().click();
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await expect(page.getByTestId("album-1").getByLabel("Album name")).toHaveValue("Draft album");
  await expect(page.getByTestId("album-1").getByLabel("Sheets")).toHaveValue("44");
  await page.getByRole("button", { name: /Event & dates/ }).click();
  await expect(page.getByLabel("Event date")).toHaveValue("2026-12-12");
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await expect(page.getByTestId("album-1").getByLabel("Copies")).toHaveValue("3");
});

test("catalog admin: four optional levels, duplicates and circular parents refused, inactive branches hidden from orders", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/catalog");
  const addCat = async (name: string) => { await page.getByLabel("Category name").fill(name); await page.getByRole("button", { name: "Save category" }).click(); };
  await page.getByRole("button", { name: "Category", exact: true }).click(); await addCat("Test Cat");
  await page.getByRole("button", { name: "Add subcategory" }).click(); await addCat("L2");
  await page.getByRole("button", { name: "Add level 3" }).click(); await addCat("L3");
  await page.getByRole("button", { name: "Add level 4" }).click(); await addCat("L4");
  await expect(page.getByText("Test Cat ▸ L2 ▸ L3 ▸ L4")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add (level|sub)/ })).toHaveCount(0);           // no fifth level
  await page.getByRole("button", { name: "Add item" }).click();
  await page.getByLabel("Item name").fill("Deep item"); await page.getByLabel("Standard rate").fill("10");
  await page.getByRole("button", { name: "Save item" }).click(); await expect(page.getByText("Item added").first()).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
  // duplicate names under the same parent
  await page.getByRole("button", { name: "Category", exact: true }).click(); await addCat("test cat");
  await expect(page.getByRole("alert")).toContainText("already exists");
  await page.getByRole("button", { name: "Cancel" }).click();
  // circular: "Test Cat" cannot be moved under its own descendants
  await page.getByTestId("cat-Test Cat").click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Parent category").locator("option", { hasText: "Test Cat ▸ L2" })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel" }).click();
  // the order builder walks the levels down to the level-4 item
  await buildOrder(page, { finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  const p1 = page.getByTestId("picker-1");
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: "Test Cat" }); await p1.getByLabel("Subcategory").selectOption({ label: "L2" });
  await p1.getByLabel("Level 3").selectOption({ label: "L3" }); await p1.getByLabel("Level 4").selectOption({ label: "L4" });
  await expect(p1.getByLabel("Item").locator("option", { hasText: "Deep item" })).toHaveCount(1);
  // deactivate L2: the whole branch disappears from new orders
  await page.goto("/catalog");
  await page.getByTestId("cat-Test Cat").click();
  await page.getByTestId("cat-L2").click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("switch", { name: "Active" }).click(); await page.getByRole("button", { name: "Save category" }).click();
  await buildOrder(page, { finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await expect(page.getByTestId("picker-1").getByLabel("Category", { exact: true }).locator("option", { hasText: "Test Cat" })).toHaveCount(0);
});

test("tax is optional and configured by the admin; it is charged on the amount after discount", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/catalog");
  await page.getByRole("tab", { name: "Tax & defaults" }).click();
  await page.getByRole("switch", { name: "Charge tax" }).click();
  await page.getByLabel("Tax label").fill("GST"); await page.getByLabel("Tax rate").fill("18");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Pricing settings saved").first()).toBeVisible();
  await buildOrder(page, { type: /Album Printing Only/, albums: [{ name: "Taxed", sheets: 30, size: "12x36" }], finalize: false });
  await page.getByRole("button", { name: /^(5\s*)?Invoice$/ }).click();
  await expect(page.getByTestId("invoice-totals")).toContainText("GST @ 18%");
  await expect(page.getByTestId("final-amount")).toHaveText("₹4,248");             // 3,600 + 18%
  await page.getByLabel("Discount type").selectOption("fixed"); await page.getByLabel("Discount value").fill("100");
  await expect(page.getByTestId("final-amount")).toHaveText("₹4,130");             // (3,600 − 100) × 1.18
  await page.getByRole("switch", { name: "Apply tax" }).click();
  await expect(page.getByTestId("final-amount")).toHaveText("₹3,500");
});
