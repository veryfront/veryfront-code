import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { FakeTime } from "#std/testing/time";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  _hasNegativeCacheEntry,
  _pendingResolutions,
  _setClockForTest,
  getCachedNpmVersion,
  isDependencyPinningEnabled,
  isExactSemver,
  NEGATIVE_CACHE_BASE_TTL_MS,
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

describe("isExactSemver", () => {
  it("accepts a plain three-part version", () => {
    assertEquals(isExactSemver("1.2.3"), true);
  });

  it("accepts a prerelease with a hyphen-separated identifier", () => {
    assertEquals(isExactSemver("1.2.3-alpha-beta.1"), true);
  });

  it("accepts a prerelease with a single hyphen-separated label", () => {
    assertEquals(isExactSemver("1.0.0-rc-1"), true);
  });

  it("accepts a build-metadata identifier containing a hyphen", () => {
    assertEquals(isExactSemver("1.0.0+build-2"), true);
  });

  it("rejects invalid separators inside prerelease and build identifiers", () => {
    assertEquals(isExactSemver("1.0.0-alpha..beta"), false);
    assertEquals(isExactSemver("1.0.0+build_linux"), false);
  });

  it("rejects a caret range", () => {
    assertEquals(isExactSemver("^1.2.3"), false);
  });

  it("rejects a tilde range", () => {
    assertEquals(isExactSemver("~1.2"), false);
  });

  it("rejects a compound range", () => {
    assertEquals(isExactSemver(">=1 <2"), false);
  });

  it("rejects a bare two-part version", () => {
    assertEquals(isExactSemver("1.2"), false);
  });
});

