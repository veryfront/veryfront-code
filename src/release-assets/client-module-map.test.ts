import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildReleaseAssetModules } from "./client-module-map.ts";
import type { ReleaseAssetManifest } from "./manifest-schema.ts";

function manifestWithModules(
  modules: ReleaseAssetManifest["modules"],
): ReleaseAssetManifest {
  return {
    schemaVersion: 1,
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
    routes: {},
    dependencies: {},
    fallback: { mode: "jit", gaps: [] },
  };
}

describe("release asset client module map", () => {
  it("uses an own-property-only result for adversarial module keys", () => {
    const modules = JSON.parse(
      `{"__proto__":{"contentHash":"${"a".repeat(64)}","size":1,"contentType":"text/javascript"}}`,
    ) as ReleaseAssetManifest["modules"];

    const result = buildReleaseAssetModules(manifestWithModules(modules));

    assertEquals(Object.getPrototypeOf(result), null);
    assertEquals(Object.hasOwn(result ?? {}, "__proto__"), true);
    assertEquals(result?.["__proto__"], `/_vf/assets/${"a".repeat(64)}.js`);
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
});
