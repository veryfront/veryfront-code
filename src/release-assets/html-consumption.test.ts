import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  finalizeRequestProfiling,
  resetRequestProfiles,
  runWithRequestProfiling,
} from "#veryfront/observability/request-profiler.ts";
import {
  normalizeManifestModuleKey,
  resolveManifestModuleUrl,
  resolveManifestRoutePreloadUrls,
} from "./html-consumption.ts";
import {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  getReadyManifestForRender,
  getReadyManifestForRenderAsync,
  registerManifestFetcherForRelease,
} from "./manifest-cache.ts";
import {
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
} from "./constants.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

const MOD_HASH = "a".repeat(64);

function manifest(contentHash = MOD_HASH, manifestVersion = 3): ReleaseAssetManifest {
  return {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: "p",
    releaseId: "r",
    releaseVersion: 1,
    manifestVersion,
    builderVersion: "0.1.765",
    sourceContentHash: "f".repeat(64),
    createdAt: "2026-06-12T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {
      "pages/index.tsx": { contentHash, size: 1, contentType: "text/javascript" },
    },
    css: [],
    routes: { "/": { modules: ["pages/index.tsx"], css: [] } },
    dependencyMode: "source",
    dependencies: {},
  };
}

function manifestResponse(state: string, value: ReleaseAssetManifest | null) {
  return {
    state,
    manifest_version: value?.manifestVersion ?? 0,
    manifest: value,
  };
}

function readyManifestResponse(value = manifest()) {
  return manifestResponse("ready", value);
}

describe("html consumption helpers", () => {
  it("normalizes _vf_modules prefixed paths to logical keys", () => {
    assertEquals(normalizeManifestModuleKey("/_vf_modules/pages/index.js"), "pages/index.js");
    assertEquals(normalizeManifestModuleKey("pages/index.tsx"), "pages/index.tsx");
  });

  it("rewrites a covered module to a hashed asset URL", () => {
    const url = resolveManifestModuleUrl(manifest(), "pages/index.tsx");
    assertEquals(url, `/_vf/assets/${MOD_HASH}.js`);
  });

  it("matches by extension-stripped key (js URL vs source ext)", () => {
    const url = resolveManifestModuleUrl(manifest(), "/_vf_modules/pages/index.js");
    assertEquals(url, `/_vf/assets/${MOD_HASH}.js`);
  });

  it("matches arbitrary-folder module URLs with query parameters", () => {
    const customManifest = manifest();
    customManifest.modules["providers/BreakpointsProvider.tsx"] = {
      contentHash: MOD_HASH,
      size: 1,
      contentType: "text/javascript",
    };

    const url = resolveManifestModuleUrl(
      customManifest,
      "/_vf_modules/providers/BreakpointsProvider.js?studio_embed=true",
    );

    assertEquals(url, `/_vf/assets/${MOD_HASH}.js`);
  });

  it("returns null (fallback) for an uncovered module", () => {
    assertEquals(resolveManifestModuleUrl(manifest(), "pages/missing.tsx"), null);
  });

  it("resolves the route closure preload URLs", () => {
    assertEquals(resolveManifestRoutePreloadUrls(manifest(), "/"), [
      `/_vf/assets/${MOD_HASH}.js`,
    ]);
  });

  it("returns no preloads for an uncovered route", () => {
    assertEquals(resolveManifestRoutePreloadUrls(manifest(), "/other"), []);
  });

  it("ignores inherited route and module entries", () => {
    const inheritedRoutes = Object.create({
      "/inherited": { modules: ["pages/index.tsx"], css: [] },
    }) as ReleaseAssetManifest["routes"];
    const inheritedModules = Object.create({
      "pages/inherited.tsx": {
        contentHash: MOD_HASH,
        size: 1,
        contentType: "text/javascript",
      },
    }) as ReleaseAssetManifest["modules"];
    const value = manifest();
    value.routes = inheritedRoutes;
    value.modules = inheritedModules;

    assertEquals(resolveManifestRoutePreloadUrls(value, "/inherited"), []);
    assertEquals(resolveManifestModuleUrl(value, "pages/inherited.tsx"), null);
  });

  it("deduplicates repeated preload identities", () => {
    const value = manifest();
    value.routes["/"]!.modules.push("pages/index.tsx");
    assertEquals(resolveManifestRoutePreloadUrls(value, "/"), [
      `/_vf/assets/${MOD_HASH}.js`,
    ]);
  });

  it("falls back instead of emitting a malformed content hash", () => {
    const value = manifest();
    value.modules["pages/index.tsx"]!.contentHash = "../asset";
    assertEquals(resolveManifestModuleUrl(value, "pages/index.tsx"), null);
    assertEquals(resolveManifestRoutePreloadUrls(value, "/"), []);
  });
});

