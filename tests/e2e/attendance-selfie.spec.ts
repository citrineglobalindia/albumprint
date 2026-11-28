import { test, expect } from "@playwright/test";
import { seedRole } from "./helpers";

// a fake front camera and a fixed location, both allowed
test.use({
  launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["camera", "geolocation"],
  geolocation: { latitude: 12.9716, longitude: 77.5946, accuracy: 20 },
});

test("check in with a selfie and the location; both show on the timeline", async ({ page }) => {
  await seedRole(page, "reception");
  await page.goto("/attendance");
  const today = page.getByTestId("today-card");
  await today.getByRole("button", { name: "Check in", exact: true }).click();
  const dlg = page.getByTestId("punch-dialog");
  await expect(dlg.getByTestId("punch-location")).toContainText("Location added (±20 m)");
  await dlg.getByRole("button", { name: "Take selfie" }).click();
  await expect(dlg.getByTestId("selfie-preview")).toBeVisible();
  await expect(dlg.getByRole("button", { name: /^Skip selfie/ })).toHaveCount(0);
  await dlg.getByRole("button", { name: "Check in with selfie" }).click();
  await expect(dlg).toHaveCount(0);
  const tl = page.getByTestId("timeline");
  await expect(tl.getByText("Checked in")).toBeVisible();
  await expect(tl.getByRole("button", { name: "View selfie" })).toBeVisible();
  await expect(tl.getByTestId("punch-map")).toHaveAttribute("href", "https://www.google.com/maps?q=12.9716,77.5946");
  await tl.getByRole("button", { name: "View selfie" }).click();
  await expect(page.getByRole("dialog", { name: "Selfie" }).getByRole("img")).toBeVisible();
});

test("without camera or location the check-in still goes through", async ({ browser }) => {
  const ctx = await browser.newContext({ permissions: [] });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => Promise.reject(new Error("denied")) } });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (_ok: unknown, bad: (e: unknown) => void) => bad({ code: 1 }) } });
  });
  await seedRole(page, "reception");
  await page.goto("/attendance");
  const today = page.getByTestId("today-card");
  await today.getByRole("button", { name: "Check in", exact: true }).click();
  const dlg = page.getByTestId("punch-dialog");
  await expect(dlg.getByText(/Camera not available/)).toBeVisible();
  await expect(dlg.getByTestId("punch-location")).toContainText("Location not available");
  await dlg.getByRole("button", { name: "Check in", exact: true }).click();
  await expect(page.getByTestId("timeline").getByText("Checked in")).toBeVisible();
  await expect(page.getByTestId("timeline").getByTestId("punch-map")).toHaveCount(0);
  await ctx.close();
});
