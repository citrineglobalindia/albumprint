import { test, expect } from "@playwright/test";
import path from "node:path";
import { seedRole, buildOrder } from "./helpers";

// An album with a portrait cover and wide spreads: the cover shows alone, each spread fills one open book (two sheets),
// Single shows one sheet at a time, Zoom opens the page, and the client writes a note on the spread that is open.
const fx = (n: string) => path.join(process.cwd(), "tests", "fixtures", n);

test("album viewer: cover + spreads, single / double, zoom, note on a page", async ({ page }) => {
  test.setTimeout(120_000);
  await seedRole(page, "admin");
  await page.addInitScript(() => { (window as unknown as { __o: string[] }).__o = []; window.open = ((u: string) => { (window as unknown as { __o: string[] }).__o.push(String(u)); return null; }) as typeof window.open; });
  const code = (await buildOrder(page, { albums: [{ name: "Wedding album", sheets: 10 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  const box = page.getByTestId("preview-album-1");
  await box.getByLabel(/^Upload album pages for/).setInputFiles([fx("album-cover.jpg"), fx("album-wide-2.jpg"), fx("album-wide-3.jpg")]);
  await expect(page.getByText(/Wedding album v1 uploaded — 3 spreads/).first()).toBeVisible({ timeout: 30_000 });
  await box.getByTestId("share-box").getByRole("button", { name: "WhatsApp" }).click();
  const wa = await page.evaluate(() => (window as unknown as { __o: string[] }).__o.at(-1)!);
  await page.goto(decodeURIComponent(wa.split("text=")[1]!).match(/\/album\/[0-9a-f]+/)![0]);

  const fb = page.getByTestId("flipbook"), pos = fb.getByTestId("flip-position");
  await expect(pos).toHaveText("Cover · 1 of 3");
  await expect(page.getByTestId("page-notes")).toContainText("Notes on the cover");
  await fb.getByRole("button", { name: "Next page" }).click();
  await expect(pos).toHaveText("Spread 2 of 3", { timeout: 5000 });
  // one spread = two sheets side by side, each exactly half of the spread image (no bands)
  const book = await page.locator(".stf__block").boundingBox();
  const sheet = await page.locator(".ipd-page.--left").first().boundingBox();
  expect(Math.round(book!.width / sheet!.width)).toBe(2);

  await fb.getByRole("button", { name: "Single" }).click();
  await expect(pos).toHaveText(/Spread 2 of 3 · (left|right)/, { timeout: 5000 });
  await fb.getByRole("button", { name: "Double" }).click();
  await expect(pos).toHaveText("Spread 2 of 3", { timeout: 5000 });

  await fb.getByRole("button", { name: "Zoom" }).click();
  const zoom = page.getByTestId("zoom-view");
  await expect(zoom.getByTestId("zoom-level")).toHaveText("100%");
  await zoom.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom.getByTestId("zoom-level")).toHaveText("150%");
  await zoom.getByRole("button", { name: "Close zoom" }).click();

  // a note on the left page of the open spread
  await page.getByRole("button", { name: "Note on left page" }).click();
  await page.getByLabel("Note on spread 2").fill("Make the left photo bigger");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note added on the left page of spread 2 — thank you")).toBeVisible();
  await expect(page.getByTestId("page-notes")).toContainText("Left page: Make the left photo bigger");
  // scroll view: every page has its own + Note
  await fb.getByRole("button", { name: "Scroll" }).click();
  const scroll = page.getByTestId("album-scroll");
  await expect(scroll.locator("figure").nth(1)).toContainText("1 note");
  await scroll.locator("figure").nth(2).getByRole("button", { name: "+ Note" }).click();
  await page.getByRole("group", { name: "Which page" }).getByRole("button", { name: "Right page" }).click();
  await page.getByLabel("Note on spread 3").fill("Change the background colour");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByText("Note added on the right page of spread 3 — thank you")).toBeVisible();
  await expect(scroll.locator("figure").nth(2)).toContainText("1 note");

  await page.goto(`/orders/${code}`);
  await expect(box.getByTestId("preview-feedback")).toContainText("Spread 2");
  await expect(box.getByTestId("preview-feedback")).toContainText("Left page: Make the left photo bigger");
  await expect(box.getByTestId("preview-feedback")).toContainText("Right page: Change the background colour");
});
