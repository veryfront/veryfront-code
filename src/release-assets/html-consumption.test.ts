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
import { buildReleaseAssetModules } from "./client-module-map.ts";
import {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
  getReadyManifestForRender,
  getReadyManifestForRenderAsync,
  registerManifestFetcherForRelease,
} from "./manifest-cache.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "./constants.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

const MOD_HASH = "a".repeat(64);

function manifest(contentHash = MOD_HASH, manifestVersion = 3): ReleaseAssetManifest {
  return {
    schemaVersion: 1,
    projectId: "p",
    releaseId: "r",
    releaseVersion: 1,
    manifestVersion,
    builderVersion: "0.1.765",
    sourceContentHash: "",
    createdAt: "2026-06-12T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {
      "pages/index.tsx": { contentHash, size: 1, contentType: "text/javascript" },
    },
    css: [],
    routes: { "/": { modules: ["pages/index.tsx"], css: [] } },
    dependencies: {},
    fallback: { mode: "jit", gaps: [] },
  };
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

  it("does not invoke accessors while resolving modules or route closures", () => {
    const accessorManifest = manifest();
    let moduleGetterInvoked = false;
    let routeGetterInvoked = false;
    Object.defineProperty(accessorManifest.modules, "pages/index.tsx", {
      enumerable: true,
      get() {
        moduleGetterInvoked = true;
        return { contentHash: MOD_HASH, size: 1, contentType: "text/javascript" };
      },
    });
    Object.defineProperty(accessorManifest.routes, "/", {
      enumerable: true,
      get() {
        routeGetterInvoked = true;
        return { modules: ["pages/index.tsx"], css: [] };
      },
    });

    assertEquals(resolveManifestModuleUrl(accessorManifest, "pages/index.tsx"), null);
    assertEquals(resolveManifestRoutePreloadUrls(accessorManifest, "/"), []);
    assertEquals(moduleGetterInvoked, false);
    assertEquals(routeGetterInvoked, false);
  });

  it("builds an immutable prototype-free client module map", () => {
    const modules = buildReleaseAssetModules(manifest());

    assertEquals(modules?.["pages/index.tsx"], `/_vf/assets/${MOD_HASH}.js`);
    assertEquals(Object.getPrototypeOf(modules), null);
    assertEquals(Object.isFrozen(modules), true);
  });
});

