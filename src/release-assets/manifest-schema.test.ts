import "#veryfront/schemas/_test-setup.ts";

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getReleaseAssetManifestSchema,
  parseReadyReleaseAssetManifestResponse,
  parseReleaseAssetManifest,
  type ReleaseAssetManifest,
} from "./manifest-schema.ts";
import { RELEASE_ASSET_MANIFEST_SCHEMA_VERSION } from "./constants.ts";

const STYLE_PROFILE_HASH = "c".repeat(64);
const CSS_PIPELINE_IDENTITY = "test-css-pipeline@1";

function validManifest(): ReleaseAssetManifest {
  return {
    schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
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
        styleProfileHash: STYLE_PROFILE_HASH,
        cssPipelineIdentity: CSS_PIPELINE_IDENTITY,
      },
    ],
    routes: {
      "/": { modules: ["pages/index.tsx"], css: ["b".repeat(64)] },
    },
    dependencyMode: "immutable",
    dependencies: {},
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

  it("requires an explicit dependency capability mode in both validators", () => {
    const sourceManifest = validManifest();
    sourceManifest.dependencyMode = "source";
    assertEquals(getReleaseAssetManifestSchema().safeParse(sourceManifest).success, true);
    assertEquals(parseReleaseAssetManifest(sourceManifest)?.dependencyMode, "source");

    const missingMode = validManifest() as unknown as Record<string, unknown>;
    delete missingMode.dependencyMode;
    assertEquals(getReleaseAssetManifestSchema().safeParse(missingMode).success, false);
    assertEquals(parseReleaseAssetManifest(missingMode), null);

    const invalidMode = {
      ...validManifest(),
      dependencyMode: "fallback",
    };
    assertEquals(getReleaseAssetManifestSchema().safeParse(invalidMode).success, false);
    assertEquals(parseReleaseAssetManifest(invalidMode), null);
  });

  it("accepts a generation-matched ready response", () => {
    const manifest = validManifest();
    const parsed = parseReadyReleaseAssetManifestResponse(
      {
        state: "ready",
        manifest_version: manifest.manifestVersion,
        manifest,
      },
      manifest.releaseId,
    );

    assertExists(parsed);
    assertEquals(parsed.state, "ready");
    assertEquals(parsed.manifest_version, manifest.manifestVersion);
    assertEquals(parsed.manifest, manifest);
  });

  it("rejects missing or mismatched response manifest versions", () => {
    const manifest = validManifest();
    assertEquals(
      parseReadyReleaseAssetManifestResponse(
        { state: "ready", manifest },
        manifest.releaseId,
      ),
      null,
    );
    assertEquals(
      parseReadyReleaseAssetManifestResponse(
        {
          state: "ready",
          manifest_version: manifest.manifestVersion + 1,
          manifest,
        },
        manifest.releaseId,
      ),
      null,
    );
  });

  it("rejects a manifest body for a different release", () => {
    const manifest = validManifest();
    assertEquals(
      parseReadyReleaseAssetManifestResponse(
        {
          state: "ready",
          manifest_version: manifest.manifestVersion,
          manifest,
        },
        "33333333-3333-3333-3333-333333333333",
      ),
      null,
    );
  });

  it("rejects accessor-backed response envelopes without executing accessors", () => {
    let accessorCalls = 0;

    for (const accessorKey of ["state", "manifest_version", "manifest"] as const) {
      const manifest = validManifest();
      const envelope: Record<string, unknown> = {
        state: "ready",
        manifest_version: manifest.manifestVersion,
        manifest,
      };
      const accessorValue = envelope[accessorKey];
      Object.defineProperty(envelope, accessorKey, {
        enumerable: true,
        get() {
          accessorCalls++;
          return accessorValue;
        },
      });

      assertEquals(
        parseReadyReleaseAssetManifestResponse(envelope, manifest.releaseId),
        null,
      );
    }

    assertEquals(accessorCalls, 0);
  });

  it("rejects a legacy schema version in both validators", () => {
    const manifest = { ...validManifest(), schemaVersion: 1 };
    assertEquals(getReleaseAssetManifestSchema().safeParse(manifest).success, false);
    assertEquals(parseReleaseAssetManifest(manifest), null);
  });

  it("requires canonical CSS profile and pipeline identities", () => {
    const missingPipeline = validManifest() as unknown as {
      css: Array<Record<string, unknown>>;
    };
    delete missingPipeline.css[0]?.cssPipelineIdentity;
    assertEquals(getReleaseAssetManifestSchema().safeParse(missingPipeline).success, false);
    assertEquals(parseReleaseAssetManifest(missingPipeline), null);

    const nullProfile = validManifest() as unknown as {
      css: Array<Record<string, unknown>>;
    };
    nullProfile.css[0]!.styleProfileHash = null;
    assertEquals(getReleaseAssetManifestSchema().safeParse(nullProfile).success, false);
    assertEquals(parseReleaseAssetManifest(nullProfile), null);

    const shortProfile = validManifest() as unknown as {
      css: Array<Record<string, unknown>>;
    };
    shortProfile.css[0]!.styleProfileHash = "profile-1";
    assertEquals(getReleaseAssetManifestSchema().safeParse(shortProfile).success, false);
    assertEquals(parseReleaseAssetManifest(shortProfile), null);

    const nonCanonicalPipeline = validManifest() as unknown as {
      css: Array<Record<string, unknown>>;
    };
    nonCanonicalPipeline.css[0]!.cssPipelineIdentity = " decomposed\nidentity ";
    assertEquals(getReleaseAssetManifestSchema().safeParse(nonCanonicalPipeline).success, false);
    assertEquals(parseReleaseAssetManifest(nonCanonicalPipeline), null);
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

  it("rejects multiple CSS assets because v2 defines one release-global stylesheet", () => {
    const manifest = validManifest();
    manifest.css.push({
      ...manifest.css[0]!,
      contentHash: "c".repeat(64),
    });
    manifest.routes["/"]!.css.push("c".repeat(64));

    assertEquals(getReleaseAssetManifestSchema().safeParse(manifest).success, false);
    assertEquals(parseReleaseAssetManifest(manifest), null);
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

  it("rejects accessor-backed input without executing accessors", () => {
    let accessorCalls = 0;
    const topLevelAccessor = validManifest();
    Object.defineProperty(topLevelAccessor, "schemaVersion", {
      enumerable: true,
      get() {
        accessorCalls++;
        return RELEASE_ASSET_MANIFEST_SCHEMA_VERSION;
      },
    });
    assertEquals(parseReleaseAssetManifest(topLevelAccessor), null);

    const dependencyModeAccessor = validManifest();
    Object.defineProperty(dependencyModeAccessor, "dependencyMode", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "immutable";
      },
    });
    assertEquals(parseReleaseAssetManifest(dependencyModeAccessor), null);

    const nestedAccessor = validManifest();
    Object.defineProperty(nestedAccessor.modules["pages/index.tsx"]!, "contentHash", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "a".repeat(64);
      },
    });
    assertEquals(parseReleaseAssetManifest(nestedAccessor), null);

    const arrayAccessor = validManifest();
    const cssEntry = arrayAccessor.css[0]!;
    Object.defineProperty(arrayAccessor.css, 0, {
      enumerable: true,
      get() {
        accessorCalls++;
        return cssEntry;
      },
    });
    assertEquals(parseReleaseAssetManifest(arrayAccessor), null);
    assertEquals(accessorCalls, 0);
  });

  it("rejects non-object input", () => {
    assertEquals(parseReleaseAssetManifest(null), null);
    assertEquals(parseReleaseAssetManifest("nope"), null);
    assertEquals(parseReleaseAssetManifest(42), null);
  });
});
