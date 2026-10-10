import { defineConfig, devices } from "@playwright/test";

// Database-mode end-to-end tests: the real app + the local Supabase stand-in (supabase/local/start.sh).
//   API_PORT=54322 LOCAL_DB=ap_b PGRST_PORT=3001 supabase/local/start.sh      # once
//   API_PORT=54322 LOCAL_DB=ap_b E2E_PORT=5190 npx playwright test -c playwright.db.config.ts
const API_PORT = Number(process.env.API_PORT ?? 54321);
const PORT = Number(process.env.E2E_PORT ?? 5190);
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./tests/e2e-db",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions: { executablePath, args: ["--no-sandbox"] } },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath, args: ["--no-sandbox"] } } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { VITE_USE_SUPABASE: "true", VITE_SUPABASE_URL: `http://localhost:${API_PORT}`, VITE_SUPABASE_PUBLISHABLE_KEY: "local" },
  },
});
