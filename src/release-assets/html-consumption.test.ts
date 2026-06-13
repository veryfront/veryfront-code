import "#veryfront/schemas/_test-setup.ts";

import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  normalizeManifestModuleKey,
  resolveManifestModuleUrl,
  resolveManifestRoutePreloadUrls,
} from "./html-consumption.ts";
import {
  clearCachedReleaseAssetManifests,
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
  getReadyManifestForRender,
} from "./manifest-cache.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "./constants.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

const MOD_HASH = "a".repeat(64);

function manifest(contentHash = MOD_HASH): ReleaseAssetManifest {
  return {
    schemaVersion: 1,
    projectId: "p",
    releaseId: "r",
    releaseVersion: 1,
    manifestVersion: 3,
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
});

describe("manifest cache gating", () => {
  const originalFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);

  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalFlag ?? "");
    configureReleaseAssetManifestFetcher(undefined);
    clearReleaseAssetManifestCache();
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
});
