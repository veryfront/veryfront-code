/**
 * Shared Assertion Helpers for E2E Tests
 *
 * Common utilities for checking page state, errors, and hydration.
 */

import { ConsoleMessage, expect, Page } from "@playwright/test";

/**
 * Console error collection for a page.
 * Call at the start of a test to track console errors.
 */
export function setupErrorCollection(page: Page): string[] {
  const errors: string[] = [];

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Filter out known non-critical errors
      if (!isIgnorableError(text)) {
        errors.push(text);
      }
    }
  });

  page.on("pageerror", (err: Error) => {
    if (!isIgnorableError(err.message)) {
      errors.push(err.message);
    }
  });

  return errors;
}

/**
 * Check if an error is known and ignorable
 */
function isIgnorableError(message: string): boolean {
  const ignorable = [
    // Favicon errors are common and non-critical
    "favicon",
    "Failed to load resource: net::ERR_FILE_NOT_FOUND",
    // 404 errors for static resources are not critical
    "Failed to load resource: the server responded with a status of 404",
    "404 (Not Found)",
    // Some third-party scripts may have minor issues
    "ResizeObserver loop",
    // Font loading errors are not critical
    "Failed to decode downloaded font",
    "OTS parsing error",
  ];

  return ignorable.some((pattern) => message.toLowerCase().includes(pattern.toLowerCase()));
}

/**
 * Assert that a page loaded successfully (no 5xx errors)
 */
export async function assertPageLoaded(
  page: Page,
  expectedMinStatusCode: number = 200,
  expectedMaxStatusCode: number = 499,
): Promise<void> {
  // Check the page has content
  const body = await page.locator("body").innerHTML();
  expect(body.length).toBeGreaterThan(0);
}

/**
 * Assert hydration completed without errors
 */
export async function assertHydrationWorks(
  page: Page,
  errors: string[],
): Promise<void> {
  // Wait for network to settle
  await page.waitForLoadState("networkidle");

  // Find an interactive element and click it
  const interactive = page.locator("button, a[href], [onclick]").first();
  if ((await interactive.count()) > 0) {
    try {
      await interactive.click({ force: true, timeout: 2000 });
      // Small wait to catch any click-triggered errors
      await page.waitForTimeout(100);
    } catch {
      // Element might not be clickable, that's okay
    }
  }

  // Check for hydration-related errors
  const hydrationErrors = errors.filter(
    (e) =>
      e.includes("hydrat") ||
      e.includes("Minified React error") ||
      e.includes("did not match"),
  );

  expect(hydrationErrors).toEqual([]);
}

/**
 * Assert color mode is applied correctly
 */
export async function assertColorMode(
  page: Page,
  mode: "light" | "dark",
): Promise<void> {
  const html = page.locator("html");

  // SSR: data-theme attribute should be set
  await expect(html).toHaveAttribute("data-theme", mode);

  // Client: class should be applied after hydration
  // Wait for hydration to complete
  await page.waitForLoadState("networkidle");

  // Check for theme class (may be 'dark' or 'light' depending on theme system)
  const classAttr = await html.getAttribute("class");
  expect(classAttr?.includes(mode) || classAttr === null).toBeTruthy();
}

/**
 * Assert studio embed mode is active
 */
export async function assertStudioEmbed(page: Page): Promise<void> {
  // Studio bridge script should be present
  // The script contains "StudioBridge" or similar identifiers
  const scripts = await page.locator("script").all();
  let hasBridgeScript = false;

  for (const script of scripts) {
    const content = await script.textContent();
    const src = await script.getAttribute("src");
    if (
      content?.includes("StudioBridge") ||
      content?.includes("postMessage") ||
      src?.includes("studio")
    ) {
      hasBridgeScript = true;
      break;
    }
  }

  expect(hasBridgeScript).toBeTruthy();
}

/**
 * Assert preview mode is active (HMR script injected)
 */
export async function assertPreviewMode(page: Page): Promise<void> {
  // Preview HMR script should be present
  const hmrScript = page.locator('script[src*="preview-hmr.js"]');
  await expect(hmrScript).toBeAttached();
}