describe("getCachedNpmVersion", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    // Mock fetch so tests that resolve a truly unversioned dependency do not
    // open real network connections or leave long-lived timers behind.
    originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
  });

  afterEach(async () => {
    // Drain all in-flight background fetches before the Deno leak sanitizer runs.
    await _pendingResolutions();
    globalThis.fetch = originalFetch;
    _clearNpmVersionCache();
  });

  it("returns undefined for a cold cache", () => {
    assertEquals(getCachedNpmVersion("lodash", PROJECT_DIR, undefined), undefined);
  });

  it("returns a version after scheduleNpmVersionResolution receives an exact version", () => {
    scheduleNpmVersionResolution("lodash", "4.17.21", PROJECT_DIR);
    // Exact version is stored synchronously (no fetch needed).
    assertStrictEquals(
      getCachedNpmVersion("lodash", PROJECT_DIR, "4.17.21"),
      "4.17.21",
    );
    assertEquals(
      getCachedNpmVersion("lodash", PROJECT_DIR, "4.17.20"),
      undefined,
    );
  });

  it("leaves cache cold without fetching latest when the hint is a caret range", () => {
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls++;
      return Promise.resolve(new Response(null, { status: 503 }));
    };

    scheduleNpmVersionResolution("zod", "^3.22.4", PROJECT_DIR);

    assertEquals(fetchCalls, 0);
    assertEquals(getCachedNpmVersion("zod", PROJECT_DIR, "^3.22.4"), undefined);
  });

  it("keeps caches scoped per project directory", () => {
    const otherDir = "/other-project";
    scheduleNpmVersionResolution("lodash", "4.17.21", PROJECT_DIR);
    assertEquals(
      getCachedNpmVersion("lodash", otherDir, "4.17.21"),
      undefined,
    );
    assertStrictEquals(
      getCachedNpmVersion("lodash", PROJECT_DIR, "4.17.21"),
      "4.17.21",
    );
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
    // Drain all in-flight background fetches so no open handles remain.
    await _pendingResolutions();
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

  it("does not replace a declared range with registry latest", async () => {
    let fetchCalls = 0;
    globalThis.fetch = () => {
      fetchCalls++;
      return Promise.resolve(
        new Response(
          JSON.stringify({ "dist-tags": { latest: "4.0.0" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    };

    let resolved = "";
    scheduleNpmVersionResolution("date-fns", "^3.6.0", PROJECT_DIR, (v) => {
      resolved = v;
    });

    await _pendingResolutions();

    assertEquals(fetchCalls, 0);
    assertEquals(resolved, "");
    assertEquals(
      getCachedNpmVersion("date-fns", PROJECT_DIR, "^3.6.0"),
      undefined,
    );
  });

  it("does not double-schedule a fetch when called twice for the same package+project", () => {
    // Both calls see a cold cache. Only one background fetch should be started.
    // The second call is deduplicated via the pendingFetches set.
    // No assertions beyond "does not throw" — deduplication is internal state.
    scheduleNpmVersionResolution("some-pkg", undefined, PROJECT_DIR);
    scheduleNpmVersionResolution("some-pkg", undefined, PROJECT_DIR);
  });

  it("does not re-resolve when called again with the same hint", () => {
    scheduleNpmVersionResolution("lodash", "4.17.21", PROJECT_DIR);
    scheduleNpmVersionResolution("lodash", "4.17.21", PROJECT_DIR);
    assertStrictEquals(
      getCachedNpmVersion("lodash", PROJECT_DIR, "4.17.21"),
      "4.17.21",
    );
  });

  it("keeps tracking a live resolution when the value cache is reset", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    globalThis.fetch = () =>
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });

    scheduleNpmVersionResolution("reset-during-fetch", undefined, PROJECT_DIR);
    _clearNpmVersionCache();

    let drained = false;
    const drain = _pendingResolutions().then(() => {
      drained = true;
    });
    await Promise.resolve();
    assertEquals(drained, false);

    resolveFetch!(
      new Response(null, { status: 503 }),
    );
    await drain;
    assertEquals(drained, true);
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

      assertStrictEquals(
        getCachedNpmVersion("lodash", PROJECT_DIR, undefined),
        "4.17.21",
      );
      assertStrictEquals(resolvedVersion, "4.17.21");
    });

    it("leaves the cache cold when the registry returns a non-OK response", async () => {
      globalThis.fetch = () => Promise.resolve(new Response(null, { status: 404 }));

      scheduleNpmVersionResolution("nonexistent-pkg", undefined, PROJECT_DIR);
      await new Promise((r) => setTimeout(r, 0));

      assertEquals(
        getCachedNpmVersion("nonexistent-pkg", PROJECT_DIR, undefined),
        undefined,
      );
    });

    it("does not corrupt an incomplete scoped package name", async () => {
      let requestUrl = "";
      globalThis.fetch = (input: string | URL | Request) => {
        requestUrl = String(input);
        return Promise.resolve(new Response(null, { status: 404 }));
      };

      scheduleNpmVersionResolution("@scope", undefined, PROJECT_DIR);
      await _pendingResolutions();

      assertEquals(requestUrl, "https://registry.npmjs.org/@scope");
    });

    it("backs off failed lookups and retries after the negative-cache window", async () => {
      using time = new FakeTime();
      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls++;
        return Promise.resolve(new Response(null, { status: 503 }));
      };

      scheduleNpmVersionResolution("temporarily-unavailable", undefined, PROJECT_DIR);
      await _pendingResolutions();
      scheduleNpmVersionResolution("temporarily-unavailable", undefined, PROJECT_DIR);
      await _pendingResolutions();
      assertEquals(fetchCalls, 1);

      await time.tickAsync(59_999);
      scheduleNpmVersionResolution("temporarily-unavailable", undefined, PROJECT_DIR);
      await _pendingResolutions();
      assertEquals(fetchCalls, 1);

      await time.tickAsync(1);
      scheduleNpmVersionResolution("temporarily-unavailable", undefined, PROJECT_DIR);
      await _pendingResolutions();
      assertEquals(fetchCalls, 2);
    });

    it("leaves the cache cold when fetch throws a network error", async () => {
      globalThis.fetch = () => Promise.reject(new Error("network error"));

      scheduleNpmVersionResolution("failing-pkg", undefined, PROJECT_DIR);
      await new Promise((r) => setTimeout(r, 0));

      assertEquals(
        getCachedNpmVersion("failing-pkg", PROJECT_DIR, undefined),
        undefined,
      );
    });

    it("ignores an unversioned resolution that finishes after a range appears", async () => {
      const responseResolvers: Array<(response: Response) => void> = [];
      const resolvedVersions: string[] = [];
      globalThis.fetch = () =>
        new Promise<Response>((resolve) => {
          responseResolvers.push(resolve);
        });

      scheduleNpmVersionResolution("racing-range", undefined, PROJECT_DIR, (version) => {
        resolvedVersions.push(version);
      });
      scheduleNpmVersionResolution("racing-range", "^2", PROJECT_DIR, (version) => {
        resolvedVersions.push(version);
      });

      responseResolvers[0]!(
        new Response(
          JSON.stringify({ "dist-tags": { latest: "1.9.0" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await _pendingResolutions();

      assertEquals(
        getCachedNpmVersion("racing-range", PROJECT_DIR, undefined),
        undefined,
      );
      assertStrictEquals(
        getCachedNpmVersion("racing-range", PROJECT_DIR, "^2"),
        undefined,
      );
      assertEquals(resolvedVersions, []);
    });

    it("clears the negative entry after a successful resolution", async () => {
      let now = 0;
      _setClockForTest(() => now);

      // First attempt fails — negative entry should be recorded.
      globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
      scheduleNpmVersionResolution("recovering-pkg", undefined, PROJECT_DIR);
      await _pendingResolutions();
      assertEquals(_hasNegativeCacheEntry(PROJECT_DIR, "recovering-pkg", undefined), true);

      // Advance past the backoff window so the next call actually fetches.
      now = NEGATIVE_CACHE_BASE_TTL_MS;

      // Second attempt succeeds — negative entry should be cleared.
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ "dist-tags": { latest: "2.0.0" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      scheduleNpmVersionResolution("recovering-pkg", undefined, PROJECT_DIR);
      await _pendingResolutions();

      assertEquals(_hasNegativeCacheEntry(PROJECT_DIR, "recovering-pkg", undefined), false);
      assertStrictEquals(getCachedNpmVersion("recovering-pkg", PROJECT_DIR, undefined), "2.0.0");
    });

    it("_clearNpmVersionCache clears negative entries and allows an immediate retry", async () => {
      globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
      scheduleNpmVersionResolution("some-pkg", undefined, PROJECT_DIR);
      await _pendingResolutions();
      assertEquals(_hasNegativeCacheEntry(PROJECT_DIR, "some-pkg", undefined), true);

      _clearNpmVersionCache();
      assertEquals(_hasNegativeCacheEntry(PROJECT_DIR, "some-pkg", undefined), false);

      // After clearing, the next call should schedule a fresh fetch (no backoff).
      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls++;
        return Promise.resolve(new Response(null, { status: 503 }));
      };
      scheduleNpmVersionResolution("some-pkg", undefined, PROJECT_DIR);
      await _pendingResolutions();
      assertEquals(fetchCalls, 1);
    });
  });
});
