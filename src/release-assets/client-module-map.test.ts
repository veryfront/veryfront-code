import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";
import { buildReleaseAssetModules } from "./client-module-map.ts";

const PAGE_HASH = "a".repeat(64);
const FALLBACK_HASH = "b".repeat(64);

function manifest(): ReleaseAssetManifest {
  return {
    schemaVersion: 1,
    projectId: "project-id",
    releaseId: "release-id",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "0.1.765",
    sourceContentHash: "",
    createdAt: "2026-07-27T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {
      "app/page.tsx": { contentHash: PAGE_HASH, size: 1, contentType: "text/javascript" },
      "components/Fallback.tsx": {
        contentHash: FALLBACK_HASH,
        size: 1,
        contentType: "text/javascript",
      },
    },
    css: [],
    routes: {
      "/": { modules: ["app/page.tsx"], css: [] },
      "/empty": { modules: [], css: [] },
      "/partial-stale": { modules: ["app/page.tsx", "src/site/page.tsx"], css: [] },
      "/stale": { modules: ["src/site/page.tsx"], css: [] },
    },
    dependencies: {},
    fallback: { mode: "jit", gaps: [] },
  };
}

describe("release asset client module map", () => {
  it("uses route-scoped modules when route entries match manifest modules", () => {
    assertEquals(buildReleaseAssetModules(manifest(), { route: "/" }), {
      "app/page.tsx": `/_vf/assets/${PAGE_HASH}.js`,
    });
  });

  it("does not materialize the full fallback map when route entries match manifest modules", () => {
    const releaseManifest = manifest();
    Object.defineProperty(releaseManifest.modules["components/Fallback.tsx"], "contentHash", {
      get() {
        throw new Error("fallback module was materialized");
      },
    });

    assertEquals(buildReleaseAssetModules(releaseManifest, { route: "/" }), {
      "app/page.tsx": `/_vf/assets/${PAGE_HASH}.js`,
    });
  });

  it("falls back to the full manifest when a route has no matching module keys", () => {
    assertEquals(buildReleaseAssetModules(manifest(), { route: "/stale" }), {
      "app/page.tsx": `/_vf/assets/${PAGE_HASH}.js`,
      "components/Fallback.tsx": `/_vf/assets/${FALLBACK_HASH}.js`,
    });
  });

  it("falls back to the full manifest when a route has stale module keys", () => {
    assertEquals(buildReleaseAssetModules(manifest(), { route: "/partial-stale" }), {
      "app/page.tsx": `/_vf/assets/${PAGE_HASH}.js`,
      "components/Fallback.tsx": `/_vf/assets/${FALLBACK_HASH}.js`,
    });
  });

  it("falls back to the full manifest when a route has an empty module list", () => {
    assertEquals(buildReleaseAssetModules(manifest(), { route: "/empty" }), {
      "app/page.tsx": `/_vf/assets/${PAGE_HASH}.js`,
      "components/Fallback.tsx": `/_vf/assets/${FALLBACK_HASH}.js`,
    });
  });
});
