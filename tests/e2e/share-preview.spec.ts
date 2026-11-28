import { test, expect } from "@playwright/test";

test("shared client links preview the studio logo, and open with the logo instead of the app loader", async ({ page, request }) => {
  await page.goto("/album/not-a-real-link");
  await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute("content", /\/og-image\.png$/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Innovative Photo Designers");
  const img = await request.get("/og-image.png");
  expect(img.ok()).toBeTruthy();
  expect(img.headers()["content-type"]).toContain("image/png");
  await expect(page.getByText("This album link is not available")).toBeVisible();
});

test("the opening screen of a client link has no spinning loader", async ({ page }) => {
  await page.route("**/src/main.tsx*", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));   // hold the page on its first paint
  await page.goto("/album/abc");
  const l = page.locator(".ipd-loader");
  await expect(l).toHaveClass(/ipd-client/);
  await expect(l.locator(".ipd-mark")).toBeHidden();
  await expect(l.locator(".ipd-word")).toBeVisible();
  await expect(l.getByText("Opening your album")).toBeVisible();
});
