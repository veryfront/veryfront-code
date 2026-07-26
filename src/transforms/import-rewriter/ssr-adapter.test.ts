import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  _clearNpmVersionCache,
  _pendingResolutions,
} from "#veryfront/transforms/esm/npm-registry-client.ts";
import { rewriteSSRImportsCompat } from "./ssr-adapter.ts";

describe("ssr-adapter — resolveBareImportPin schedules background resolution", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalFlag: string | undefined;

  beforeEach(() => {
    originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
    // Fast non-OK mock so cold-cache fetches resolve quickly.
    originalFetch = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
  });

  afterEach(async () => {
    // Drain all in-flight background fetches before the sanitizer runs.
    await _pendingResolutions();
    globalThis.fetch = originalFetch;
    setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
    _clearNpmVersionCache();
  });

  it("falls back to unversioned URL on the first render when caches are cold", () => {
    const code = `import lodash from "lodash";`;
    const result = rewriteSSRImportsCompat(code, { projectDir: "/project" });
    // Cache is cold on the first call — falls back to the unversioned esm.sh URL.
    assertEquals(result.includes("esm.sh/lodash?"), true);
    assertEquals(result.includes("lodash@"), false);
  });

  it("uses a pinned version on the second render once the background fetch has resolved", async () => {
    // Override the default 503 mock to return a real version.
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({ "dist-tags": { latest: "4.17.21" } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const code = `import lodash from "lodash";`;
    // First render — cache is cold; schedules the background registry fetch.
    rewriteSSRImportsCompat(code, { projectDir: "/project" });
    // Wait for the background fetch to settle and warm the cache.
    await _pendingResolutions();
    // Second render — cache is now warm; version should be pinned.
    const result = rewriteSSRImportsCompat(code, { projectDir: "/project" });
    assertEquals(result.includes("lodash@4.17.21"), true);
  });
});
