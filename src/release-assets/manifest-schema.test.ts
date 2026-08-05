import "#veryfront/schemas/_test-setup.ts";

import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  describeReadyReleaseAssetManifestRejection,
  getReleaseAssetManifestSchema,
  parseReadyReleaseAssetManifestResponse,
  parseReleaseAssetManifest,
  readMismatchedReleaseAssetManifestSchemaVersion,
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

describe("describeReadyReleaseAssetManifestRejection", () => {
  it("names a schema version skew and points at the framework, not a rebuild", () => {
    // The failure this exists for: assets built by an older framework declare an
    // older schema. The previous message ("invalid or mismatched ready manifest.
    // Rebuild the release assets") sent operators to rebuild against the same
    // mismatched builder, which cannot succeed.
    const reason = describeReadyReleaseAssetManifestRejection(
      { state: "ready", manifest_version: 1, manifest: { schemaVersion: 1, releaseId: "r1" } },
      "r1",
    );

    assertStringIncludes(reason, "schema version 1");
    assertStringIncludes(reason, `version ${RELEASE_ASSET_MANIFEST_SCHEMA_VERSION}`);
    assertStringIncludes(reason, "different framework version");
  });

  it("distinguishes the other rejection paths", () => {
    assertStringIncludes(
      describeReadyReleaseAssetManifestRejection("not-an-object", "r1"),
      "was not an object",
    );
    assertStringIncludes(
      describeReadyReleaseAssetManifestRejection({ state: "ready" }, "r1"),
      "no usable manifest_version",
    );
  });

  it("survives a hostile envelope instead of throwing while classifying", () => {
    // This runs inside the error path, to build a classified DEPLOYMENT_ERROR.
    // A throw here would surface as the unclassified error this diagnostic
    // exists to eliminate, so property reads must not be able to raise.
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error("hostile proxy");
      },
      ownKeys() {
        throw new Error("hostile proxy");
      },
      get() {
        throw new Error("hostile proxy");
      },
    });

    const reason = describeReadyReleaseAssetManifestRejection(hostile, "r1");
    assertEquals(typeof reason, "string");
    assertEquals(reason.length > 0, true);
  });

  it("reports a body that fails schema checks without echoing it", () => {
    const reason = describeReadyReleaseAssetManifestRejection(
      { state: "ready", manifest_version: 1, manifest: { secret: "do-not-echo" } },
      "r1",
    );

    assertStringIncludes(reason, "did not match the expected schema");
    assertEquals(reason.includes("do-not-echo"), false);
  });
});

describe("readMismatchedReleaseAssetManifestSchemaVersion", () => {
  it("reports the version a real v1 hosted build declares", () => {
    // Shape taken verbatim from a production asset-manifest response built by
    // framework 0.1.1162: `fallback` in place of `dependencyMode`, and a legacy
    // six-character styleProfileHash with no cssPipelineIdentity. Those CSS
    // identities cannot be reconstructed, which is why v1 stays unparseable.
    const legacyBody = {
      schemaVersion: 1,
      projectId: "bd80f018-d3e7-4bcd-ba86-76e70e75c641",
      releaseId: "43f1a553-9477-4b25-b5d9-5f154a142241",
      releaseVersion: 1,
      manifestVersion: 1,
      builderVersion: "0.1.1162",
      sourceContentHash: "4".repeat(64),
      createdAt: "2026-08-05T23:28:40.940Z",
      assetBasePath: "/_vf/assets",
      modules: {
        "app/page.tsx": { contentHash: "7".repeat(64), size: 505, contentType: "text/javascript" },
      },
      css: [{
        contentHash: "7".repeat(64),
        size: 68631,
        contentType: "text/css",
        styleProfileHash: "qpyvqf",
      }],
      routes: { "/": { modules: ["app/page.tsx"], css: ["7".repeat(64)] } },
      dependencies: {},
      fallback: { mode: "jit", gaps: [] },
    };

    assertEquals(parseReleaseAssetManifest(legacyBody), null);
    assertEquals(
      readMismatchedReleaseAssetManifestSchemaVersion({
        state: "ready",
        manifest_version: 1,
        manifest: legacyBody,
      }),
      1,
    );
  });

  it("reports a newer builder as the same condition", () => {
    // An older CLI against a newer platform is the mirror image of the same
    // skew. Treating only older bodies as skew would fail those deploys closed.
    assertEquals(
      readMismatchedReleaseAssetManifestSchemaVersion({
        state: "ready",
        manifest_version: 1,
        manifest: { schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION + 1 },
      }),
      RELEASE_ASSET_MANIFEST_SCHEMA_VERSION + 1,
    );
  });

  it("returns null for a body that parses at the current version", () => {
    assertEquals(
      readMismatchedReleaseAssetManifestSchemaVersion({
        state: "ready",
        manifest_version: validManifest().manifestVersion,
        manifest: validManifest(),
      }),
      null,
    );
  });

  it("returns null for corruption that is not a schema mismatch", () => {
    // Callers degrade on a mismatch and fail closed otherwise, so anything that
    // is merely malformed must not be reported as a version skew.
    for (
      const manifest of [
        { ...validManifest(), modules: "not-a-record" },
        { schemaVersion: RELEASE_ASSET_MANIFEST_SCHEMA_VERSION },
        { schemaVersion: "2" },
        { schemaVersion: 1.5 },
        { schemaVersion: -1 },
        { secret: "do-not-echo" },
        "not-an-object",
        null,
      ]
    ) {
      assertEquals(
        readMismatchedReleaseAssetManifestSchemaVersion({
          state: "ready",
          manifest_version: 1,
          manifest,
        }),
        null,
        `${JSON.stringify(manifest)?.slice(0, 40)} must not read as a schema skew`,
      );
    }
  });

  it("survives a hostile envelope instead of throwing", () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        throw new Error("hostile proxy");
      },
      ownKeys() {
        throw new Error("hostile proxy");
      },
      get() {
        throw new Error("hostile proxy");
      },
    });

    assertEquals(readMismatchedReleaseAssetManifestSchemaVersion(hostile), null);
  });
});
