import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedRole, buildOrder, invoiceNow } from "./helpers";

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
  await page.getByLabel("Other event").fill("Asha & Ravi"); await page.getByLabel("Other event").press("Enter"); await page.getByLabel("Event date").fill("2026-12-12"); await next(page);

  // album 1: 30 sheets × 2 copies, 12x36, cover + box (per copy), UV spot per sheet (Extras ▸ Premium), name foiling (per album)
  const a1 = page.getByTestId("album-1");
  await a1.getByLabel("Sheets").fill("30");
  await a1.getByLabel("Album name").fill("Wedding album"); await a1.getByLabel("Copies").fill("2");
  await a1.getByLabel("Size").selectOption("12x36");
  await a1.getByLabel("Cover").selectOption({ label: "Leatherette cover (sample)" }); await a1.getByLabel("Box").selectOption({ label: "Premium box (sample)" });
  const p1 = page.getByTestId("picker-1");
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: "Sample — Extras" });
  await p1.getByLabel("Subcategory").selectOption({ label: "Premium" });
  await p1.getByLabel("Item").selectOption({ label: "UV spot finish (sample, per sheet)" }); await p1.getByRole("button", { name: "Add" }).click();
  await p1.getByLabel("Category", { exact: true }).selectOption({ label: "Sample — Extras" });
  await expect(p1.getByLabel("Subcategory")).toHaveValue("");                     // changing a parent cleared the child selection
  await p1.getByLabel("Item").selectOption({ label: "Name foiling (sample)" }); await p1.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("per-copy-1")).toHaveText("₹6,750");             // 30×120 (12x36 rule; no paper type on the album) + 30×40 + 600 + 900 + 30×15
  await expect(page.getByTestId("album-total-1")).toHaveText("₹14,300");          // 6,750 × 2 + 800 once

  // album 2: a level-3 item, the size rule beats the paper rule
  await page.getByRole("button", { name: "Add another album" }).click();
  const a2 = page.getByTestId("album-2");
  await a2.getByLabel("Album name").fill("Engagement album"); await a2.getByLabel("Sheets").fill("20");
  await a2.getByLabel("Size").selectOption("12x30");
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
  await expect(page.getByTestId("sum-subtotal")).toHaveText("₹18,450");           // 14,300 + 3,900 + 250
  await next(page);

  // invoice step: fixed discount, validation, preview
  await page.getByLabel("Discount type").selectOption("fixed"); await page.getByLabel("Discount value").fill("99999");
  await expect(page.getByText("The discount cannot be more than the order subtotal").first()).toBeVisible();
  await page.getByLabel("Discount value").fill("250");
  await expect(page.getByTestId("final-amount")).toHaveText("₹18,200");
  await expect(page.getByRole("region", { name: "Invoice section Wedding album" })).toContainText("Per album");
  await expect(page.getByRole("region", { name: "Invoice section Engagement album" })).toBeVisible();
  await next(page);

  // finalize (double click → still one order, one invoice)
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).dblclick();
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
  await expect(panel.getByTestId("final-amount")).toHaveText("₹18,200");
  await expect(panel.getByTestId("invoice-number")).toHaveText(inv1);
  await page.goto("/catalog");
  await page.getByTestId("cat-Sample — Printing").click();
  await page.getByRole("button", { name: "Edit Album printing (sample rates)" }).click();
  const rules = page.getByTestId("rate-rules");
  await rules.getByRole("row", { name: /12x36 Metallic/ }).getByRole("button", { name: "Remove rule" }).click();
  await expect(rules.getByRole("row", { name: /12x36 Metallic/ })).toHaveCount(0);
  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("order-pricing").getByTestId("final-amount")).toHaveText("₹18,200");
  await expect(page.getByTestId("order-pricing")).toContainText("size 12x36");

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
  await expect(page.getByTestId("sum-total")).toHaveText("₹22,100");            // 14,300 + 7,800 (2 engagement copies) + 250 − 250
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
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(page.getByRole("alert")).toContainText("needs an admin");
  await page.getByRole("button", { name: /^(5\s*)?Invoice$/ }).click();
  await page.getByLabel("Discount value").fill("5");
  await expect(page.getByTestId("final-amount")).toHaveText("₹3,420");
  await next(page);
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
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
  await expect(page.getByLabel("Price of Gold edges (unpriced)")).toHaveAttribute("placeholder", "Not set");
  await expect(page.getByTestId("summary")).toContainText("Price not configured");
  await page.getByRole("button", { name: /^6\s*Finalize/ }).click();
  await invoiceNow(page);
  await expect(page.getByTestId("blocking")).toContainText("price not configured for “Gold edges (unpriced)”");
  await expect(page.getByRole("button", { name: /^Finalize order/ })).toBeDisabled();
  // typing a price on the line prices it for this order
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await page.getByLabel("Price of Gold edges (unpriced)").fill("250");
  await expect(page.getByTestId("summary")).not.toContainText("Price not configured");
  await page.getByRole("button", { name: /^6\s*Finalize/ }).click();
  await expect(page.getByRole("button", { name: /^Finalize order/ })).toBeEnabled();
});

