const { defineConfig, devices } = require("playwright/test");

const runtimeProjects = [
  {
    name: "production-host",
    use: {
      ...devices["Desktop Chrome"],
      baseURL: "http://blank.lvh.me:8080",
    },
  },
  {
    name: "preview-host",
    use: {
      ...devices["Desktop Chrome"],
      baseURL: "http://blank.preview.lvh.me:8080",
    },
  },
];

const selectedProject = process.env.PLAYWRIGHT_PROJECT?.trim();
const projects = selectedProject
  ? runtimeProjects.filter((project) => project.name === selectedProject)
  : runtimeProjects;

if (selectedProject && projects.length === 0) {
  throw new Error(
    `Unknown PLAYWRIGHT_PROJECT: ${selectedProject}. Expected one of ${
      runtimeProjects.map((project) => project.name).join(", ")
    }.`,
  );
}

module.exports = defineConfig({
  testDir: ".",
  testMatch: "*.playwright.ts",
  timeout: 30_000,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",

  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects,

  globalSetup: "./setup/global-setup.ts",
  globalTeardown: "./setup/global-teardown.ts",

  expect: {
    timeout: 5_000,
  },
});
