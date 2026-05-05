/****
 * Browser Navigation Verification
 *
 * Confirms link navigation and browser history transitions stay in the same
 * document so we catch client-router regressions instead of only hard-reload
 * rendering.
 */

import type { Page } from "npm:playwright@1.59.0/test";
import { expect, test } from "./fixtures/playwright.ts";
import { getProjectsToTest } from "./helpers/projects.ts";
import { getRuntimeForPlaywrightProject } from "./helpers/runtime.ts";

const PROJECTS = getProjectsToTest();

async function createDocumentMarker(page: Page): Promise<string> {
  return await page.evaluate(() => {
    const marker = `vf-nav-${Math.random().toString(16).slice(2)}`;
    (window as typeof window & { __vfNavigationMarker?: string }).__vfNavigationMarker = marker;
    return marker;
  });
}

async function expectMarkerToSurviveNavigation(page: Page, marker: string): Promise<void> {
  await expect.poll(async () => {
    return await page.evaluate(() => {
      return (window as typeof window & { __vfNavigationMarker?: string }).__vfNavigationMarker ??
        null;
    });
  }).toBe(marker);
}

for (const subdomain of PROJECTS) {
  test.describe(`${subdomain} navigation`, () => {
    test(
      "link navigation and history roundtrip stay in the same document",
      async ({ page }, testInfo) => {
        const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
        const baseUrl = runtime.getUrl(subdomain);

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
      },
    );
  });
}
