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
    await expect(page.getByLabel("Event type")).toBeVisible();
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
