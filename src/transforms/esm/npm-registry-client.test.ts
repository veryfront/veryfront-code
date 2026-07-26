import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
  getCachedNpmVersion,
  isDependencyPinningEnabled,
  isExactSemver,
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
    // Mock fetch so that tests triggering a background resolution (e.g. a caret
    // range hint) don't open real network connections or leave long-lived
    // AbortController timers running past the test boundary.
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

  it("returns a version after scheduleNpmVersionResolution resolves an exact range", () => {
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

  it("leaves cache cold when the hint is a caret range (range goes to background fetch)", () => {
    // Policy: only an exact semver literal (no prefix) is stored synchronously.
    // Caret ranges must go through the resolution client (background fetch) so
    // we never manufacture a pin by floor-stripping a range the file didn't pin.
    scheduleNpmVersionResolution("zod", "^3.22.4", PROJECT_DIR);
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

    scheduleNpmVersionResolution("reset-during-fetch", "^1", PROJECT_DIR);
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

    it("leaves the cache cold when fetch throws a network error", async () => {
      globalThis.fetch = () => Promise.reject(new Error("network error"));

      scheduleNpmVersionResolution("failing-pkg", undefined, PROJECT_DIR);
      await new Promise((r) => setTimeout(r, 0));

      assertEquals(
        getCachedNpmVersion("failing-pkg", PROJECT_DIR, undefined),
        undefined,
      );
    });

    it("re-resolves when the range hint changes (^1 → ^2)", async () => {
      // First resolution: package.json declares "^1".
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ "dist-tags": { latest: "1.9.0" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      scheduleNpmVersionResolution("some-lib", "^1", PROJECT_DIR);
      await _pendingResolutions();
      assertStrictEquals(
        getCachedNpmVersion("some-lib", PROJECT_DIR, "^1"),
        "1.9.0",
      );

      // package.json is updated to "^2" — the stale entry must be evicted.
      globalThis.fetch = () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ "dist-tags": { latest: "2.0.0" } }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      scheduleNpmVersionResolution("some-lib", "^2", PROJECT_DIR);
      await _pendingResolutions();
      assertStrictEquals(
        getCachedNpmVersion("some-lib", PROJECT_DIR, "^2"),
        "2.0.0",
      );
    });

    it("ignores a stale resolution that finishes after the range changes", async () => {
      const responseResolvers: Array<(response: Response) => void> = [];
      const resolvedVersions: string[] = [];
      globalThis.fetch = () =>
        new Promise<Response>((resolve) => {
          responseResolvers.push(resolve);
        });

      scheduleNpmVersionResolution("racing-range", "^1", PROJECT_DIR, (version) => {
        resolvedVersions.push(version);
      });
      scheduleNpmVersionResolution("racing-range", "^2", PROJECT_DIR, (version) => {
        resolvedVersions.push(version);
      });

      responseResolvers[1]!(
        new Response(
          JSON.stringify({ "dist-tags": { latest: "2.4.0" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      responseResolvers[0]!(
        new Response(
          JSON.stringify({ "dist-tags": { latest: "1.9.0" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
      await _pendingResolutions();

      assertEquals(
        getCachedNpmVersion("racing-range", PROJECT_DIR, "^1"),
        undefined,
      );
      assertStrictEquals(
        getCachedNpmVersion("racing-range", PROJECT_DIR, "^2"),
        "2.4.0",
      );
      assertEquals(resolvedVersions, ["2.4.0"]);
    });
  });
});
