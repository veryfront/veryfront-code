/****
 * Multi-project Matrix Verification
 *
 * Confirms the Playwright fixture workspace serves more than one project at the
 * same time so runtime routing bugs do not hide behind the default blank tenant.
 */

import { expect, test } from "./fixtures/playwright.ts";
import { getProjectsToProvision } from "./helpers/projects.ts";
import { getRuntimeForPlaywrightProject } from "./helpers/runtime.ts";

const PROJECTS = getProjectsToProvision();

test("provisioned projects resolve independently in the active runtime", async ({ page }, testInfo) => {
  const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);

  for (const subdomain of PROJECTS) {
    const response = await page.goto(`${runtime.getUrl(subdomain)}/`);

    expect(response?.ok()).toBeTruthy();
    await expect(page.locator("#project-name")).toHaveText(subdomain);
    await expect(page.locator("#about-link")).toHaveAttribute("href", "/about");
  }
});

test("API routes keep project identity across the active runtime", async ({ request }, testInfo) => {
  const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);

  for (const subdomain of PROJECTS) {
    const response = await request.get(`${runtime.getUrl(subdomain)}/api/status`);

    expect(response.ok()).toBeTruthy();
    expect(await response.json()).toEqual({ ok: true, project: subdomain });
  }
});

test("branch preview hostnames resolve for every provisioned project", async ({ page }, testInfo) => {
  const runtime = getRuntimeForPlaywrightProject(testInfo.project.name);
  test.skip(runtime.modeName !== "preview", "branch preview coverage only applies to preview hosts");

  for (const subdomain of PROJECTS) {
    const response = await page.goto(`http://${subdomain}--feature.preview.lvh.me:8080/`);

    expect(response?.ok()).toBeTruthy();
    await expect(page.locator("#project-name")).toHaveText(subdomain);
    await expect(page.locator('script[src*="preview-hmr.js"]')).toBeAttached();
  }
});
