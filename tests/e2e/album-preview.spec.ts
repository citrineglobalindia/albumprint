import { test, expect } from "@playwright/test";
import path from "node:path";
import { seedRole, buildOrder } from "./helpers";

// Album preview: upload an album (page images or a PDF), check it as a page-turning book, share the link on WhatsApp,
// the client asks for changes on a spread, the studio marks it done, a new version is approved; old versions can be deleted.
const fx = (n: string) => path.join(process.cwd(), "tests", "fixtures", n);

test("album preview: upload, flip, share on WhatsApp, client changes and approval, delete a version", async ({ page }) => {
  test.setTimeout(150_000);
  await seedRole(page, "admin");
  await page.addInitScript(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open; });
  const code = (await buildOrder(page, { newCustomer: { name: "Flip Studio", phone: "9811100022" }, albums: [{ name: "Wedding album", sheets: 10 }], finalize: true }))!;
  await page.goto(`/orders/${code}`);
  const box = page.getByTestId("preview-album-1");
  await expect(box).toContainText("Not uploaded");

  // three spreads as images
  await box.getByLabel(/^Upload album pages for/).setInputFiles([fx("album-spread-1.jpg"), fx("album-spread-2.jpg"), fx("album-spread-3.jpg")]);
  await expect(page.getByText(/Wedding album v1 uploaded — 3 spreads/).first()).toBeVisible({ timeout: 20_000 });
  await expect(box.getByTestId("preview-status")).toContainText("Shared");

  // the link is shown right away with copy / open / WhatsApp / share
  await expect(box.getByTestId("share-box").getByLabel("Album link")).toHaveValue(/\/album\/[0-9a-f]+$/);
  await expect(box.getByTestId("share-box").getByRole("link", { name: "Open" })).toHaveAttribute("href", /\/album\/[0-9a-f]+$/);
  // the page-turning preview
  await box.getByRole("button", { name: "Preview" }).click();
  const book = page.getByTestId("flipbook");
  await expect(book).toBeVisible();
  await expect(book.getByTestId("flip-position")).toHaveText("Spread 1 of 3");
  await book.getByRole("button", { name: "Next page" }).click();
  await expect(book.getByTestId("flip-position")).toHaveText("Spread 2 of 3", { timeout: 5000 });
  await page.getByRole("button", { name: "Close preview" }).click();

  // share on WhatsApp: the customer's number and the album link
  await box.getByRole("button", { name: "Share on WhatsApp" }).click();
  const wa = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.at(-1)!);
  expect(wa).toContain("https://wa.me/919811100022?text=");
  const link = decodeURIComponent(wa.split("text=")[1]!).match(/https?:\/\/\S+\/album\/[0-9a-f]+/)![0];

  // the client opens the link and asks for a change on spread 1
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { name: "Wedding album" })).toBeVisible();
  await expect(page.getByTestId("flipbook")).toBeVisible();
  await page.getByRole("button", { name: "Request changes" }).click();
  await page.getByLabel("Your name").fill("Ravi");
  await page.getByLabel("Your changes").fill("Swap the right photo with the stage photo");
  await page.getByRole("button", { name: "Send changes" }).click();
  await expect(page.getByText("Thank you — the studio will see your note")).toBeVisible();
  await expect(page.getByTestId("client-status")).toContainText("Changes requested");

  // the studio sees it and marks it done
  await page.goto(`/orders/${code}`);
  await expect(box.getByTestId("preview-status")).toContainText("Changes requested");
  const fb = box.getByTestId("preview-feedback");
  await expect(fb).toContainText("Spread 1");
  await expect(fb).toContainText("Swap the right photo with the stage photo");
  await fb.getByRole("button", { name: "Mark done" }).click();
  await expect(fb.getByRole("button", { name: "Mark not done" })).toBeVisible();

  // version 2 from a PDF; the client approves it
  await box.getByLabel(/^Upload album pages for/).setInputFiles(fx("album.pdf"));
  await expect(page.getByText(/Wedding album v2 uploaded — 2 spreads/).first()).toBeVisible({ timeout: 30_000 });
  await box.getByRole("button", { name: "Share on WhatsApp" }).click();
  const wa2 = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.at(-1)!);
  const link2 = decodeURIComponent(wa2.split("text=")[1]!).match(/\/album\/[0-9a-f]+/)![0];
  await page.goto(link2);
  await page.getByRole("button", { name: "Approve album" }).click();
  await page.getByLabel("Your name").fill("Ravi");
  await page.getByRole("button", { name: "Approve album" }).click();
  await expect(page.getByTestId("client-status")).toContainText("Approved by Ravi");

  await page.goto(`/orders/${code}`);
  await expect(box.getByTestId("preview-status")).toContainText("Approved by client · Ravi");
  // the earlier version can be deleted; its link stops working
  page.on("dialog", (d) => void d.accept());
  await box.getByRole("button", { name: /Show earlier versions/ }).click();
  await box.getByRole("button", { name: "Delete Wedding album v1" }).click();
  await expect(page.getByText("Wedding album v1 deleted — its link no longer works").first()).toBeVisible();
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { name: "This album link is not available" })).toBeVisible();
});
