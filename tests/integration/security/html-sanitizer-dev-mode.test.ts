/**
 * Integration coverage for the dev-mode branch of `validateTrustedHtml`.
 *
 * These cases cannot live beside the unit under test: `validateTrustedHtml`
 * resolves the dev/production decision through the module-private `isDevMode()`
 * (src/security/client/html-sanitizer.ts), which reads
 * `globalThis.__VERYFRONT_DEV__` and `Deno.env.get("VERYFRONT_ENV")` on every
 * call. `ValidateTrustedHtmlOptions` exposes only `strict`, `warn` and
 * `allowInlineScripts`, and the module ships no factory or `*ForTesting` hook,
 * so pinning either arm requires mutating the real global object and the real
 * process environment — host effects a colocated unit test may not perform.
 *
 * This branch is worth pinning because the three production innerHTML sinks
 * (rendering/rsc/client-dom.ts, rendering/rsc/client-boot.ts,
 * routing/client/page-transition.ts) all call `validateTrustedHtml(html)` with
 * no options at all, so the no-options shape is the one that actually protects
 * users. Every hermetic assertion stays in
 * src/security/client/html-sanitizer.test.ts.
 */

import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing";
import { validateTrustedHtml } from "#veryfront/security/client/html-sanitizer.ts";

/** Run `fn` with the client dev flag forced to `value` (absent when undefined). */
function withDevFlag<T>(value: boolean | undefined, fn: () => T): T {
  const globals = globalThis as Record<string, unknown>;
  const hadFlag = "__VERYFRONT_DEV__" in globals;
  const previousFlag = globals.__VERYFRONT_DEV__;
  if (value === undefined) delete globals.__VERYFRONT_DEV__;
  else globals.__VERYFRONT_DEV__ = value;
  try {
    return fn();
  } finally {
    if (hadFlag) globals.__VERYFRONT_DEV__ = previousFlag;
    else delete globals.__VERYFRONT_DEV__;
  }
}

describe("security/client/html-sanitizer validateTrustedHtml dev mode", () => {
  it("throws outside dev mode when called without options", async () => {
    await withEnv({ VERYFRONT_ENV: "production" }, () => {
      withDevFlag(undefined, () => {
        assertThrows(
          () => validateTrustedHtml('<svg onload="alert(1)"></svg>'),
          Error,
          "event handler",
          "production callers pass no options and must still be protected",
        );
      });
      return Promise.resolve();
    });
  });

  it("warns and passes suspicious HTML through in dev mode", async () => {
    await withEnv({ VERYFRONT_ENV: "production" }, () => {
      withDevFlag(true, () => {
        const svg = '<svg onload="alert(1)"></svg>';
        assertEquals(
          validateTrustedHtml(svg, { warn: false }),
          svg,
          "dev mode must warn and pass suspicious HTML through instead of throwing",
        );
      });
      return Promise.resolve();
    });
  });

  it("throws in dev mode when the caller opts into strict validation", async () => {
    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      withDevFlag(true, () => {
        assertThrows(
          () => validateTrustedHtml('<svg onload="alert(1)"></svg>', { strict: true }),
          Error,
          "event handler",
          "strict must override the dev-mode pass-through",
        );
      });
      return Promise.resolve();
    });
  });

  it("treats VERYFRONT_ENV=development as dev mode without the global flag", async () => {
    await withEnv({ VERYFRONT_ENV: "development" }, () => {
      withDevFlag(undefined, () => {
        const svg = '<svg onload="alert(1)"></svg>';
        assertEquals(
          validateTrustedHtml(svg, { warn: false }),
          svg,
          "the server-side dev signal is VERYFRONT_ENV, not the client global",
        );
      });
      return Promise.resolve();
    });
  });
});
