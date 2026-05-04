/****
 * E2E Smoke Tests
 *
 * Pre-push smoke tests for the Veryfront renderer.
 * Tests projects in the active Playwright runtime host.
 *
 * Target: < 2 minutes total runtime
 * Zero tolerance: ANY failure blocks push
 */

import type { Page } from "npm:playwright@1.59.0/test";
import { expect, test } from "./fixtures/playwright.ts";
import { getProjectsToTest } from "./helpers/projects.ts";
import { getRuntimeForPlaywrightProject } from "./helpers/runtime.ts";

/**
 * Projects to test.
 *
 * Configure via environment variables:
 *   E2E_PROJECT=myproject PW_DISABLE_TS_ESM=1 npx playwright test --config=tests/e2e/playwright.config.cjs
 *   E2E_PROJECTS="proj1,proj2" PW_DISABLE_TS_ESM=1 npx playwright test --config=tests/e2e/playwright.config.cjs
 *   PLAYWRIGHT_PROJECT=preview-host deno task test:e2e:playwright
 *
 * If neither is set, uses example projects for demonstration.
 */
const PROJECTS = getProjectsToTest();

async function expectPageRenders(page: Page): Promise<void> {
  const body = await page.locator("body").innerHTML();
  expect(body.length).toBeGreaterThan(0);
}

async function visit(page: Page, url: string) {
  const response = await page.goto(url);
  await page.waitForLoadState("networkidle");
  return response;
}

for (const subdomain of PROJECTS) {
  test.describe(subdomain, () => {
    test("page loads without errors", async ({ page }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      const response = await visit(page, `${runtime.getUrl(subdomain)}/`);

      expect(response?.status()).toBeLessThan(500);
      await expect(page.locator("#project-name")).toHaveText(subdomain);
      await expectPageRenders(page);
    });

    test("hydration works", async ({ page }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      await visit(page, `${runtime.getUrl(subdomain)}/`);

      await page.locator("#counter").click();
      await expect(page.locator("#counter")).toHaveText("Count: 1");
    });

    test("secondary routes render", async ({ page }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      const response = await visit(page, `${runtime.getUrl(subdomain)}/about`);

      expect(response?.ok()).toBeTruthy();
      await expect(page.locator("#about-page")).toHaveText(`About ${subdomain}`);
    });

    test("API routes respond with JSON", async ({ request }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      const response = await request.get(`${runtime.getUrl(subdomain)}/api/status`);

      expect(response.ok()).toBeTruthy();
      expect(response.headers()["content-type"]).toContain("application/json");
      expect(await response.json()).toEqual({ ok: true, project: subdomain });
    });

    test("missing routes render the 404 page", async ({ page }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      const response = await visit(page, `${runtime.getUrl(subdomain)}/missing-page`);

      expect(response?.status()).toBe(404);
      await expect(page.locator("#not-found-page")).toHaveText(`Custom Not Found for ${subdomain}`);
    });

    test("color_mode=dark works", async ({ page }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      const response = await page.goto(`${runtime.getUrl(subdomain)}/?color_mode=dark`);
      const html = await response?.text();
      expect(html).toContain('data-theme="dark"');

      await page.waitForLoadState("networkidle");
      await expect(page.locator("html").first()).toHaveAttribute("data-theme", "dark");
      await expectPageRenders(page);
    });

    test("color_mode=light works", async ({ page }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      const response = await page.goto(`${runtime.getUrl(subdomain)}/?color_mode=light`);
      const html = await response?.text();
      expect(html).toContain('data-theme="light"');

      await page.waitForLoadState("networkidle");
      await expect(page.locator("html").first()).toHaveAttribute("data-theme", "light");
      await expectPageRenders(page);
    });

    test("studio_embed=true works", async ({ page }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      test.skip(
        runtime.modeName !== "production",
        "studio embed is only relevant on the production host lane",
      );

      await page.goto(`${runtime.getUrl(subdomain)}/?studio_embed=true`);
      await page.waitForLoadState("networkidle");

      await expectPageRenders(page);

      const pageContent = await page.content();
      const hasStudioBridge = pageContent.includes("StudioBridge") ||
        pageContent.includes("studio-bridge") ||
        pageContent.includes("parent.postMessage");
      expect(hasStudioBridge).toBeTruthy();
    });

    test("HMR script present", async ({ page }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      test.skip(runtime.modeName !== "preview", "HMR coverage only applies to preview hosts");

      await page.goto(`${runtime.getUrl(subdomain)}/`);
      await page.waitForLoadState("networkidle");

      await expectPageRenders(page);
      await expect(page.locator('script[src*="preview-hmr.js"]')).toBeAttached();
    });

    test("branch preview subdomains resolve", async ({ page }, testInfo) => {
      const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
      test.skip(
        runtime.modeName !== "preview",
        "branch preview coverage only applies to preview hosts",
      );

      const branchPreviewUrl = `http://${subdomain}--feature.preview.lvh.me:8080`;
      const response = await visit(page, `${branchPreviewUrl}/`);

      expect(response?.ok()).toBeTruthy();
      await expect(page.locator("#project-name")).toHaveText(subdomain);
      await expect(page.locator('script[src*="preview-hmr.js"]')).toBeAttached();
    });
  });
}

test("smoke test summary", async ({ browserName: _browserName }, testInfo) => {
  const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);

  console.log(`\nSmoke tests completed for ${PROJECTS.length} projects on ${runtime.modeName}:`);
  for (const subdomain of PROJECTS) {
    console.log(`  - ${subdomain}`);
  }
  console.log("\nAll assertions passed!");
});
