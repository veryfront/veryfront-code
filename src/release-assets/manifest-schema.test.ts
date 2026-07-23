import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RELEASE_ASSET_MAX_SIZE_BYTES } from "./constants.ts";
import {
  getReleaseAssetManifestSchema,
  parseReleaseAssetManifest,
  type ReleaseAssetManifest,
} from "./manifest-schema.ts";

function validManifest(): ReleaseAssetManifest {
  return {
    schemaVersion: 1,
    projectId: "11111111-1111-1111-1111-111111111111",
    releaseId: "22222222-2222-2222-2222-222222222222",
    releaseVersion: 7,
    manifestVersion: 1,
    builderVersion: "0.1.765",
    sourceContentHash: "abc123",
    createdAt: "2026-06-12T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {
      "pages/index.tsx": {
        contentHash: "a".repeat(64),
        size: 1234,
        contentType: "text/javascript",
      },
    },
    css: [
      {
        contentHash: "b".repeat(64),
        size: 4321,
        contentType: "text/css",
        styleProfileHash: null,
      },
    ],
    routes: {
      "/": { modules: ["pages/index.tsx"], css: ["b".repeat(64)] },
    },
    dependencies: {},
    fallback: { mode: "jit", gaps: [] },
  };
}

describe("release asset manifest schema", () => {
  it("round-trips a valid manifest through the zod validator", () => {
    const manifest = validManifest();
    const parsed = getReleaseAssetManifestSchema().parse(manifest);
    assertEquals(parsed, manifest);
  });

  it("accepts reserved dependencies entries shaped like modules", () => {
    const manifest = validManifest();
    manifest.dependencies = {
      "npm:react": { contentHash: "c".repeat(64), size: 10, contentType: "text/javascript" },
    };
    const parsed = getReleaseAssetManifestSchema().parse(manifest);
    assertEquals(parsed.dependencies["npm:react"]?.size, 10);
  });

  it("round-trips via the hand-rolled validator", () => {
    const manifest = validManifest();
    const parsed = parseReleaseAssetManifest(manifest);
    assertExists(parsed);
    assertEquals(parsed, manifest);
  });

  it("rejects a wrong schema version in the hand-rolled validator", () => {
    const manifest = { ...validManifest(), schemaVersion: 2 };
    assertEquals(parseReleaseAssetManifest(manifest), null);
  });

  it("rejects a malformed module entry in the hand-rolled validator", () => {
    const manifest = validManifest();
    // deno-lint-ignore no-explicit-any -- intentionally malformed for the test
    (manifest.modules as any)["pages/bad.tsx"] = { contentHash: 123 };
    assertEquals(parseReleaseAssetManifest(manifest), null);
  });

  it("rejects non-object input", () => {
    assertEquals(parseReleaseAssetManifest(null), null);
    assertEquals(parseReleaseAssetManifest("nope"), null);
    assertEquals(parseReleaseAssetManifest(42), null);
  });

  it("rejects accessor-backed records without invoking their getters", () => {
    const manifest = validManifest();
    let getterInvoked = false;
    Object.defineProperty(manifest.modules, "pages/accessor.tsx", {
      enumerable: true,
      get() {
        getterInvoked = true;
        return {
          contentHash: "c".repeat(64),
          size: 1,
          contentType: "text/javascript",
        };
      },
    });

    assertEquals(parseReleaseAssetManifest(manifest), null);
    assertEquals(getterInvoked, false);
  });

  it("returns a detached immutable snapshot", () => {
    const manifest = validManifest();
    const parsed = parseReleaseAssetManifest(manifest);
    assertExists(parsed);

    manifest.modules["pages/index.tsx"]!.contentHash = "c".repeat(64);
    manifest.routes["/"]!.modules.push("pages/late.tsx");

    assertEquals(parsed.modules["pages/index.tsx"]?.contentHash, "a".repeat(64));
    assertEquals(parsed.routes["/"]?.modules, ["pages/index.tsx"]);
    assertEquals(Object.isFrozen(parsed), true);
    assertEquals(Object.isFrozen(parsed.modules), true);
    assertEquals(Object.isFrozen(parsed.modules["pages/index.tsx"]), true);
    assertEquals(Object.isFrozen(parsed.routes["/"]?.modules), true);
  });

  it("rejects invalid asset descriptors and closure references", () => {
    const invalidHash = validManifest();
    invalidHash.modules["pages/index.tsx"]!.contentHash = "not-a-hash";

    const invalidSize = validManifest();
    invalidSize.modules["pages/index.tsx"]!.size = RELEASE_ASSET_MAX_SIZE_BYTES + 1;

    const invalidContentType = validManifest();
    (invalidContentType.modules["pages/index.tsx"] as { contentType: string }).contentType =
      "text/css";

    const invalidBasePath = validManifest();
    (invalidBasePath as { assetBasePath: string }).assetBasePath = "//assets.example.test";

    const missingModule = validManifest();
    missingModule.routes["/"]!.modules = ["pages/missing.tsx"];

    const missingCss = validManifest();
    missingCss.routes["/"]!.css = ["c".repeat(64)];

    for (
      const candidate of [
        invalidHash,
        invalidSize,
        invalidContentType,
        invalidBasePath,
        missingModule,
        missingCss,
      ]
    ) {
      assertEquals(parseReleaseAssetManifest(candidate), null);
      assertEquals(getReleaseAssetManifestSchema().safeParse(candidate).success, false);
    }
  });

  it("rejects route closures that exceed the manifest work budget", () => {
    const manifest = validManifest();
    manifest.routes["/"]!.modules = Array.from(
      { length: 10_001 },
      () => "pages/index.tsx",
    );

    assertEquals(parseReleaseAssetManifest(manifest), null);
  });

  it("applies UTF-8 byte limits consistently in both validators", () => {
    const manifest = validManifest();
    manifest.css[0]!.styleProfileHash = "é".repeat(65);

    assertEquals(parseReleaseAssetManifest(manifest), null);
    assertEquals(getReleaseAssetManifestSchema().safeParse(manifest).success, false);
  });
});
