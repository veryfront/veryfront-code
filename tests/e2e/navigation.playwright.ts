/****
 * Browser Navigation Verification
 *
 * Confirms link navigation and browser history transitions stay in the same
 * document so we catch client-router regressions instead of only hard-reload
 * rendering.
 */

import { expect, test } from "./fixtures/playwright.ts";
import { getProjectsToTest } from "./helpers/projects.ts";

const PROJECTS = getProjectsToTest();
const MODES = [
  { name: "production", getUrl: (subdomain: string) => `http://${subdomain}.lvh.me:8080` },
  { name: "preview", getUrl: (subdomain: string) => `http://${subdomain}.preview.lvh.me:8080` },
];

async function createDocumentMarker(page: import("npm:playwright@1.59.0/test").Page): Promise<string> {
  return await page.evaluate(() => {
    const marker = `vf-nav-${Math.random().toString(16).slice(2)}`;
    (window as typeof window & { __vfNavigationMarker?: string }).__vfNavigationMarker = marker;
    return marker;
  });
}

async function expectMarkerToSurviveNavigation(
  page: import("npm:playwright@1.59.0/test").Page,
  marker: string,
): Promise<void> {
  await expect.poll(async () => {
    return await page.evaluate(() => {
      return (window as typeof window & { __vfNavigationMarker?: string }).__vfNavigationMarker ?? null;
    });
  }).toBe(marker);
}

for (const subdomain of PROJECTS) {
  for (const mode of MODES) {
    test.describe(`${subdomain} (${mode.name}) navigation`, () => {
      const baseUrl = mode.getUrl(subdomain);

      test("link navigation and history roundtrip stay in the same document", async ({ page }) => {
        await page.goto(`${baseUrl}/`);
        await page.waitForLoadState("networkidle");

        await expect(page.locator("#project-name")).toHaveText(subdomain);
        await expect(page.locator("#counter")).toHaveText("Count: 0");

        const marker = await createDocumentMarker(page);

        await Promise.all([
          page.waitForURL(`${baseUrl}/about`),
          page.locator("#about-link").click(),
        ]);

        await expect(page.locator("#about-page")).toHaveText(`About ${subdomain}`);
        await expectMarkerToSurviveNavigation(page, marker);

        await page.goBack();
        await page.waitForURL(`${baseUrl}/`);

        await expect(page.locator("#project-name")).toHaveText(subdomain);
        await expect(page.locator("#about-link")).toHaveAttribute("href", "/about");
        await expectMarkerToSurviveNavigation(page, marker);

        await page.goForward();
        await page.waitForURL(`${baseUrl}/about`);

        await expect(page.locator("#about-page")).toHaveText(`About ${subdomain}`);
        await expectMarkerToSurviveNavigation(page, marker);
      });
    });
  }
}
