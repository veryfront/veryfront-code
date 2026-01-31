import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.playwright.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://lvh.me:8080",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
    },
  ],

  globalSetup: "./setup/global-setup.ts",
  globalTeardown: "./setup/global-teardown.ts",

  expect: {
    timeout: 5_000,
  },
});
