import { test, expect } from "@playwright/test";
import { savedContains, seedRole } from "./helpers";

test.describe("orders", () => {
  test.beforeEach(async ({ page }) => { await seedRole(page, "admin"); });

  test("New Order wizard creates an order that survives a reload", async ({ page }) => {
    await page.goto("/orders");
    await page.getByRole("button", { name: "Create Order" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New Order" });
    await expect(dlg).toBeVisible();
    await dlg.getByRole("button", { name: /Search by name, studio or mobile/ }).click();
    await page.getByRole("button", { name: /Sharma Studio/ }).click();
    for (let i = 0; i < 4; i++) await dlg.getByRole("button", { name: "Next" }).click();
    await dlg.getByRole("button", { name: "Create Order" }).click();
    await expect(page).toHaveURL(/\/orders\/IDP00073$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("IDP00073");
    await savedContains(page, "orders", "IDP00073");
    await page.goto("/orders");
    await page.reload();
    await expect(page.locator('[data-row="IDP00073"]')).toBeVisible();
    await expect(page.getByTestId("last-saved")).toBeVisible();
  });

  test("a new customer + order persist, customers list included", async ({ page }) => {
    await page.goto("/orders");
    await page.getByRole("button", { name: "Create Order" }).first().click();
    const dlg = page.getByRole("dialog", { name: "New Order" });
    await dlg.getByRole("button", { name: /Search by name, studio or mobile/ }).click();
    await page.getByRole("button", { name: /Add new customer/ }).click();
    await dlg.getByPlaceholder("Studio / customer name").fill("E2E Test Studio");
    await dlg.getByPlaceholder("Mobile number").fill("9876501234");
    for (let i = 0; i < 4; i++) await dlg.getByRole("button", { name: "Next" }).click();
    await dlg.getByRole("button", { name: "Create Order" }).click();
    await expect(page).toHaveURL(/\/orders\/IDP\d+$/);
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
