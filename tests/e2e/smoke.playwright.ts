/****
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
  "restaurant-template",
  "lease-calculator",
  "impartial-chandrasekhar-qsohb",
  "immo-price-finder",
  "real-estate-template",
  "dashboard",
  "task-manager-template",
  "ai-assistant-template",
  // "tomcode", // RENDERER BUG: SVG components missing `export default` (see docs/E2E_PROJECT_ISSUES.md)

  // AI templates:
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

async function expectPageRenders(page: import("@playwright/test").Page): Promise<void> {
  const body = await page.locator("body").innerHTML();
  expect(body.length).toBeGreaterThan(0);
}

function getHydrationErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      e.includes("hydrat") || e.includes("Minified React error") || e.includes("did not match"),
  );
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

        const response = await page.goto(`${baseUrl}/`);
        await page.waitForLoadState("networkidle");

        expect(response?.status()).toBeLessThan(500);
        await expectPageRenders(page);
        expect(errors).toEqual([]);
      });

      test("hydration works", async ({ page }) => {
        const errors = setupErrorCollection(page);

        await page.goto(`${baseUrl}/`);
        await page.waitForLoadState("networkidle");

        const interactive = page.locator("button, a[href], [onclick]").first();
        if ((await interactive.count()) > 0) {
          try {
            await interactive.click({ force: true, timeout: 2000 });
            await page.waitForTimeout(100);
          } catch {
            // Element might not be clickable, that's okay
          }
        }

        expect(getHydrationErrors(errors)).toEqual([]);
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
        expect(errors).toEqual([]);
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
        expect(errors).toEqual([]);
      });

      if (mode.name === "production") {
        test("studio_embed=true works", async ({ page }) => {
          const errors = setupErrorCollection(page);

          await page.goto(`${baseUrl}/?studio_embed=true`);
          await page.waitForLoadState("networkidle");

          await expectPageRenders(page);

          const pageContent = await page.content();
          const hasStudioBridge =
            pageContent.includes("StudioBridge") ||
            pageContent.includes("studio-bridge") ||
            pageContent.includes("parent.postMessage");
          expect(hasStudioBridge).toBeTruthy();

          expect(errors).toEqual([]);
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

          expect(errors).toEqual([]);
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
