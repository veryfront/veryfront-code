import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildReleaseAssetModules } from "./client-module-map.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";
import { RELEASE_ASSET_MANIFEST_SCHEMA_VERSION } from "./constants.ts";

const PAGE_HASH = "a".repeat(64);
const FALLBACK_HASH = "b".repeat(64);

function manifestWithModules(
  modules: ReleaseAssetManifest["modules"],
  routes: ReleaseAssetManifest["routes"] = {},
): ReleaseAssetManifest {
  return {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
    projectId: "project-1",
    releaseId: "release-1",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "test",
    sourceContentHash: "a".repeat(64),
    createdAt: "2026-07-26T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules,
    css: [],
    routes,
    dependencyMode: "source",
    dependencies: {},
  };
}

function manifest(): ReleaseAssetManifest {
  return manifestWithModules(
    {
      "app/page.tsx": {
        contentHash: PAGE_HASH,
        size: 1,
        contentType: "text/javascript",
      },
      "components/Fallback.tsx": {
        contentHash: FALLBACK_HASH,
        size: 1,
        contentType: "text/javascript",
      },
    },
    {
      "/": { modules: ["app/page.tsx"], css: [] },
      "/empty": { modules: [], css: [] },
      "/partial-stale": { modules: ["app/page.tsx", "src/site/page.tsx"], css: [] },
      "/stale": { modules: ["src/site/page.tsx"], css: [] },
    },
  );
}

describe("release asset client module map", () => {
  it("uses an own-property-only result for adversarial module keys", () => {
    const modules = JSON.parse(
      `{"__proto__":{"contentHash":"${PAGE_HASH}","size":1,"contentType":"text/javascript"}}`,
    ) as ReleaseAssetManifest["modules"];

    const result = buildReleaseAssetModules(manifestWithModules(modules));

    assertEquals(Object.getPrototypeOf(result), null);
    assertEquals(Object.hasOwn(result ?? {}, "__proto__"), true);
    assertEquals(result?.["__proto__"], `/_vf/assets/${PAGE_HASH}.js`);
  });

  it("omits malformed runtime entries instead of emitting unsafe URLs", () => {
    const result = buildReleaseAssetModules(
      manifestWithModules({
        "pages/index.tsx": {
          contentHash: "../asset",
          size: 1,
          contentType: "text/javascript",
        },
      }),
    );

    assertEquals(result, undefined);
  });

  it("can scope a browser map to an explicit module set", () => {
    const result = buildReleaseAssetModules(
      manifestWithModules({
        "app/page.tsx": {
          contentHash: FALLBACK_HASH,
          size: 1,
          contentType: "text/javascript",
        },
        "app/unrelated.tsx": {
          contentHash: "c".repeat(64),
          size: 1,
          contentType: "text/javascript",
        },
      }),
      {
        logicalPaths: ["app/page.tsx", "app/page.tsx", "app/missing.tsx"],
      },
    );

    assertEquals(result, {
      "app/page.tsx": `/_vf/assets/${FALLBACK_HASH}.js`,
    });
  });

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