test("album items table: search to add, edit description / qty / price / discount, totals, columns", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "reception");
  await buildOrder(page, { type: /Album Printing Only/, albums: [{ name: "Table album", sheets: 30 }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  const t = page.getByTestId("album-items-1");
  // printing (sample 12x36 ₹120 × 30) is an automatic row
  await expect(page.getByTestId("album-lines-1")).toContainText("automatic");
  await expect(page.getByTestId("album-total-1")).toHaveText("₹3,600");
  // search and add from inside the table
  // "+ Add item" opens a new blank line: pick from the full list, or type to search, right there
  await t.getByRole("button", { name: "Add item" }).click();
  await expect(t.getByTestId("new-line")).toBeVisible();
  await expect(t.getByLabel("New line product")).toBeFocused();
  await expect(t.getByRole("listbox", { name: "Products" }).getByRole("option")).not.toHaveCount(0);   // everything listed before typing
  await t.getByLabel("New line product").press("Escape");                            // Esc closes the line
  await expect(t.getByTestId("new-line")).toHaveCount(0);
  await t.getByRole("button", { name: "Add item" }).click();
  await t.getByLabel("New line product").fill("uv spot");
  await t.getByRole("listbox", { name: "Products" }).getByRole("option", { name: /UV spot finish/ }).click();
  await expect(t.getByTestId("new-line")).toHaveCount(0);                            // the line became the item
  await expect(t.getByTestId("line-name").filter({ hasText: "UV spot" })).toHaveText("Sample — Extras - Premium - UV spot finish (sample, per sheet)");   // every level on screen
  await expect(t.getByLabel("Quantity of UV spot finish (sample, per sheet)")).toHaveValue("30");
  await expect(page.getByTestId("album-total-1")).toHaveText("₹4,050");             // + 30 × 15
  // in the new line: arrow keys + Enter pick the highlighted product; a duplicate is refused and the line stays open
  await t.getByRole("button", { name: "Add item" }).click();
  await t.getByLabel("New line product").fill("mini");
  await t.getByLabel("New line product").press("ArrowDown"); await t.getByLabel("New line product").press("ArrowUp");
  await t.getByLabel("New line product").press("Enter");
  await expect(t.getByLabel("Quantity of Mini book (sample)")).toHaveValue("1");
  await t.getByRole("button", { name: "Add item" }).click();
  await t.getByLabel("New line product").fill("mini book"); await t.getByLabel("New line product").press("Enter");
  await expect(t.getByTestId("new-line").locator("xpath=following-sibling::tr[1]").getByRole("alert")).toContainText("Already on this album");
  await t.getByRole("button", { name: "Cancel new line" }).click();
  // the search box at the top still works too
  await t.getByLabel("Search products").fill("foil"); await t.getByLabel("Search products").press("Enter");
  await expect(page.getByTestId("album-lines-1")).toContainText("Name foiling");
  await t.getByRole("button", { name: "More for Name foiling (sample)" }).click();
  await t.getByRole("menuitem", { name: "Remove Name foiling (sample)" }).click();
  // edit a row like an invoice
  await t.getByLabel("Description of Mini book (sample)").fill("Parents copy");
  await t.getByLabel("Quantity of Mini book (sample)").fill("2");                   // 2 × 450
  await expect(page.getByTestId("album-total-1")).toHaveText("₹4,950");
  await t.getByLabel("Price of Mini book (sample)").fill("400");                   // 2 × 400
  await expect(page.getByTestId("album-total-1")).toHaveText("₹4,850");
  await t.getByLabel("Discount on Mini book (sample)").fill("10");
  await t.getByLabel("Discount type for Mini book (sample)").selectOption("percent"); // − 80
  await expect(page.getByTestId("album-total-1")).toHaveText("₹4,770");
  await expect(page.getByTestId("album-lines-1")).toContainText("− ₹80 off");
  await expect(page.getByTestId("total-qty-1")).toHaveText("62");                  // 30 printing + 30 UV + 2
  // menu: back to the catalog price, remove the discount
  await t.getByRole("button", { name: "More for Mini book (sample)" }).click();
  await t.getByRole("menuitem", { name: "Use catalog price" }).click();
  await t.getByRole("button", { name: "More for Mini book (sample)" }).click();
  await t.getByRole("menuitem", { name: "Remove discount" }).click();
  await expect(page.getByTestId("album-total-1")).toHaveText("₹4,950");
  // columns can be hidden
  await t.getByRole("button", { name: "Columns" }).click();
  await t.getByRole("dialog", { name: "Columns" }).getByLabel("Discount").uncheck();
  await expect(t.getByLabel("Discount on Mini book (sample)")).toHaveCount(0);
  await t.getByRole("dialog", { name: "Columns" }).getByLabel("Discount").check();
  // a big line discount needs an admin (reception is refused at finalize)
  await t.getByLabel("Discount on Mini book (sample)").fill("80");                 // ₹720 of ₹4,950 at catalog prices ≈ 14.5% > 10%
  await t.getByLabel("Discount type for Mini book (sample)").selectOption("percent");
  await page.getByRole("button", { name: /^(5\s*)?Invoice$/ }).click();
  await expect(page.getByTestId("invoice-preview").or(page.locator("body"))).toContainText("less 80% discount");
  await expect(page.locator("body")).toContainText("Sample — Extras Premium Keepsakes - Mini book (sample)");                  // the invoice name: categories, then the item
  await next(page);
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(page.getByRole("alert")).toContainText("needs an admin");
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

test("the event step has no event type; an order finalizes without one", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await next(page);
  await page.getByRole("button", { name: /^Search customer/ }).click();
  await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await next(page);
  await expect(page.getByLabel("Event type")).toHaveCount(0);
  await expect(page.getByTestId("event-picker")).toBeVisible();
  await expect(page.getByLabel("Order date")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);       // today by default
  await page.getByLabel("Event date").fill("");                                     // the event date is optional
  await next(page);
  await expect(page.getByTestId("album-1")).toBeVisible();                           // went on to Albums without asking for it
  await page.getByRole("button", { name: "Back" }).click();
  const code = await buildOrder(page, { eventName: "No type", albums: [{ name: "Album", sheets: 10 }], finalize: true });
  expect(code).toMatch(/^IDP/);
});

test("Design + Printing: design charge typed on the order (per sheet or fixed, once per album)", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await next(page);
  await page.getByRole("button", { name: /^Search customer/ }).click();
  await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await next(page);
  await page.getByLabel("Event date").fill("2026-12-12"); await next(page);
  const a1 = page.getByTestId("album-1");
  await a1.getByLabel("Album name").fill("Wedding"); await a1.getByLabel("Sheets", { exact: true }).fill("30"); await a1.getByLabel("Copies").fill("2");
  // default: the design rate card (sample ₹40/sheet, per copy): 30×90 + 30×40 = 3,900 per copy
  await expect(a1.getByLabel("Design charge type")).toHaveValue("card");
  await expect(page.getByTestId("album-total-1")).toHaveText("₹7,800");
  // per sheet typed on the order: 30 × ₹50 once → 2 × 2,700 + 1,500
  await a1.getByLabel("Design charge type").selectOption("per_sheet");
  await expect(page.getByTestId("album-total-1")).toHaveText("₹5,400");            // no design charge until one is typed
  await a1.getByLabel("Design charge", { exact: true }).fill("50");
  await expect(page.getByTestId("design-charge-1")).toContainText("30 sheets × ₹50 = ₹1,500");
  await expect(page.getByTestId("per-copy-1")).toHaveText("₹2,700");
  await expect(page.getByTestId("album-total-1")).toHaveText("₹6,900");
  await expect(page.getByTestId("album-lines-1")).toContainText("Album design");
  // a fixed amount
  await a1.getByLabel("Design charge type").selectOption("fixed");
  await a1.getByLabel("Design charge", { exact: true }).fill("5000");
  await expect(page.getByTestId("album-total-1")).toHaveText("₹10,400");
  await a1.getByLabel("Design charge", { exact: true }).fill("-1");
  await expect(page.getByTestId("design-charge-1").getByRole("alert")).toContainText("enter the design charge");
  await a1.getByLabel("Design charge", { exact: true }).fill("5000");
  await next(page);
  await expect(page.getByTestId("sum-total")).toHaveText("₹10,400");
  await next(page);
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(page.getByTestId("finalized")).toContainText("₹10,400");
});

test("a half-entered order is saved as a draft automatically and can be resumed", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "reception");
  await page.goto("/orders/new");
  await expect(page.getByTestId("autosave")).toHaveText("Auto-saves as a draft once you start");
  await page.getByRole("radio", { name: /Design \+ Printing/ }).click(); await next(page);
  await page.getByRole("button", { name: /^Search customer/ }).click();
  await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await next(page);
  await page.getByLabel("Other event").fill("Half entry"); await page.getByLabel("Other event").press("Enter"); await page.getByLabel("Event date").fill("2026-12-12"); await next(page);
  const a1 = page.getByTestId("album-1");
  await a1.getByLabel("Album name").fill("Main album"); await a1.getByLabel("Sheets", { exact: true }).fill("24");
  await expect(page.getByTestId("autosave")).toContainText("Draft saved automatically");
  await expect(page).toHaveURL(/draft=/);

  // walk away without pressing Save, then come back
  await page.getByRole("link", { name: "Orders" }).first().click();
  await expect(page).toHaveURL(/\/orders$/);
  await page.goto("/orders/new");
  const banner = page.getByTestId("resume-banner");
  await expect(banner).toContainText("1 unfinished order");
  await expect(banner).toContainText("Half entry");
  await banner.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByTestId("album-1").getByLabel("Album name")).toHaveValue("Main album");
  await expect(page.getByTestId("album-1").getByLabel("Sheets", { exact: true })).toHaveValue("24");

  // more changes keep going into the same draft (no duplicates)
  await page.getByTestId("album-1").getByLabel("Copies").fill("3");
  await expect(page.getByTestId("autosave")).toContainText("Draft saved automatically");
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("albumpro.v1.order_drafts") ?? "[]") as { payload: { albums: { copies: number | string }[] } }[]).map((x) => String(x.payload.albums[0]?.copies)))).toEqual(["3"]);
});

