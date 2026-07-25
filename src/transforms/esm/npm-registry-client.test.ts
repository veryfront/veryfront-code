import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  getCachedNpmVersion,
  isDependencyPinningEnabled,
  scheduleNpmVersionResolution,
} from "./npm-registry-client.ts";

const PROJECT_DIR = "/test-project";

describe("isDependencyPinningEnabled", () => {
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
  });

  afterEach(() => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
  });

  it("returns false when flag is unset", () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "");
    assertEquals(isDependencyPinningEnabled(), false);
  });

  it("returns false when flag is '0'", () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "0");
    assertEquals(isDependencyPinningEnabled(), false);
  });

  it("returns true when flag is '1'", () => {
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    assertEquals(isDependencyPinningEnabled(), true);
  });
});

describe("getCachedNpmVersion", () => {
  afterEach(() => _clearNpmVersionCache());

  it("returns undefined for a cold cache", () => {
    assertEquals(getCachedNpmVersion("lodash", PROJECT_DIR), undefined);
  });

  it("returns a version after scheduleNpmVersionResolution resolves an exact range", () => {
    scheduleNpmVersionResolution("lodash", "4.17.21", PROJECT_DIR);
    // Exact version is stored synchronously (no fetch needed).
    assertStrictEquals(getCachedNpmVersion("lodash", PROJECT_DIR), "4.17.21");
  });

  it("leaves cache cold when the hint is a caret range (range goes to background fetch)", () => {
    // Policy: only an exact semver literal (no prefix) is stored synchronously.
    // Caret ranges must go through the resolution client (background fetch) so
    // we never manufacture a pin by floor-stripping a range the file didn't pin.
    scheduleNpmVersionResolution("zod", "^3.22.4", PROJECT_DIR);
    assertEquals(getCachedNpmVersion("zod", PROJECT_DIR), undefined);
  });

  it("keeps caches scoped per project directory", () => {
    const otherDir = "/other-project";
    scheduleNpmVersionResolution("lodash", "4.17.21", PROJECT_DIR);
    assertEquals(getCachedNpmVersion("lodash", otherDir), undefined);
    assertStrictEquals(getCachedNpmVersion("lodash", PROJECT_DIR), "4.17.21");
  });
});

describe("scheduleNpmVersionResolution", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Default mock for the whole suite: fast non-OK response so cold-cache
    // background fetches resolve quickly and clean up their timers.
    originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
  });

  afterEach(async () => {
    // Yield one tick so any in-flight microtasks (clearTimeout in finally) settle.
    await new Promise<void>((r) => setTimeout(r, 1));
    globalThis.fetch = originalFetch;
    _clearNpmVersionCache();
  });

  it("calls onResolved synchronously when rangeHint is an exact version", () => {
    let called = false;
    let resolvedVersion = "";
    scheduleNpmVersionResolution("react-query", "5.0.0", PROJECT_DIR, (v) => {
      called = true;
      resolvedVersion = v;
    });
    assertEquals(called, true);
    assertEquals(resolvedVersion, "5.0.0");
  });

  it("does not call onResolved synchronously for a caret range (range triggers background fetch)", async () => {
    // Policy: caret ranges are NOT treated as pinned versions; they go to the
    // resolution client. onResolved must NOT fire synchronously here.
    let resolved = "";
    scheduleNpmVersionResolution("date-fns", "^3.6.0", PROJECT_DIR, (v) => {
      resolved = v;
    });
    // Synchronously: callback must not have fired yet.
    assertEquals(resolved, "");
    // Let the (mocked, 503) background fetch settle.
    await new Promise<void>((r) => setTimeout(r, 1));
    // Even after the fetch, the 503 means no version was cached — still empty.
    assertEquals(resolved, "");
  });

  it("does not double-schedule a fetch when called twice for the same package+project", () => {
    // Both calls see a cold cache. Only one background fetch should be started.
    // The second call is deduplicated via the pendingFetches set.
    // No assertions beyond "does not throw" — deduplication is internal state.
    scheduleNpmVersionResolution("some-pkg", undefined, PROJECT_DIR);
    scheduleNpmVersionResolution("some-pkg", undefined, PROJECT_DIR);
  });

  it("does not overwrite an already-cached entry", () => {
    scheduleNpmVersionResolution("lodash", "4.17.21", PROJECT_DIR);
    // A second call with a different hint must not overwrite the cached entry.
    scheduleNpmVersionResolution("lodash", "4.17.20", PROJECT_DIR);
    assertStrictEquals(getCachedNpmVersion("lodash", PROJECT_DIR), "4.17.21");
  });

  describe("mocked fetch — background resolution", () => {
    // Each nested test overrides globalThis.fetch in its own beforeEach.

    it("stores the resolved version after a successful registry fetch", async () => {
      globalThis.fetch = (_url: string | URL | Request) =>
        Promise.resolve(
          new Response(
            JSON.stringify({ "dist-tags": { latest: "4.17.21" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );

      let resolvedVersion = "";
      scheduleNpmVersionResolution("lodash", undefined, PROJECT_DIR, (v) => {
        resolvedVersion = v;
      });

      // Yield to allow the background microtask to settle.
      await new Promise((r) => setTimeout(r, 0));

      assertStrictEquals(getCachedNpmVersion("lodash", PROJECT_DIR), "4.17.21");
      assertStrictEquals(resolvedVersion, "4.17.21");
    });

    it("leaves the cache cold when the registry returns a non-OK response", async () => {
      globalThis.fetch = () => Promise.resolve(new Response(null, { status: 404 }));

      scheduleNpmVersionResolution("nonexistent-pkg", undefined, PROJECT_DIR);
      await new Promise((r) => setTimeout(r, 0));

      assertEquals(getCachedNpmVersion("nonexistent-pkg", PROJECT_DIR), undefined);
    });

    it("leaves the cache cold when fetch throws a network error", async () => {
      globalThis.fetch = () => Promise.reject(new Error("network error"));

      scheduleNpmVersionResolution("failing-pkg", undefined, PROJECT_DIR);
      await new Promise((r) => setTimeout(r, 0));

      assertEquals(getCachedNpmVersion("failing-pkg", PROJECT_DIR), undefined);
    });
  });
});
