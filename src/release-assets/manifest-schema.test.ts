import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
});
