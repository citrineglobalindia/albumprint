import { test, expect } from "@playwright/test";
import { savedContains, seedRole, buildOrder } from "./helpers";

test.describe("orders", () => {
  test.beforeEach(async ({ page }) => { await seedRole(page, "admin"); });

  test("the order builder creates an order that survives a reload", async ({ page }) => {
    const code = await buildOrder(page, { albums: [{ name: "Reload album" }] });
    expect(code).toMatch(/^IDP\d+$/);
    await page.getByRole("link", { name: "Open the order" }).click();
    await expect(page).toHaveURL(new RegExp(`/orders/${code}$`));
    await savedContains(page, "orders", code!);
    await page.reload();
    await expect(page.getByTestId("order-pricing")).toBeVisible();
    await expect(page.getByText("Reload album").first()).toBeVisible();
  });

  test("an order can hold several albums, each with its own name and requirements", async ({ page }) => {
    await buildOrder(page, { eventName: "Asha & Ravi", albums: [{ name: "Asha & Ravi Wedding Album", sheets: 30 }, { name: "Engagement Album", sheets: 20, size: "8x12" }], finalize: false });
    await page.getByRole("button", { name: /Albums & items/ }).click();
    await page.getByRole("tab", { name: /Asha & Ravi Wedding Album/ }).click();
    await expect(page.getByTestId("album-1").getByLabel("Size")).toHaveValue("12x36");      // album 1 was not changed by album 2
    await page.getByRole("tab", { name: /Engagement Album/ }).click();
    await expect(page.getByTestId("album-2").getByLabel("Size")).toHaveValue("8x12");
    await expect(page.getByTestId("album-2").getByLabel("Sheets")).toHaveValue("20");
  });

  test("mobile numbers are limited to 10 digits and must start with 6-9", async ({ page }) => {
    await page.goto("/orders/new");
    await page.getByRole("radio", { name: /Design \+ Printing/ }).click();
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "New customer" }).click();
    await page.getByLabel("Customer name").fill("Mobile Rule Studio");
    const mobile = page.getByLabel("Phone number");
    await mobile.fill("98989898989898");
    await expect(mobile).toHaveValue("9898989898");                                   // letters stripped, capped at 10
    await mobile.fill("5123456789");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("alert")).toContainText("Mobile number must start with 6, 7, 8 or 9");
    await mobile.fill("6123456789");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByLabel("Event date")).toBeVisible();
  });

  test("a new customer + order persist, customers list included", async ({ page }) => {
    await buildOrder(page, { newCustomer: { name: "E2E Test Studio", phone: "9876501234" } });
    await savedContains(page, "customers", "E2E Test Studio");
    await page.goto("/customers");
    await page.reload();
    await expect(page.getByText("E2E Test Studio").first()).toBeVisible();
  });

  test("bulk hold needs a reason, then moves the orders to On Hold", async ({ page }) => {
    await page.goto("/orders");
    await page.getByRole("checkbox", { name: /^Select IDP/ }).nth(0).check();
    await page.getByRole("checkbox", { name: /^Select IDP/ }).nth(1).check();
    await page.getByRole("button", { name: "Put On Hold" }).click();
    const dlg = page.getByRole("dialog", { name: /on hold/i });
    await dlg.getByTestId("reason-confirm").click();
    await expect(dlg.getByRole("alert")).toContainText("reason is required");
    await dlg.getByTestId("reason-input").fill("Waiting for client files");
    await dlg.getByTestId("reason-confirm").click();
    await expect(page.getByTestId("notice-ok")).toContainText("2 of 2");
    await expect(page.getByRole("tab", { name: /On Hold/ })).toContainText("2");
  });

  test("order detail: next-step actions go through the workflow engine and are audited", async ({ page }) => {
    await page.goto("/orders/IDP00072");              // Design + Printing, at Colour Grading
    await expect(page.getByTestId("next-admin_approval")).toBeVisible();
    await expect(page.getByTestId("next-qc")).toHaveCount(0);
    await page.getByTestId("next-admin_approval").click();
    await expect(page.getByTestId("notice-ok")).toContainText("Admin Approval");
    await expect(page.getByTestId("audit-trail").locator('[data-audit-action="stage_change"]').first()).toContainText("Colour Grading → Admin Approval");

    // sending back needs a reason
    await page.getByTestId("next-colour_grading").click();
    const dlg = page.getByTestId("reason-dialog");
    await dlg.getByTestId("reason-confirm").click();
    await expect(dlg.getByRole("alert")).toBeVisible();
    await dlg.getByTestId("reason-input").fill("Colour cast on pages 4-6");
    await dlg.getByTestId("reason-confirm").click();
    await expect(page.getByTestId("audit-trail")).toContainText("Reason: Colour cast on pages 4-6");

    // hold / resume
    await page.getByRole("button", { name: "Put on hold" }).click();
    await page.getByTestId("reason-input").fill("Client travelling");
    await page.getByTestId("reason-confirm").click();
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();
    await expect(page.getByTestId("next-admin_approval")).toBeDisabled();
    await page.getByRole("button", { name: "Resume" }).click();
    await expect(page.getByTestId("next-admin_approval")).toBeEnabled();

    // admin override: any stage, reason mandatory, flagged in the trail
    await page.getByRole("button", { name: "Admin override" }).click();
    await page.getByTestId("reason-choice").selectOption({ label: "QC" });
    await page.getByTestId("reason-input").fill("Reprint of a lost album");
    await page.getByTestId("reason-confirm").click();
    await expect(page.getByTestId("audit-trail").locator('[data-audit-action="stage_override"]').first()).toContainText("QC");
  });

  test("files & versions: upload, new version, lock, and locked files cannot be archived", async ({ page }) => {
    await page.goto("/orders/IDP00071");
    await page.getByTestId("file-input").setInputFiles({ name: "album_v1.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
    await expect(page.getByTestId("file-list")).toContainText("album_v1.pdf");
    await page.getByTestId("file-input").setInputFiles({ name: "album_v1.pdf", mimeType: "application/pdf", buffer: Buffer.from("xy") });
    await expect(page.getByTestId("file-list")).toContainText("v2");
    await page.getByTestId("file-input").setInputFiles({ name: "virus.exe", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    await expect(page.getByTestId("notice-error")).toContainText("not an allowed file type");
    await page.getByRole("button", { name: /^Lock album_v1.pdf/ }).first().click();
    await page.getByRole("button", { name: /^Archive album_v1.pdf/ }).first().click();
    await expect(page.getByTestId("notice-error")).toContainText("Locked files cannot be archived");
    await expect(page.getByTestId("audit-trail")).toContainText("File uploaded");
  });
});

test("menu: Design + Printing Orders / Printing Orders list only that type and start a new order of that type", async ({ page }) => {
  await seedRole(page, "reception");
  await page.goto("/");
  const side = page.getByRole("navigation", { name: "Main navigation" }).or(page.locator("#app-sidebar")).first();
  await side.getByRole("link", { name: "Design + Printing Orders" }).click();
  await expect(page).toHaveURL(/\/design-orders$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Design + Printing Orders");
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  await expect(page.locator("tbody")).not.toContainText(/\bPrinting\b(?! )/);                 // no print-only rows ("Design + Printing" only)
  await page.getByRole("button", { name: "New Design + Printing order" }).click();
  await expect(page).toHaveURL(/\/orders\/new\?type=design_printing/);
  await expect(page.getByRole("button", { name: /^Search customer/ })).toBeVisible();        // straight to the customer step
  await page.getByRole("button", { name: /Order type/ }).click();
  await expect(page.getByRole("radio", { name: /Design \+ Printing/ })).toBeChecked();
  await side.getByRole("link", { name: "Printing Orders", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Printing Orders");
  await expect(page.locator("tbody")).not.toContainText("Design + Printing");
  await page.getByRole("button", { name: "New Printing order" }).click();
  await page.getByRole("button", { name: /Order type/ }).click();
  await expect(page.getByRole("radio", { name: /Album Printing Only/ })).toBeChecked();
});

test("menu: the order-type lists follow the Orders permission", async ({ page }) => {
  await seedRole(page, "printing");
  await page.goto("/design-orders");
  await expect(page).not.toHaveURL(/design-orders/);                                           // no Orders access → sent home
  await expect(page.locator("#app-sidebar").getByRole("link", { name: "Printing Orders", exact: true })).toHaveCount(0);
});

test("assign an order to a colour grader from the order page; auto-assign rule picks the grader when an order reaches Colour Grading", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await page.goto("/");
  const pick = (stage: string) => page.evaluate((st) => (JSON.parse(localStorage.getItem("albumpro.v1.orders") ?? "[]") as { id: string; stage: string; workflow: string; hold?: boolean }[]).find((o) => o.stage === st && o.workflow === "Design + Printing" && !o.hold)?.id, stage);
  await expect.poll(() => pick("colour_grading")).toBeTruthy();
  // 1) by hand, at Colour Grading
  const cg = (await pick("colour_grading"))!;
  await page.goto(`/orders/${cg}`);
  const at = page.getByTestId("assigned-to");
  await at.getByRole("button", { name: /Assign|Change/ }).click();
  await at.getByLabel("Assign to").selectOption("Karthik V");
  await expect(at.getByText("this also assigns the grading job")).toBeVisible();
  await at.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(at).toContainText("Karthik V");
  await page.goto("/colour-grading");
  await expect(page.locator("tbody tr", { hasText: cg })).toContainText("Karthik V");   // the grader's queue follows
  // 2) the admin sets auto-assign for Colour Grading
  await page.goto("/settings");
  await page.getByRole("button", { name: /^Workflow/ }).first().click();
  const aa = page.getByTestId("auto-assign-settings");
  await aa.getByLabel("Auto-assign Colour Grading").selectOption("least_busy");
  await aa.getByRole("button", { name: "Save auto-assign" }).click();
  await expect(page.getByText("Auto-assign rules saved").first()).toBeVisible();
  // an order moved into Colour Grading gets the grader automatically
  const fr = await page.evaluate(() => { const a = JSON.parse(localStorage.getItem("albumpro.v1.orders") ?? "[]") as { id: string; stage: string; workflow: string; hold?: boolean }[]; return a.find((o) => o.stage === "files_received" && o.workflow === "Design + Printing" && !o.hold)?.id; });
  test.skip(!fr, "no Design + Printing order at Files Received in the demo data");
  await page.goto(`/orders/${fr}`);
  const graders = await page.evaluate(() => (JSON.parse(localStorage.getItem("albumpro.v1.staff") ?? "null") as { name: string; role: string }[] | null)?.filter((x) => x.role === "Colour Grading").map((x) => x.name) ?? []);
  await page.getByRole("button", { name: "Move to Colour Grading" }).click();
  await expect(page.getByTestId("assigned-to")).toContainText("auto-assign on");
  const who = (await page.getByTestId("assigned-to").locator("xpath=.").innerText()).replace(/Change|auto-assign on/g, "").replace(/^[A-Z]{1,2}\n?/, "").trim();
  if (graders.length) expect(graders).toContain(who);                                       // someone from Colour Grading (the least busy)
  await page.goto("/colour-grading");
  await expect(page.locator("tbody tr", { hasText: fr! })).toContainText(who);             // and the grading job is theirs

});

test("admin deletes an order from the list (type the order ID to confirm); it is gone after a reload", async ({ page }) => {
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Delete me" }] }))!;
  await page.goto("/orders");
  const row = page.getByRole("row").filter({ hasText: code });
  await row.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Delete Order" }).click();
  await page.getByTestId("reason-input").fill("Test order");
  await page.getByTestId("confirm-text").fill(code);
  await page.getByTestId("reason-confirm").click();
  await expect(page.getByText(`${code} deleted`).first()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: code })).toHaveCount(0);
  await page.waitForTimeout(1500); await page.reload();
  await expect(page.getByRole("row").filter({ hasText: code })).toHaveCount(0);
});

test("admin deletes several selected orders at once (type DELETE to confirm)", async ({ page }) => {
  await seedRole(page, "admin");
  const a = (await buildOrder(page, { albums: [{ name: "Bulk A" }] }))!;
  const b = (await buildOrder(page, { albums: [{ name: "Bulk B" }] }))!;
  await page.goto("/orders");
  for (const c of [a, b]) await page.getByRole("row").filter({ hasText: c }).getByRole("checkbox").check();
  await page.getByTestId("bulk-bar").getByRole("button", { name: "Delete" }).click();     // no reason needed (optional)
  await expect(page.getByTestId("reason-confirm")).toBeDisabled();
  await page.getByTestId("confirm-text").fill("delete");
  await page.getByTestId("reason-confirm").click();
  await expect(page.getByText("Deleted 2 of 2 orders").first()).toBeVisible();
  for (const c of [a, b]) await expect(page.getByRole("row").filter({ hasText: c })).toHaveCount(0);
});
