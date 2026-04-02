/**
 * Shared Playwright fixtures for browser E2E tests.
 *
 * Auto-fails tests when non-ignorable console/page errors are observed so
 * browser suites catch hydration/runtime regressions without per-test boilerplate.
 */

import { expect, test as base } from "npm:playwright@1.59.0/test";
import { findHydrationOrCspFailures } from "../../_helpers/playwright.ts";
import { setupErrorCollection } from "../helpers/assertions.ts";

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [async ({ page }, use) => {
    const errors = setupErrorCollection(page);

    await use(errors);

    expect(findHydrationOrCspFailures(errors)).toEqual([]);
    expect(errors).toEqual([]);
  }, { auto: true }],
});

export { expect };