describe("manifest cache gating", () => {
  const originalFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);

  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalFlag ?? "");
    Deno.env.delete("VERYFRONT_ENABLE_SERVER_TIMING");
    clearReleaseAssetManifestCache();
    resetRequestProfiles();
  });

  it("returns null when the flag is off (byte-identical fallback)", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "");
    let fetchCount = 0;
    registerManifestFetcherForRelease("r", () => {
      fetchCount++;
      return Promise.resolve(readyManifestResponse());
    });
    assertEquals(getReadyManifestForRender("r"), null);
    await Promise.resolve();
    assertEquals(fetchCount, 0, "a disabled flag must not reach the control plane");
  });

  it("returns null when no fetcher is registered", () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    assertEquals(getReadyManifestForRender("r"), null);
  });

  it("marks the no-fetcher fallback reason during profiled async reads", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");

    const record = await runWithRequestProfiling(
      { category: "html", method: "GET", pathname: "/" },
      async () => {
        assertEquals(await getReadyManifestForRenderAsync("r"), null);
        return finalizeRequestProfiling(200);
      },
    );

    assertEquals(record?.phases["release_manifest.no_fetcher"], 0);
  });

  it("marks ready manifest fetches during profiled async reads", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    registerManifestFetcherForRelease("r", () => Promise.resolve(readyManifestResponse()));

    const record = await runWithRequestProfiling(
      { category: "html", method: "GET", pathname: "/" },
      async () => {
        assertEquals((await getReadyManifestForRenderAsync("r"))?.manifestVersion, 3);
        return finalizeRequestProfiling(200);
      },
    );

    assertEquals(record?.phases["release_manifest.fetch_ready"], 0);
  });

  it("rejects partial manifests even when they include a manifest body", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    registerManifestFetcherForRelease(
      "r",
      () => Promise.resolve(manifestResponse("partial", manifest())),
    );

    const record = await runWithRequestProfiling(
      { category: "html", method: "GET", pathname: "/" },
      async () => {
        assertEquals(await getReadyManifestForRenderAsync("r"), null);
        return finalizeRequestProfiling(200);
      },
    );

    assertEquals(record?.phases["release_manifest.fetch_partial"], 0);
    assertEquals(record?.phases["release_manifest.fetch_not_ready"], 0);
    assertEquals(getReadyManifestForRender("r"), null);
  });

  it("marks manifest fetch failures during profiled async reads", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    registerManifestFetcherForRelease("r", () => Promise.reject(new Error("boom")));

    const record = await runWithRequestProfiling(
      { category: "html", method: "GET", pathname: "/" },
      async () => {
        assertEquals(await getReadyManifestForRenderAsync("r"), null);
        return finalizeRequestProfiling(200);
      },
    );

    assertEquals(record?.phases["release_manifest.fetch_failed"], 0);
  });

  it("caches a ready manifest after a background fetch", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let resolveFetch: () => void = () => {};
    const gate = new Promise<void>((r) => (resolveFetch = r));
    registerManifestFetcherForRelease("r", async () => {
      await gate;
      return readyManifestResponse();
    });

    // First call schedules the fetch and returns null.
    assertEquals(getReadyManifestForRender("r"), null);
    resolveFetch();
    // Allow the background fetch microtasks to settle.
    await new Promise((r) => setTimeout(r, 0));

    const cached = getReadyManifestForRender("r");
    assertEquals(cached?.manifestVersion, 3);
  });

  it("awaits a ready manifest on the first async read", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    registerManifestFetcherForRelease("r", () => Promise.resolve(readyManifestResponse()));

    const ready = await getReadyManifestForRenderAsync("r");

    assertEquals(ready?.manifestVersion, 3);
    assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);
  });

  it("dedupes concurrent async ready-manifest reads", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let resolveFetch: () => void = () => {};
    const gate = new Promise<void>((resolve) => (resolveFetch = resolve));
    let fetchCount = 0;

    registerManifestFetcherForRelease("r", async () => {
      fetchCount++;
      await gate;
      return readyManifestResponse();
    });

    const first = getReadyManifestForRenderAsync("r");
    const second = getReadyManifestForRenderAsync("r");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(fetchCount, 1);

    resolveFetch();
    const [firstReady, secondReady] = await Promise.all([first, second]);
    assertEquals(firstReady?.manifestVersion, 3);
    assertEquals(secondReady?.manifestVersion, 3);
    assertEquals(fetchCount, 1);
  });

  it("revalidates cached non-ready entries on awaited refresh reads", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let now = 1_000;
    const originalDateNow = Date.now;
    Date.now = () => now;

    try {
      let fetchCount = 0;
      registerManifestFetcherForRelease("r", async () => {
        fetchCount++;
        return fetchCount === 1 ? manifestResponse("building", null) : readyManifestResponse();
      });

      assertEquals(await getReadyManifestForRenderAsync("r"), null);
      assertEquals(fetchCount, 1);

      now += 1_000;
      assertEquals(await getReadyManifestForRenderAsync("r", { refreshCachedNull: true }), null);
      assertEquals(fetchCount, 1);

      now += 5_000;
      assertEquals(
        (await getReadyManifestForRenderAsync("r", { refreshCachedNull: true }))
          ?.manifestVersion,
        3,
      );
      assertEquals(fetchCount, 2);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("ignores stale in-flight manifest fetches after the cache is cleared", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);
    let resolveFirst: () => void = () => {};
    let resolveSecond: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => (resolveFirst = resolve));
    const secondGate = new Promise<void>((resolve) => (resolveSecond = resolve));
    let fetchCount = 0;

    registerManifestFetcherForRelease("r", async () => {
      fetchCount++;
      if (fetchCount === 1) {
        await firstGate;
        return readyManifestResponse(manifest(firstHash));
      }

      await secondGate;
      return readyManifestResponse(manifest(secondHash));
    });

    assertEquals(getReadyManifestForRender("r"), null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(fetchCount, 1);

    clearCachedReleaseAssetManifests();
    assertEquals(getReadyManifestForRender("r"), null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(fetchCount, 2);

    resolveSecond();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(
      getReadyManifestForRender("r")?.modules["pages/index.tsx"]?.contentHash,
      secondHash,
    );

    resolveFirst();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assertEquals(
      getReadyManifestForRender("r")?.modules["pages/index.tsx"]?.contentHash,
      secondHash,
    );
  });

  it("refreshes cached ready manifests so same-release rebuilds are discovered", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);
    let now = 1_000;
    const originalDateNow = Date.now;
    Date.now = () => now;

    try {
      let fetchCount = 0;
      registerManifestFetcherForRelease("r", async () => {
        fetchCount++;
        return fetchCount === 1
          ? readyManifestResponse(manifest(firstHash, 3))
          : readyManifestResponse(manifest(secondHash, 4));
      });

      assertEquals(getReadyManifestForRender("r"), null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);

      now += 61_000;
      assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const refreshed = getReadyManifestForRender("r");
      assertEquals(refreshed?.manifestVersion, 4);
      assertEquals(refreshed?.modules["pages/index.tsx"]?.contentHash, secondHash);
    } finally {
      Date.now = originalDateNow;
    }
  });

  const invalidatingRefreshes = [
    {
      name: "a partial response",
      response: () => manifestResponse("partial", manifest("b".repeat(64), 4)),
    },
    {
      name: "a terminal failed response",
      response: () => manifestResponse("failed", manifest("b".repeat(64), 4)),
    },
    {
      name: "a ready response with a mismatched envelope generation",
      response: () => ({
        state: "ready",
        manifest_version: 3,
        manifest: manifest("b".repeat(64), 4),
      }),
    },
  ];

  for (const invalidatingRefresh of invalidatingRefreshes) {
    it(`evicts a cached ready manifest after ${invalidatingRefresh.name}`, async () => {
      setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
      let now = 1_000;
      const originalDateNow = Date.now;
      Date.now = () => now;

      try {
        let fetchCount = 0;
        registerManifestFetcherForRelease("r", async () => {
          fetchCount++;
          return fetchCount === 1
            ? readyManifestResponse(manifest("a".repeat(64), 3))
            : invalidatingRefresh.response();
        });

        assertEquals(getReadyManifestForRender("r"), null);
        await new Promise((resolve) => setTimeout(resolve, 0));
        assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);

        now += 61_000;
        assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);
        await new Promise((resolve) => setTimeout(resolve, 0));

        assertEquals(fetchCount, 2);
        assertEquals(getReadyManifestForRender("r"), null);
      } finally {
        Date.now = originalDateNow;
      }
    });
  }

  it("throttles failed ready-manifest revalidation while serving the stale ready manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let now = 1_000;
    const originalDateNow = Date.now;
    Date.now = () => now;

    try {
      let fetchCount = 0;
      registerManifestFetcherForRelease("r", async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return readyManifestResponse(manifest("a".repeat(64), 3));
        }
        throw new Error("temporary control-plane outage");
      });

      assertEquals(getReadyManifestForRender("r"), null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);

      now += 61_000;
      assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(fetchCount, 2);

      assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(fetchCount, 2);
    } finally {
      Date.now = originalDateNow;
    }
  });
});