test("the 'rate card not set up' notice links to the rate-card form and back to the order", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  // switch the sample printing rate card off so the notice appears
  await page.goto("/catalog");
  await page.getByTestId("cat-Sample — Printing").click();
  await page.getByRole("button", { name: "Edit Album printing (sample rates)" }).click();
  await page.getByRole("switch", { name: "Item active" }).click();
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.getByText("Item saved").first()).toBeVisible();
  await buildOrder(page, { type: /Album Printing Only/, albums: [{ name: "Notice album", sheets: 20 }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  const notice = page.getByTestId("missing-rate-card");
  await expect(notice).toContainText("The printing rate card is not set up");
  await expect(page).toHaveURL(/draft=/);                                           // the order is already a draft
  await notice.getByRole("link", { name: "Set up the printing rate card →" }).click();
  // the catalog opens with the rate-card form
  await expect(page).toHaveURL(/\/catalog\?setup=printing/);
  await expect(page.getByTestId("return-banner")).toContainText("Set up the printing rate card");
  await expect(page.getByLabel("Use as")).toHaveValue("printing");
  await expect(page.getByLabel("Pricing method")).toHaveValue("per_sheet");
  await expect(page.getByRole("switch", { name: "Item active" })).toHaveAttribute("aria-checked", "true");   // the existing card, switched back on
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.getByText("Item saved").first()).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).first().click();
  await page.getByRole("link", { name: "← Back to the order" }).click();
  await expect(page).toHaveURL(/\/orders\/new\?draft=/);
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await expect(page.getByTestId("album-1").getByLabel("Album name")).toHaveValue("Notice album");
  await expect(page.getByTestId("missing-rate-card")).toHaveCount(0);
});

