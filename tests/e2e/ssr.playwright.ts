/****
 * Browser SSR Verification
 *
 * Confirms core pages render meaningful HTML before any JavaScript executes.
 */

import { expect, test } from "./fixtures/playwright.ts";
import { getProjectsToTest } from "./helpers/projects.ts";

const PROJECTS = getProjectsToTest();

for (const subdomain of PROJECTS) {
  const baseUrl = `http://${subdomain}.lvh.me:8080`;

  test.describe(`${subdomain} SSR without JavaScript`, () => {
    test("root page renders meaningful SSR HTML with JavaScript disabled", async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();

      try {
        const response = await page.goto(`${baseUrl}/`);

        expect(response?.ok()).toBeTruthy();
        await expect(page.locator("#project-name")).toHaveText(subdomain);
        await expect(page.locator("#counter")).toHaveText("Count: 0");
        await expect(page.locator("#about-link")).toHaveAttribute("href", "/about");
      } finally {
        await context.close();
      }
    });

    test("secondary route renders meaningful SSR HTML with JavaScript disabled", async ({ browser }) => {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const page = await context.newPage();

      try {
        const response = await page.goto(`${baseUrl}/about`);

        expect(response?.ok()).toBeTruthy();
        await expect(page.locator("#about-page")).toHaveText(`About ${subdomain}`);
      } finally {
        await context.close();
      }
    });
  });
}
