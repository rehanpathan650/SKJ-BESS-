import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests for the website.
 *   npm --workspace apps/web run e2e
 * Starts a throwaway API (fresh e2e database, test users per role) on :8020 and the web app on :5180.
 * Uses the installed Microsoft Edge, so no browser download is needed.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // the flows share one database and build on each other's data
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: "http://localhost:5180",
    channel: "msedge",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
  },
  webServer: [
    {
      command: "cd ../api && .venv\\Scripts\\python.exe e2e\\seed_e2e.py && .venv\\Scripts\\python.exe e2e\\run_api.py",
      url: "http://127.0.0.1:8020/api/v1/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "npx vite --mode e2e",
      url: "http://localhost:5180",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