test("non-admins see the notice without a link", async ({ page }) => {
  await seedRole(page, "reception");
  await page.addInitScript(() => { const k = "albumpro.v1.cat2_items"; try { const a = JSON.parse(localStorage.getItem(k) ?? "[]") as { kind?: string; active: boolean }[]; if (!a.length) return; a.forEach((i) => { if (i.kind === "printing") i.active = false; }); localStorage.setItem(k, JSON.stringify(a)); } catch { /* first load */ } });
  await page.goto("/orders/new");                                                    // first visit creates the demo catalog
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem("albumpro.v1.cat2_items") ?? "[]") as unknown[]).length)).toBeGreaterThan(0);
    await buildOrder(page, { type: /Album Printing Only/, albums: [{ name: "R album", sheets: 10 }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await expect(page.getByTestId("missing-rate-card")).toContainText("an admin adds it in Catalog & Pricing");
  await expect(page.getByTestId("missing-rate-card").getByRole("link")).toHaveCount(0);
});

test("Tax & defaults: printing charge A (included) / B (separate)", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await buildOrder(page, { type: /Album Printing Only/, albums: [{ name: "Mode album", sheets: 30 }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await expect(page.getByTestId("album-lines-1")).toContainText("automatic");              // B (default): a printing line
  await expect(page.getByTestId("album-total-1")).toHaveText("₹3,600");                    // 30 × ₹120 (12x36)
  await page.goto("/catalog");
  await page.getByRole("tab", { name: "Tax & defaults" }).or(page.getByRole("button", { name: "Tax & defaults" })).first().click();
  await expect(page.getByLabel("B · Charged separately")).toBeChecked();
  await page.getByLabel("A · Included in the sheet prices").check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Pricing settings saved").first()).toBeVisible();
  await page.goto("/orders/new?drafts=1");
  await page.getByRole("dialog", { name: "Saved drafts" }).getByRole("button", { name: /Sharma Studio/ }).first().click();
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await expect(page.getByTestId("album-lines-1")).not.toContainText("automatic");          // A: no printing line
  await expect(page.getByTestId("album-total-1")).toHaveText("₹0");
  await expect(page.getByTestId("missing-rate-card")).toHaveCount(0);
  const t = page.getByTestId("album-items-1");
  await t.getByRole("button", { name: "Add item" }).click();
  await t.getByLabel("New line product").fill("uv spot"); await t.getByLabel("New line product").press("Enter");
  await expect(page.getByTestId("album-total-1")).toHaveText("₹450");                       // only the items: 30 × ₹15
});

test("company name on the invoice: admin default + per-order choice for allowed roles", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await buildOrder(page, { albums: [{ name: "Brand album", sheets: 10 }], finalize: false });
  await page.getByRole("button", { name: /^(5\s*)?Invoice$/ }).click();
  await expect(page.getByTestId("invoice-business-name")).toBeVisible();                       // shown by default
  await page.getByRole("switch", { name: "Show company name on invoice" }).click();            // admin hides it on this order
  await expect(page.getByTestId("invoice-business-name")).toHaveCount(0);
  await expect(page.getByTestId("business-name-choice")).toContainText("Hidden");
  await next(page);
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(page.getByTestId("finalized")).toBeVisible();
  await expect(page.getByTestId("invoice-business-name")).toHaveCount(0);                      // the issued invoice has no company name
  // admin: default hidden, reception may not change it
  await page.goto("/catalog");
  await page.getByRole("tab", { name: "Tax & defaults" }).or(page.getByRole("button", { name: "Tax & defaults" })).first().click();
  await page.getByRole("switch", { name: "Show company name by default" }).click();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Pricing settings saved").first()).toBeVisible();
  await page.evaluate(() => localStorage.setItem("albumpro.role", "reception"));
  await buildOrder(page, { albums: [{ name: "Rec album", sheets: 10 }], finalize: false });
  await page.getByRole("button", { name: /^(5\s*)?Invoice$/ }).click();
  await expect(page.getByTestId("business-name-choice")).toContainText("Hidden — set by an admin");
  await expect(page.getByRole("switch", { name: "Show company name on invoice" })).toHaveCount(0);
  await expect(page.getByTestId("invoice-business-name")).toHaveCount(0);
  // the admin allows reception: the switch appears
  await page.evaluate(() => localStorage.setItem("albumpro.role", "admin"));
  await page.goto("/catalog");
  await page.getByRole("tab", { name: "Tax & defaults" }).or(page.getByRole("button", { name: "Tax & defaults" })).first().click();
  await page.getByLabel("Reception can change the company name").check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Pricing settings saved").first()).toBeVisible();
  await page.evaluate(() => localStorage.setItem("albumpro.role", "reception"));
  await page.goto("/orders/new?drafts=1");
  await page.getByRole("dialog", { name: "Saved drafts" }).getByRole("button").first().click();
  await page.getByRole("button", { name: /^(5\s*)?Invoice$/ }).click();
  await page.getByRole("switch", { name: "Show company name on invoice" }).click();
  await expect(page.getByTestId("invoice-business-name")).toBeVisible();
});

test("share the issued invoice: image download, WhatsApp chat with the customer, share sheet fallback", async ({ page, context }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await buildOrder(page, { albums: [{ name: "Share album", sheets: 10 }], finalize: true });
  const fin = page.getByTestId("finalized");
  await expect(fin).toBeVisible();
  const inv = (await page.getByTestId("done-invoice").textContent())!.trim();
  // the invoice as a picture
  const dl = page.waitForEvent("download");
  await fin.getByRole("button", { name: "Download image" }).click();
  const d = await dl;
  expect(d.suggestedFilename()).toBe(`${inv}.png`);
  const bytes = await (await d.createReadStream()).toArray().then((c) => Buffer.concat(c as Buffer[]));
  expect(bytes.subarray(1, 4).toString()).toBe("PNG");
  const ink = await page.evaluate(async (b64) => {                                          // a real rendered invoice, not a blank image: count dark pixels
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d")!; x.drawImage(img, 0, 0);
    const px = x.getImageData(0, 0, c.width, c.height).data; let dark = 0;
    for (let i = 0; i < px.length; i += 16) if (px[i]! < 120 && px[i + 1]! < 120 && px[i + 2]! < 160) dark++;
    return { dark, w: img.width, h: img.height };
  }, bytes.toString("base64"));
  expect(ink.w).toBeGreaterThan(1000);
  expect(ink.dark).toBeGreaterThan(2000);
  // WhatsApp on a computer: a chat with the customer's number and the message; the image is downloaded to attach
  await context.route(/wa\.me|whatsapp\.com/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<p>WhatsApp</p>" }));   // no internet here: answer wa.me ourselves
  const pop = context.waitForEvent("page");
  const dl2 = page.waitForEvent("download");
  await fin.getByRole("button", { name: "WhatsApp" }).click();
  const wa = await pop; await dl2;
  expect(wa.url()).toMatch(/^https:\/\/wa\.me\/91\d{10}\?text=/);
  expect(decodeURIComponent(wa.url())).toContain(`Invoice ${inv}`);
  expect(decodeURIComponent(wa.url())).toMatch(/91\d{10}/);                                  // the customer's mobile with the country code
  await wa.close();
  await expect(page.getByTestId("share-msg")).toContainText("attach it in the chat");
  // "Share invoice" uses the share sheet where the browser has one; this test browser has none → it downloads instead
  const dl3 = page.waitForEvent("download");
  await fin.getByRole("button", { name: "Share invoice" }).click();
  await dl3;
  await expect(page.getByTestId("share-msg")).toContainText("can't share files directly");
  // the order page has the same buttons
  await fin.getByRole("link", { name: "Open the order" }).click();
  await expect(page.getByRole("button", { name: "Share invoice" })).toBeVisible();
  await expect(page.getByRole("button", { name: "WhatsApp" })).toBeVisible();
});

test("events: tick several events, add another by name, couple name; saved on the order", async ({ page }) => {
  await seedRole(page, "admin");
  await buildOrder(page, { albums: [{ name: "Main", sheets: 10 }], finalize: false });
  await page.getByRole("button", { name: /Event & dates/ }).click();
  await page.getByLabel("Event Engagement").check(); await page.getByLabel("Event Wedding").check();
  await page.getByLabel("Other event").fill("Kunkuma Shastra"); await page.getByRole("button", { name: "+ Add event" }).click();
  await expect(page.getByLabel("Event Kunkuma Shastra")).toBeChecked();
  await page.getByLabel("Event Engagement").uncheck();
  await expect(page.getByTestId("event-summary")).toHaveText("Order events: Wedding, Kunkuma Shastra");
  await page.getByLabel("Couple name").fill("Asha & Ravi");
  await page.getByRole("button", { name: /Finalize/ }).first().click(); await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  const code = (await page.getByTestId("finalized").locator("h2").innerText()).match(/IDP\d+/)![0];
  await page.goto(`/orders/${code}`);
  await expect(page.getByText("Wedding, Kunkuma Shastra").first()).toBeVisible();
  await expect(page.getByText("Asha & Ravi").first()).toBeVisible();
});

test("Design + Printing: create the order now, prepare the invoice after the design", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await buildOrder(page, { albums: [{ name: "Wedding album", sheets: 30 }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  await page.getByTestId("album-1").getByLabel("Sheets").fill("");                 // the sheet count is not known before the design
  await page.getByTestId("album-1").getByLabel("Copies").fill("");
  await page.getByTestId("album-1").getByLabel("Size").selectOption("");
  await expect(page.getByTestId("summary-later")).toBeVisible();                     // no "sheets must be a positive whole number" warning
  await page.getByRole("button", { name: /Finalize/ }).first().click();
  await expect(page.getByLabel("Create order now, invoice later")).toBeChecked();      // on by default for Design + Printing
  await page.getByRole("button", { name: "Create order (invoice later)" }).click();
  await expect(page.getByTestId("created-invoice-later")).toBeVisible();
  const code = (await page.getByTestId("created-invoice-later").locator("h2").innerText()).match(/IDP\d+/)![0];

  await page.goto("/orders");
  await page.getByTestId("filter-invoice-pending").click();
  await expect(page.locator(`[data-row="${code}"]`).getByTestId("invoice-pending-badge")).toBeVisible();

  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("invoice-pending")).toBeVisible();
  await page.getByTestId("prepare-invoice").click();
  await expect(page.getByTestId("preparing-invoice")).toBeVisible();
  await page.getByTestId("album-1").getByLabel("Sheets").fill("30");
  await page.getByTestId("album-1").getByLabel("Copies").fill("1");
  await page.getByTestId("album-1").getByLabel("Size").selectOption("12x36");
  await page.getByRole("button", { name: /Finalize/ }).first().click();
  await expect(page.getByLabel("Create order now, invoice later")).toHaveCount(0);
  await page.getByRole("button", { name: "Finalize & issue invoice" }).click();
  await expect(page.getByTestId("finalized")).toContainText(code);
  await expect(page.getByTestId("done-invoice")).toHaveText(/^INV-/);
  await page.goto(`/orders/${code}`);
  await expect(page.getByTestId("order-pricing")).toBeVisible();
  await expect(page.getByTestId("invoice-pending")).toHaveCount(0);
});

test("a per-sheet design charge typed on the order is billed as its sheet count on the invoice", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await buildOrder(page, { albums: [{ name: "Wedding", sheets: 30, copies: 2 }], finalize: false });
  await page.getByRole("button", { name: /Albums & items/ }).click();
  const a1 = page.getByTestId("album-1");
  await a1.getByLabel("Design charge type").selectOption("per_sheet");
  await a1.getByLabel("Design charge", { exact: true }).fill("50");
  const total = await page.getByTestId("album-total-1").innerText();
  await page.getByRole("button", { name: /Finalize/ }).first().click();
  await invoiceNow(page); await page.getByRole("button", { name: /^Finalize order/ }).click();
  await expect(page.getByTestId("finalized")).toContainText(total);
  const code = (await page.getByTestId("finalized").locator("h2").innerText()).match(/IDP\d+/)![0];
  type L = { desc: string; qty: number; price: number };
  const read = () => page.evaluate((c) => (JSON.parse(localStorage.getItem("albumpro.v1.invoices") ?? "[]") as { orderId: string; lines: L[] }[]).find((i) => i.orderId === c)?.lines ?? [], code);
  await expect.poll(async () => (await read()).length).toBeGreaterThan(0);
  const lines = await read();
  const design = lines.find((l) => l.desc.startsWith("Album design"))!;
  expect(design).toMatchObject({ qty: 30, price: 50 });
  expect(design.desc).toContain("30 sheets (per album)");
  expect(`₹${lines.reduce((s, l) => s + l.qty * l.price, 0).toLocaleString("en-IN")}`).toBe(total);
});

test("ticking events and pressing Next creates one album per event", async ({ page }) => {
  await seedRole(page, "admin");
  await page.goto("/orders/new");
  await page.getByRole("radio", { name: /Album Printing Only/ }).click(); await next(page);
  await page.getByRole("button", { name: /^Search customer/ }).click();
  await page.getByRole("button", { name: /^Sharma Studio/ }).first().click(); await next(page);
  await page.getByLabel("Event Engagement").check(); await page.getByLabel("Event Haldi").check();
  await next(page);
  await expect(page.getByRole("tab")).toHaveText([/^Engagement/, /^Haldi/]);
  await expect(page.getByTestId("album-1").getByLabel("Album name")).toHaveValue("Engagement");
  // back, tick one more: only the new event gets an album; nothing is removed
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByLabel("Event Wedding").check();
  await next(page);
  await expect(page.getByRole("tab")).toHaveText([/^Engagement/, /^Haldi/, /^Wedding/]);
});
