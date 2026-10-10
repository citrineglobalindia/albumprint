import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

test.describe("pipeline", () => {
  test.beforeEach(async ({ page }) => { await seedRole(page, "admin"); await page.goto("/pipeline"); });

  test("illegal drop is refused with the engine's message and the card snaps back", async ({ page }) => {
    const card = page.locator('[data-stage="colour_grading"] [data-card="IDP00072"]');
    await expect(card).toBeVisible();
    await card.dragTo(page.locator('[data-stage="qc"]'));
    await expect(page.getByTestId("pipeline-warn")).toContainText("not allowed");
    await expect(page.locator('[data-stage="colour_grading"] [data-card="IDP00072"]')).toBeVisible();
    await expect(page.locator('[data-stage="qc"] [data-card="IDP00072"]')).toHaveCount(0);
  });

  test("legal drop moves the card, is audited, and Undo restores it (admin override)", async ({ page }) => {
    await page.locator('[data-stage="colour_grading"] [data-card="IDP00072"]').dragTo(page.locator('[data-stage="admin_approval"]'));
    await expect(page.getByTestId("pipeline-toast")).toContainText("IDP00072 moved to Admin Approval");
    await expect(page.locator('[data-stage="admin_approval"] [data-card="IDP00072"]')).toBeVisible();
    await page.getByTestId("undo-move").click();
    await expect(page.locator('[data-stage="colour_grading"] [data-card="IDP00072"]')).toBeVisible();
    await page.goto("/orders/IDP00072");
    await expect(page.getByTestId("audit-trail")).toContainText("Admin Approval → Colour Grading");
  });

  test("a rework move asks for a reason before it is applied", async ({ page }) => {
    // QC → Printing is the rework loop and needs a reason
    const card = page.locator('[data-stage="qc"] [data-card]').first();
    const id = await card.getAttribute("data-card");
    await card.dragTo(page.locator('[data-stage="printing"]'));
    const dlg = page.getByTestId("reason-dialog");
    await expect(dlg).toBeVisible();
    await dlg.getByTestId("reason-input").fill("Banding on page 12");
    await dlg.getByTestId("reason-confirm").click();
    await expect(page.locator(`[data-stage="printing"] [data-card="${id}"]`)).toBeVisible();
  });
});
