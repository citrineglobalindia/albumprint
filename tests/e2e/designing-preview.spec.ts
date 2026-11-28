import { test, expect } from "@playwright/test";
import path from "node:path";
import { seedRole, buildOrder } from "./helpers";

// The album design page: a Preview button in the toolbar opens the uploaded album as a page-turning book;
// the album preview panel (upload / share / client feedback) is on the same page.
const fx = (n: string) => path.join(process.cwd(), "tests", "fixtures", n);

test("design page: Preview in the toolbar opens the album as a page-turning book", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  const code = (await buildOrder(page, { albums: [{ name: "Wedding album", sheets: 10 }], finalize: true }))!;
  const errs: string[] = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`/designing/${code}`);
  // nothing uploaded yet: Preview points to the panel
  await expect(page.getByTestId("no-album-yet")).toBeVisible();
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByText(/Upload the album below/).first()).toBeVisible();

  const box = page.getByTestId("preview-album-1");
  await box.getByLabel(/^Upload album pages for/).setInputFiles(fx("album.pdf"));
  await expect(box.getByTestId("preview-status")).toContainText("Shared", { timeout: 30_000 });

  // the canvas shows the uploaded album and the page list its pages; a thumbnail turns to that spread
  await expect(page.getByTestId("album-canvas").getByTestId("flipbook")).toBeVisible();
  await expect(page.getByTestId("album-strip").getByRole("button")).toHaveCount(2);
  // turning a page must not rebuild the book (that was the blink): the same book stays on the page
  await page.waitForTimeout(800);
  await page.evaluate(() => { (window as unknown as { __book: Element | null }).__book = document.querySelector("[data-testid=album-canvas] .stf__block"); });
  await page.getByRole("button", { name: "Go to spread 2" }).click();
  await expect(page.getByTestId("album-canvas").getByTestId("flip-position")).toHaveText(/^Spread 2 of 2/, { timeout: 5000 });   // one sheet at a time when the canvas is narrow
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => { const b = (window as unknown as { __book: Element | null }).__book; return !!b && b.isConnected; }), "the book was rebuilt after a page turn").toBe(true);
  await expect(page.getByTestId("canvas")).toHaveCount(0);                               // no layout editor any more
  await expect(page.getByText("Design Templates")).toHaveCount(0);
  await page.getByRole("button", { name: "Preview", exact: true }).first().click();      // the toolbar's
  const book = page.getByRole("dialog", { name: /Preview of Wedding album/ }).getByTestId("flipbook");
  await expect(book).toBeVisible();
  await expect(book.getByTestId("flip-position")).toHaveText("Spread 1 of 2");
  await book.getByRole("button", { name: "Next page" }).click();
  await expect(book.getByTestId("flip-position")).toHaveText("Spread 2 of 2", { timeout: 5000 });
  await page.getByRole("button", { name: "Close preview" }).click();
  await expect(box.getByRole("button", { name: "Share on WhatsApp" })).toBeVisible();
  await page.keyboard.press("Delete"); await page.keyboard.press("Control+z");
  expect(errs).toEqual([]);
});
