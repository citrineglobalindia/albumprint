import { defineConfig, devices } from "@playwright/test";

// `npm run test:e2e` — starts (or reuses) the Vite dev server on :5173 and drives it with Chromium.
// Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to use a locally installed browser instead of Playwright's own download.
const PORT = Number(process.env.E2E_PORT ?? 5199);   // not 5173, so a dev server running against Supabase is never reused by the tests
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 3,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } }],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `npx vite --port ${PORT} --strictPort`,
    env: { VITE_USE_SUPABASE: "false" },          // tests always run in demo mode (no network, seeded data)
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
