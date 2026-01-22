import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E Test Configuration
 *
 * Designed for fast pre-push smoke testing:
 * - Single browser (Chromium) for speed
 * - No retries (zero tolerance for flakiness)
 * - Sequential execution (workers: 1)
 * - Target: < 2 minutes total runtime
 */
export default defineConfig({
  testDir: ".",
  testMatch: "*.playwright.ts", // Custom pattern to avoid bun test auto-discovery
  timeout: 30_000,
  retries: 0, // Zero tolerance - any failure blocks push
  workers: 1, // Sequential execution for deterministic results

  // Reporter: minimal for pre-push, detailed for debugging
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://lvh.me:8080",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  // Only use Chromium for speed
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Server setup via global setup/teardown
  globalSetup: "./setup/global-setup.ts",
  globalTeardown: "./setup/global-teardown.ts",

  // Expect settings
  expect: {
    timeout: 5_000,
  },
});
