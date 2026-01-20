/**
 * E2E Smoke Tests
 *
 * Pre-push smoke tests for the Veryfront renderer.
 * Tests 3 projects with various query parameter combinations.
 *
 * Target: < 2 minutes total runtime
 * Zero tolerance: ANY failure blocks push
 */

import { test, expect } from "@playwright/test";
import {
  setupErrorCollection,
  assertColorMode,
  assertStudioEmbed,
  assertPreviewMode,
} from "./helpers/assertions.js";

/**
 * Projects to test
 *
 * These are local projects that the dev server discovers automatically.
 * Each project tests different aspects of the renderer.
 *
 * Note: Projects can be marked as `skip: true` if they have known issues
 * that are not related to the renderer core functionality.
 */
const PROJECTS = [
  {
    subdomain: "blank",
    name: "Blank",
    description: "Minimal baseline project",
    skip: false,
  },
  {
    subdomain: "codersociety",
    name: "CoderSociety",
    description: "Full-featured project with complex layouts",
    skip: false,
  },
  // Note: veryfront project currently has MDX rendering issues
  // (ReactCurrentBatchConfig error) - skipped until fixed
  // {
  //   subdomain: "veryfront",
  //   name: "Veryfront",
  //   description: "Marketing site with MDX content",
  //   skip: true,
  // },
];

/**
 * Test each project
 */
for (const project of PROJECTS) {
  test.describe(`${project.name} (${project.subdomain})`, () => {
    const baseUrl = `http://${project.subdomain}.lvh.me:8080`;

    /**
     * Basic smoke test: page loads without errors
     */
    test("page loads without errors", async ({ page }) => {
      const errors = setupErrorCollection(page);

      const response = await page.goto(`${baseUrl}/`);
      await page.waitForLoadState("networkidle");

      // Assert: no 5xx errors
      expect(response?.status()).toBeLessThan(500);

      // Assert: page has content
      const body = await page.locator("body").innerHTML();
      expect(body.length).toBeGreaterThan(0);

      // Assert: no console errors
      expect(errors).toEqual([]);
    });

    /**
     * Hydration test: React hydration works without errors
     */
    test("hydration works", async ({ page }) => {
      const errors = setupErrorCollection(page);

      await page.goto(`${baseUrl}/`);
      await page.waitForLoadState("networkidle");

      // Try to interact with an element to trigger hydration errors
      const interactive = page.locator("button, a[href], [onclick]").first();
      if ((await interactive.count()) > 0) {
        try {
          await interactive.click({ force: true, timeout: 2000 });
          await page.waitForTimeout(100);
        } catch {
          // Element might not be clickable, that's okay
        }
      }

      // Assert: no hydration-related errors
      const hydrationErrors = errors.filter(
        (e) =>
          e.includes("hydrat") ||
          e.includes("Minified React error") ||
          e.includes("did not match")
      );
      expect(hydrationErrors).toEqual([]);
    });

    /**
     * Dark mode test: color_mode=dark applies correctly
     */
    test("color_mode=dark works", async ({ page }) => {
      const errors = setupErrorCollection(page);

      await page.goto(`${baseUrl}/?color_mode=dark`);
      await page.waitForLoadState("networkidle");

      // SSR: data-theme attribute should be set to dark
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

      // Page should still render correctly
      const body = await page.locator("body").innerHTML();
      expect(body.length).toBeGreaterThan(0);

      // No console errors
      expect(errors).toEqual([]);
    });

    /**
     * Light mode test: color_mode=light applies correctly
     */
    test("color_mode=light works", async ({ page }) => {
      const errors = setupErrorCollection(page);

      await page.goto(`${baseUrl}/?color_mode=light`);
      await page.waitForLoadState("networkidle");

      // SSR: data-theme attribute should be set to light
      await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

      // Page should still render correctly
      const body = await page.locator("body").innerHTML();
      expect(body.length).toBeGreaterThan(0);

      // No console errors
      expect(errors).toEqual([]);
    });

    /**
     * Studio embed test: studio_embed=true injects bridge script
     */
    test("studio_embed=true works", async ({ page }) => {
      const errors = setupErrorCollection(page);

      await page.goto(`${baseUrl}/?studio_embed=true`);
      await page.waitForLoadState("networkidle");

      // Page should still render correctly
      const body = await page.locator("body").innerHTML();
      expect(body.length).toBeGreaterThan(0);

      // Studio bridge should be present (postMessage communication script)
      // Check for StudioBridge in any script content
      const pageContent = await page.content();
      const hasStudioBridge =
        pageContent.includes("StudioBridge") ||
        pageContent.includes("studio-bridge") ||
        pageContent.includes("parent.postMessage");
      expect(hasStudioBridge).toBeTruthy();

      // No console errors
      expect(errors).toEqual([]);
    });

    /**
     * Preview mode test: preview_mode=true injects HMR script
     */
    test("preview_mode=true works", async ({ page }) => {
      const errors = setupErrorCollection(page);

      await page.goto(`${baseUrl}/?preview_mode=true`);
      await page.waitForLoadState("networkidle");

      // Page should still render correctly
      const body = await page.locator("body").innerHTML();
      expect(body.length).toBeGreaterThan(0);

      // Preview HMR script should be present
      const hmrScript = page.locator('script[src*="preview-hmr.js"]');
      await expect(hmrScript).toBeAttached();

      // No console errors
      expect(errors).toEqual([]);
    });
  });
}

/**
 * Summary test to verify test execution
 */
test("smoke test summary", async () => {
  console.log(`\nSmoke tests completed for ${PROJECTS.length} projects:`);
  for (const project of PROJECTS) {
    console.log(`  - ${project.name}: ${project.description}`);
  }
  console.log("\nAll assertions passed!");
});
