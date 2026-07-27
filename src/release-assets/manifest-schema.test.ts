import "#veryfront/schemas/_test-setup.ts";

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
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
    sourceContentHash: "d".repeat(64),
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

  it("rejects unsafe asset metadata and manifest versions", () => {
    const invalidHash = validManifest();
    invalidHash.modules["pages/index.tsx"]!.contentHash = "../asset";
    assertEquals(parseReleaseAssetManifest(invalidHash), null);

    const invalidContentType = validManifest();
    invalidContentType.modules["pages/index.tsx"]!.contentType = "text/css";
    assertEquals(parseReleaseAssetManifest(invalidContentType), null);

    const invalidSize = validManifest();
    invalidSize.modules["pages/index.tsx"]!.size = Number.POSITIVE_INFINITY;
    assertEquals(parseReleaseAssetManifest(invalidSize), null);

    const invalidVersion = validManifest();
    invalidVersion.manifestVersion = Number.NaN;
    assertEquals(parseReleaseAssetManifest(invalidVersion), null);

    const invalidBasePath = {
      ...validManifest(),
      assetBasePath: "/attacker-controlled",
    };
    assertEquals(parseReleaseAssetManifest(invalidBasePath), null);
  });

  it("rejects dangling route references and non-canonical module keys", () => {
    const danglingModule = validManifest();
    danglingModule.routes["/"]!.modules.push("pages/missing.tsx");
    assertEquals(parseReleaseAssetManifest(danglingModule), null);

    const danglingCss = validManifest();
    danglingCss.routes["/"]!.css.push("c".repeat(64));
    assertEquals(parseReleaseAssetManifest(danglingCss), null);

    const traversalKey = validManifest();
    traversalKey.modules["pages/../secret.tsx"] = traversalKey.modules["pages/index.tsx"]!;
    assertEquals(parseReleaseAssetManifest(traversalKey), null);
  });

  it("returns an immutable snapshot instead of aliasing fetched data", () => {
    const manifest = validManifest();
    const parsed = parseReleaseAssetManifest(manifest);
    assertExists(parsed);

    manifest.modules["pages/index.tsx"]!.contentHash = "e".repeat(64);
    manifest.routes["/"]!.modules.push("pages/other.tsx");

    assertEquals(parsed.modules["pages/index.tsx"]?.contentHash, "a".repeat(64));
    assertEquals(parsed.routes["/"]?.modules, ["pages/index.tsx"]);
    assert(Object.isFrozen(parsed));
    assert(Object.isFrozen(parsed.modules));
    assert(Object.isFrozen(parsed.modules["pages/index.tsx"]));
    assert(Object.isFrozen(parsed.routes["/"]?.modules));
  });

  it("keeps both validators aligned on bounded strict input", () => {
    const manifest = validManifest();
    manifest.projectId = "";
    assertEquals(getReleaseAssetManifestSchema().safeParse(manifest).success, false);
    assertEquals(parseReleaseAssetManifest(manifest), null);

    const extraField = { ...validManifest(), unexpected: true };
    assertEquals(getReleaseAssetManifestSchema().safeParse(extraField).success, false);
    assertEquals(parseReleaseAssetManifest(extraField), null);
  });

  it("never throws for hostile object input", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    assertEquals(parseReleaseAssetManifest(hostile), null);
  });

  it("rejects non-object input", () => {
    assertEquals(parseReleaseAssetManifest(null), null);
    assertEquals(parseReleaseAssetManifest("nope"), null);
    assertEquals(parseReleaseAssetManifest(42), null);
  });
});