describe("manifest cache gating", () => {
  const originalFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);

  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalFlag ?? "");
    Deno.env.delete("VERYFRONT_ENABLE_SERVER_TIMING");
    configureReleaseAssetManifestFetcher(undefined);
    clearReleaseAssetManifestCache();
    resetRequestProfiles();
  });

  it("returns null when the flag is off (byte-identical fallback)", () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "ready", manifest: manifest() })
    );
    assertEquals(getReadyManifestForRender("r"), null);
  });

  it("returns null when no fetcher is registered", () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(undefined);
    assertEquals(getReadyManifestForRender("r"), null);
  });

  it("marks the no-fetcher fallback reason during profiled async reads", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    configureReleaseAssetManifestFetcher(undefined);

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
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "ready", manifest: manifest() })
    );

    const record = await runWithRequestProfiling(
      { category: "html", method: "GET", pathname: "/" },
      async () => {
        assertEquals((await getReadyManifestForRenderAsync("r"))?.manifestVersion, 3);
        return finalizeRequestProfiling(200);
      },
    );

    assertEquals(record?.phases["release_manifest.fetch_ready"], 0);
  });

  it("uses partial manifests that include a manifest body", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "partial", manifest: manifest() })
    );

    const record = await runWithRequestProfiling(
      { category: "html", method: "GET", pathname: "/" },
      async () => {
        assertEquals((await getReadyManifestForRenderAsync("r"))?.manifestVersion, 3);
        return finalizeRequestProfiling(200);
      },
    );

    assertEquals(record?.phases["release_manifest.fetch_partial"], 0);
    assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);
  });

  it("marks manifest fetch failures during profiled async reads", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    configureReleaseAssetManifestFetcher(() => Promise.reject(new Error("boom")));

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
    configureReleaseAssetManifestFetcher(async () => {
      await gate;
      return { state: "ready", manifest: manifest() };
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
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "ready", manifest: manifest() })
    );

    const ready = await getReadyManifestForRenderAsync("r");

    assertEquals(ready?.manifestVersion, 3);
    assertEquals(getReadyManifestForRender("r")?.manifestVersion, 3);
  });

  it("dedupes concurrent async ready-manifest reads", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let resolveFetch: () => void = () => {};
    const gate = new Promise<void>((resolve) => (resolveFetch = resolve));
    let fetchCount = 0;

    configureReleaseAssetManifestFetcher(async () => {
      fetchCount++;
      await gate;
      return { state: "ready", manifest: manifest() };
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

  it("does not cache a manifest under a different release identity", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "ready", manifest: manifest() })
    );

    assertEquals(await getReadyManifestForRenderAsync("different-release"), null);
    assertEquals(getReadyManifestForRender("different-release"), null);
  });

  it("prevents a replaced fetcher from publishing an older in-flight manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let releaseOldFetch: () => void = () => {};
    const oldGate = new Promise<void>((resolve) => (releaseOldFetch = resolve));

    registerManifestFetcherForRelease("r", async () => {
      await oldGate;
      return { state: "ready", manifest: manifest("a".repeat(64), 3) };
    });

    const oldRead = getReadyManifestForRenderAsync("r");
    await new Promise((resolve) => setTimeout(resolve, 0));

    registerManifestFetcherForRelease(
      "r",
      () => Promise.resolve({ state: "ready", manifest: manifest("b".repeat(64), 4) }),
    );
    const currentRead = getReadyManifestForRenderAsync("r");
    releaseOldFetch();

    assertEquals(await oldRead, null);
    assertEquals(
      (await currentRead)?.modules["pages/index.tsx"]?.contentHash,
      "b".repeat(64),
    );
    assertEquals(
      getReadyManifestForRender("r")?.modules["pages/index.tsx"]?.contentHash,
      "b".repeat(64),
    );
  });

  it("does not cache an obsolete fetch failure after replacing its fetcher", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let rejectOldFetch: (error: Error) => void = () => {};

    registerManifestFetcherForRelease(
      "r",
      () => new Promise<never>((_resolve, reject) => (rejectOldFetch = reject)),
    );
    const oldRead = getReadyManifestForRenderAsync("r");
    await new Promise((resolve) => setTimeout(resolve, 0));

    let currentFetches = 0;
    registerManifestFetcherForRelease("r", () => {
      currentFetches++;
      return Promise.resolve({ state: "ready", manifest: manifest("b".repeat(64), 4) });
    });
    rejectOldFetch(new Error("obsolete fetch failed"));

    assertEquals(await oldRead, null);
    assertEquals((await getReadyManifestForRenderAsync("r"))?.manifestVersion, 4);
    assertEquals(currentFetches, 1);
  });

  it("guards against ABA fetcher replacement when a function is reused", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let releaseFirstFetch: () => void = () => {};
    const firstGate = new Promise<void>((resolve) => (releaseFirstFetch = resolve));
    let calls = 0;
    const reusedFetcher = async () => {
      calls++;
      if (calls === 1) {
        await firstGate;
        return { state: "ready", manifest: manifest("a".repeat(64), 6) };
      }
      return { state: "ready", manifest: manifest("c".repeat(64), 5) };
    };

    registerManifestFetcherForRelease("r", reusedFetcher);
    const staleRead = getReadyManifestForRenderAsync("r");
    await new Promise((resolve) => setTimeout(resolve, 0));

    registerManifestFetcherForRelease("r", () => Promise.resolve(null));
    registerManifestFetcherForRelease("r", reusedFetcher);
    const currentRead = getReadyManifestForRenderAsync("r");
    assertEquals(
      (await currentRead)?.modules["pages/index.tsx"]?.contentHash,
      "c".repeat(64),
    );

    releaseFirstFetch();
    assertEquals(await staleRead, null);
    assertEquals(
      getReadyManifestForRender("r")?.modules["pages/index.tsx"]?.contentHash,
      "c".repeat(64),
    );
  });

  it("revalidates cached non-ready entries on awaited refresh reads", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let now = 1_000;
    const originalDateNow = Date.now;
    Date.now = () => now;

    try {
      let fetchCount = 0;
      configureReleaseAssetManifestFetcher(async () => {
        fetchCount++;
        return fetchCount === 1
          ? { state: "building", manifest: null }
          : { state: "ready", manifest: manifest() };
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

    configureReleaseAssetManifestFetcher(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        await firstGate;
        return { state: "ready", manifest: manifest(firstHash) };
      }

      await secondGate;
      return { state: "ready", manifest: manifest(secondHash) };
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
      configureReleaseAssetManifestFetcher(async () => {
        fetchCount++;
        return fetchCount === 1
          ? { state: "ready", manifest: manifest(firstHash, 3) }
          : { state: "ready", manifest: manifest(secondHash, 4) };
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

  it("throttles failed ready-manifest revalidation while serving the stale ready manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    let now = 1_000;
    const originalDateNow = Date.now;
    Date.now = () => now;

    try {
      let fetchCount = 0;
      configureReleaseAssetManifestFetcher(async () => {
        fetchCount++;
        return fetchCount === 1 ? { state: "ready", manifest: manifest("a".repeat(64), 3) } : null;
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
