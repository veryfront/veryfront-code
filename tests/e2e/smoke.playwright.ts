/****
 * E2E Smoke Tests
 *
 * Pre-push smoke tests for the Veryfront renderer.
 * Tests projects in both production and preview modes.
 *
 * Target: < 2 minutes total runtime
 * Zero tolerance: ANY failure blocks push
 */

import { expect, test } from "playwright/test";
import { findHydrationOrCspFailures, setupErrorCollection } from "./helpers/assertions.js";
import { getProjectsToTest } from "./helpers/projects.js";

/**
 * Projects to test.
 *
 * Configure via environment variables:
 *   E2E_PROJECT=myproject npx playwright test     # Test a single project
 *   E2E_PROJECTS="proj1,proj2" npx playwright test # Test multiple projects
 *
 * If neither is set, uses example projects for demonstration.
 */
const PROJECTS = getProjectsToTest();

/**
 * Test modes: production ({subdomain}.lvh.me) and preview ({subdomain}.preview.lvh.me)
 */
const MODES = [
  { name: "production", getUrl: (subdomain: string) => `http://${subdomain}.lvh.me:8080` },
  { name: "preview", getUrl: (subdomain: string) => `http://${subdomain}.preview.lvh.me:8080` },
];

async function expectPageRenders(page: import("playwright/test").Page): Promise<void> {
  const body = await page.locator("body").innerHTML();
  expect(body.length).toBeGreaterThan(0);
}

async function visit(page: import("playwright/test").Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState("networkidle");
  return response;
}

async function expectNoErrors(errors: string[]): Promise<void> {
  expect(findHydrationOrCspFailures(errors)).toEqual([]);
  expect(errors).toEqual([]);
}

/**
 * Test each project in each mode
 */
for (const subdomain of PROJECTS) {
  for (const mode of MODES) {
    test.describe(`${subdomain} (${mode.name})`, () => {
      const baseUrl = mode.getUrl(subdomain);

      test("page loads without errors", async ({ page }) => {
        const errors = setupErrorCollection(page);

        const response = await visit(page, `${baseUrl}/`);

        expect(response?.status()).toBeLessThan(500);
        await expect(page.locator("#project-name")).toHaveText(subdomain);
        await expectPageRenders(page);
        await expectNoErrors(errors);
      });

      test("hydration works", async ({ page }) => {
        const errors = setupErrorCollection(page);

        await visit(page, `${baseUrl}/`);

        await page.locator("#counter").click();
        await expect(page.locator("#counter")).toHaveText("Count: 1");
        await expectNoErrors(errors);
      });

      test("secondary routes render", async ({ page }) => {
        const errors = setupErrorCollection(page);

        const response = await visit(page, `${baseUrl}/about`);

        expect(response?.ok()).toBeTruthy();
        await expect(page.locator("#about-page")).toHaveText(`About ${subdomain}`);
        await expectNoErrors(errors);
      });

      test("API routes respond with JSON", async ({ request }) => {
        const response = await request.get(`${baseUrl}/api/status`);

        expect(response.ok()).toBeTruthy();
        expect(response.headers()["content-type"]).toContain("application/json");
        expect(await response.json()).toEqual({ ok: true, project: subdomain });
      });

      test("missing routes render the 404 page", async ({ page }) => {
        const errors = setupErrorCollection(page);

        const response = await visit(page, `${baseUrl}/missing-page`);

        expect(response?.status()).toBe(404);
        await expect(page.locator("#not-found-page")).toHaveText(`Custom Not Found for ${subdomain}`);
        await expectNoErrors(errors);
      });

      test("color_mode=dark works", async ({ page }) => {
        const errors = setupErrorCollection(page);

        const response = await page.goto(`${baseUrl}/?color_mode=dark`);
        const html = await response?.text();
        expect(html).toContain('data-theme="dark"');

        await page.waitForLoadState("networkidle");

        // Use .first() to handle pages with nested <html> elements (e.g., veryfront-managed)
        await expect(page.locator("html").first()).toHaveAttribute("data-theme", "dark");

        await expectPageRenders(page);
        await expectNoErrors(errors);
      });

      test("color_mode=light works", async ({ page }) => {
        const errors = setupErrorCollection(page);

        const response = await page.goto(`${baseUrl}/?color_mode=light`);
        const html = await response?.text();
        expect(html).toContain('data-theme="light"');

        await page.waitForLoadState("networkidle");

        // Use .first() to handle pages with nested <html> elements (e.g., veryfront-managed)
        await expect(page.locator("html").first()).toHaveAttribute("data-theme", "light");

        await expectPageRenders(page);
        await expectNoErrors(errors);
      });

      if (mode.name === "production") {
        test("studio_embed=true works", async ({ page }) => {
          const errors = setupErrorCollection(page);

          await page.goto(`${baseUrl}/?studio_embed=true`);
          await page.waitForLoadState("networkidle");

          await expectPageRenders(page);

          const pageContent = await page.content();
          const hasStudioBridge = pageContent.includes("StudioBridge") ||
            pageContent.includes("studio-bridge") ||
            pageContent.includes("parent.postMessage");
          expect(hasStudioBridge).toBeTruthy();

          await expectNoErrors(errors);
        });
      }

      if (mode.name === "preview") {
        test("HMR script present", async ({ page }) => {
          const errors = setupErrorCollection(page);

          await page.goto(`${baseUrl}/`);
          await page.waitForLoadState("networkidle");

          await expectPageRenders(page);

          const hmrScript = page.locator('script[src*="preview-hmr.js"]');
          await expect(hmrScript).toBeAttached();

          await expectNoErrors(errors);
        });

        test("branch preview subdomains resolve", async ({ page }) => {
          const errors = setupErrorCollection(page);
          const branchPreviewUrl = `http://${subdomain}--feature.preview.lvh.me:8080`;

          const response = await visit(page, `${branchPreviewUrl}/`);

          expect(response?.ok()).toBeTruthy();
          await expect(page.locator("#project-name")).toHaveText(subdomain);
          await expect(page.locator('script[src*="preview-hmr.js"]')).toBeAttached();
          await expectNoErrors(errors);
        });
      }
    });
  }
}

test("smoke test summary", async () => {
  console.log(`\nSmoke tests completed for ${PROJECTS.length} projects in ${MODES.length} modes:`);
  for (const subdomain of PROJECTS) {
    for (const mode of MODES) {
      console.log(`  - ${subdomain} (${mode.name})`);
    }
  }
  console.log("\nAll assertions passed!");
});
