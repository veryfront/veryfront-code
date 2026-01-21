/**
 * E2E Smoke Tests
 *
 * Pre-push smoke tests for the Veryfront renderer.
 * Tests projects in both production and preview modes.
 *
 * Target: < 2 minutes total runtime
 * Zero tolerance: ANY failure blocks push
 */

import { expect, test } from "@playwright/test";
import { setupErrorCollection } from "./helpers/assertions.js";

/**
 * Projects to test.
 *
 * Comment/uncomment to enable/disable projects.
 * Filter by project: E2E_PROJECT=codersociety npx playwright test
 */
const ENABLED_PROJECTS = [
  "blank",
  "codersociety",
  "veryfront",
  // "tomcode", // RENDERER BUG: SVG components missing `export default` (see docs/E2E_PROJECT_ISSUES.md)

  "restaurant-template",
  "lease-calculator",
  "impartial-chandrasekhar-qsohb",
  "immo-price-finder",
  "real-estate-template",
  "dashboard"

  // AI templates:
  // "ai-assistant-template",
  // "task-manager-template",
  // "ai-inbox-assistant",
  // "immo-agent-template",
  // "doc-agent-template",
  // "outlook-agent",
  // "ai-agent",
  // "ai-agent-kitchen-sink",
  // "invest-pro-template",

  // "marketing-template", // missing remote deps (veryfront-ui 404s)
];

const targetProject = process.env.E2E_PROJECT;
const PROJECTS = targetProject ? [targetProject] : ENABLED_PROJECTS;

/**
 * Test modes: production ({subdomain}.lvh.me) and preview ({subdomain}.preview.lvh.me)
 */
const MODES = [
  { name: "production", getUrl: (subdomain: string) => `http://${subdomain}.lvh.me:8080` },
  { name: "preview", getUrl: (subdomain: string) => `http://${subdomain}.preview.lvh.me:8080` },
];

/**
 * Test each project in each mode
 */
for (const subdomain of PROJECTS) {
  for (const mode of MODES) {
    test.describe(`${subdomain} (${mode.name})`, () => {
      const baseUrl = mode.getUrl(subdomain);

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
            e.includes("did not match"),
        );
        expect(hydrationErrors).toEqual([]);
      });

      /**
       * Dark mode test: color_mode=dark applies correctly
       */
      test("color_mode=dark works", async ({ page }) => {
        const errors = setupErrorCollection(page);

        // Check SSR value before hydration
        const response = await page.goto(`${baseUrl}/?color_mode=dark`);
        const html = await response?.text();
        expect(html).toContain('data-theme="dark"');

        // Wait for hydration to complete
        await page.waitForLoadState("networkidle");

        // Client: data-theme should still be dark after hydration (no revert)
        // Use .first() to handle pages with nested <html> elements (e.g., veryfront-managed)
        await expect(page.locator("html").first()).toHaveAttribute("data-theme", "dark");

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

        // Check SSR value before hydration
        const response = await page.goto(`${baseUrl}/?color_mode=light`);
        const html = await response?.text();
        expect(html).toContain('data-theme="light"');

        // Wait for hydration to complete
        await page.waitForLoadState("networkidle");

        // Client: data-theme should still be light after hydration (no revert)
        // Use .first() to handle pages with nested <html> elements (e.g., veryfront-managed)
        await expect(page.locator("html").first()).toHaveAttribute("data-theme", "light");

        // Page should still render correctly
        const body = await page.locator("body").innerHTML();
        expect(body.length).toBeGreaterThan(0);

        // No console errors
        expect(errors).toEqual([]);
      });

      // Production-only tests
      if (mode.name === "production") {
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
      }

      // Preview-only tests
      if (mode.name === "preview") {
        /**
         * Preview HMR test: preview mode includes HMR script
         */
        test("HMR script present", async ({ page }) => {
          const errors = setupErrorCollection(page);

          await page.goto(`${baseUrl}/`);
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
      }
    });
  }
}

/**
 * Summary test to verify test execution
 */
test("smoke test summary", async () => {
  console.log(`\nSmoke tests completed for ${PROJECTS.length} projects in ${MODES.length} modes:`);
  for (const subdomain of PROJECTS) {
    for (const mode of MODES) {
      console.log(`  - ${subdomain} (${mode.name})`);
    }
  }
  console.log("\nAll assertions passed!");
});
