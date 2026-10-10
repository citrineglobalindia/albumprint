import { test, expect, type Page } from "@playwright/test";
import { seedRole } from "./helpers";

test.use({ viewport: { width: 1700, height: 950 } });   // wide enough to see several kanban columns at once

/** HTML5 drag & drop with real mouse events (Playwright's dragTo can mis-aim when the board scrolls). */
async function drag(page: Page, cardId: string, toStage: string) {
  const card = page.locator(`[data-card="${cardId}"]`).first();
  await card.scrollIntoViewIfNeeded();
  await page.locator(`[data-stage="${toStage}"]`).scrollIntoViewIfNeeded();
  await page.waitForTimeout(150);
  const a = (await card.boundingBox())!, b = (await page.locator(`[data-stage="${toStage}"]`).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 30);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 40, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + 120, { steps: 12 });
  await page.mouse.up();
}

test.describe("pipeline", () => {
  test.beforeEach(async ({ page }) => { await seedRole(page, "admin"); await page.goto("/pipeline"); await page.waitForTimeout(500); });

  test("illegal drop is refused with the engine's message and the card snaps back", async ({ page }) => {
    await expect(page.locator('[data-stage="colour_grading"] [data-card="IDP00072"]')).toBeVisible();
    await drag(page, "IDP00072", "designing");              // Colour Grading -> Designing skips Admin Approval
    await expect(page.getByTestId("pipeline-warn")).toContainText("not allowed");
    await expect(page.locator('[data-stage="colour_grading"] [data-card="IDP00072"]')).toBeVisible();
    await expect(page.locator('[data-stage="designing"] [data-card="IDP00072"]')).toHaveCount(0);
    await expect(page.getByTestId("count-colour_grading")).toHaveText("5");
  });

  test("legal drop moves the card, is audited, and Undo restores it", async ({ page }) => {
    await drag(page, "IDP00072", "admin_approval");
    await expect(page.getByTestId("pipeline-toast")).toContainText("IDP00072 moved to Admin Approval");
    await expect(page.locator('[data-stage="admin_approval"] [data-card="IDP00072"]')).toBeVisible();
    await page.getByTestId("undo-move").click();
    await expect(page.locator('[data-stage="colour_grading"] [data-card="IDP00072"]')).toBeVisible();
    await page.goto("/orders/IDP00072");
    await expect(page.getByTestId("audit-trail")).toContainText("Admin Approval → Colour Grading");
    await expect(page.getByTestId("audit-trail").locator('[data-audit-action="stage_change"]')).toHaveCount(2);   // forward move + undo
  });

  test("a rework move asks for a reason before it is applied", async ({ page }) => {
    // QC -> Printing is the rework loop and needs a reason
    const id = (await page.locator('[data-stage="qc"] [data-card]').first().getAttribute("data-card"))!;
    await drag(page, id, "printing");
    const dlg = page.getByTestId("reason-dialog");
    await expect(dlg).toBeVisible();
    await expect(page.locator(`[data-stage="qc"] [data-card="${id}"]`)).toBeVisible();   // nothing moved yet
    await dlg.getByTestId("reason-input").fill("Banding on page 12");
    await dlg.getByTestId("reason-confirm").click();
    await expect(page.locator(`[data-stage="printing"] [data-card="${id}"]`)).toBeVisible();
  });
});
