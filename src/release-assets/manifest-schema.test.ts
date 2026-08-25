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

/**
 * A stored v1 body, shaped exactly as production holds it: `fallback` present,
 * `dependencyMode` absent, and a CSS entry whose `styleProfileHash` is the
 * legacy short token rather than a sha256.
 */
function legacyV1Manifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectId: "11111111-1111-1111-1111-111111111111",
    releaseId: "22222222-2222-2222-2222-222222222222",
    releaseVersion: 7,
    manifestVersion: 1,
    builderVersion: "0.1.841",
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
        styleProfileHash: "-4ij92d",
      },
    ],
    routes: {
      "/": { modules: ["pages/index.tsx"], css: ["b".repeat(64)] },
    },
    dependencies: {},
    fallback: { mode: "none", gaps: [] },
  };
}

const LEGACY = { acceptLegacyV1: true } as const;

describe("legacy v1 manifest consumption", () => {
  it("admits modules from a stored v1 body", () => {
    const manifest = parseReleaseAssetManifest(legacyV1Manifest(), LEGACY);
    assertExists(manifest);
    assertEquals(manifest.schemaVersion, RELEASE_ASSET_MANIFEST_SCHEMA_VERSION);
    assertEquals(manifest.modules["pages/index.tsx"]?.contentHash, "a".repeat(64));
    assertEquals(manifest.routes["/"]?.modules, ["pages/index.tsx"]);
  });

  it("drops legacy CSS rather than inventing v2 identities", () => {
    // v1 CSS carries no `cssPipelineIdentity` and a non-sha256 profile hash.
    // Synthesizing either would fabricate a cache-correctness key, so the
    // adapter reports no manifest CSS and the renderer keeps its own pipeline.
    const manifest = parseReleaseAssetManifest(legacyV1Manifest(), LEGACY);
    assertExists(manifest);
    assertEquals(manifest.css, []);
    assertEquals(manifest.routes["/"]?.css, []);
  });

  it("reports source dependency mode for a v1 body", () => {
    const manifest = parseReleaseAssetManifest(legacyV1Manifest(), LEGACY);
    assertExists(manifest);
    assertEquals(manifest.dependencyMode, "source");
  });

  it("applies v2 bounds to the adapted body", () => {
    const corruptModuleKey = legacyV1Manifest();
    corruptModuleKey.modules = {
      "../escape.tsx": { contentHash: "a".repeat(64), size: 1, contentType: "text/javascript" },
    };
    assertEquals(parseReleaseAssetManifest(corruptModuleKey, LEGACY), null);

    const danglingRoute = legacyV1Manifest();
    danglingRoute.routes = { "/": { modules: ["pages/missing.tsx"], css: [] } };
    assertEquals(parseReleaseAssetManifest(danglingRoute, LEGACY), null);
  });

  it("rejects a __proto__ route key instead of silently dropping it", () => {
    // Route keys are untrusted. The adapter accumulates them on a
    // null-prototype object so `__proto__` arrives at the validator as an
    // ordinary own property and is rejected for not being a canonical route
    // path. On a plain `{}` it would hit the prototype setter instead, which
    // swallows the key and reshapes the accumulator -- a different route to
    // the same rejection, but one that hides which key was at fault.
    const hostile = legacyV1Manifest();
    const routes: Record<string, unknown> = Object.create(null);
    routes["/"] = { modules: ["pages/index.tsx"], css: [] };
    routes["__proto__"] = { modules: ["pages/index.tsx"], css: [] };
    hostile.routes = routes;

    assertEquals(parseReleaseAssetManifest(hostile, LEGACY), null);
    // Pollution shows up as a property reachable from an unrelated object, not
    // as a changed prototype identity, so probe for the injected value itself.
    assertEquals(
      ({} as Record<string, unknown>).modules,
      undefined,
      "a route entry leaked onto Object.prototype while parsing",
    );
    assertEquals(
      ({} as Record<string, unknown>).css,
      undefined,
      "a route entry leaked onto Object.prototype while parsing",
    );
  });

  it("accepts a ready response carrying a v1 body", () => {
    const response = {
      state: "ready",
      manifest_version: 1,
      manifest: legacyV1Manifest(),
    };
    const parsed = parseReadyReleaseAssetManifestResponse(
      response,
      "22222222-2222-2222-2222-222222222222",
      LEGACY,
    );
    assertExists(parsed);
    assertEquals(parsed.manifest.modules["pages/index.tsx"]?.size, 1234);
  });

  it("keeps the strict validator v2-only so builds cannot emit v1", () => {
    assertEquals(getReleaseAssetManifestSchema().safeParse(legacyV1Manifest()).success, false);
  });

  it("rejects a v1 body unless the caller opts in", () => {
    // The default has to stay strict. Producer-side callers -- the build
    // executor verifying what it just emitted, the CLI waiting on a deploy --
    // rely on it to surface a builder/framework skew instead of absorbing it.
    assertEquals(parseReleaseAssetManifest(legacyV1Manifest()), null);
    assertEquals(
      parseReleaseAssetManifest(legacyV1Manifest(), { acceptLegacyV1: false }),
      null,
    );
    assertEquals(
      parseReadyReleaseAssetManifestResponse(
        { state: "ready", manifest_version: 1, manifest: legacyV1Manifest() },
        "22222222-2222-2222-2222-222222222222",
      ),
      null,
    );
  });
});

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

    for (const state of ["building", "partial", "failed", "superseded", "", "READY"]) {
      assertEquals(
        parseReadyReleaseAssetManifestResponse(
          { state, manifest_version: manifest.manifestVersion, manifest },
          manifest.releaseId,
        ),
        null,
        `a ${state || "(empty)"} envelope must not parse as ready`,
      );
    }
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

    for (const builderVersion of ["0.1.765\u0000", "0.1.765\r\nX-Injected: 1"]) {
      const ctrl = validManifest();
      ctrl.builderVersion = builderVersion;
      assertEquals(
        parseReleaseAssetManifest(ctrl),
        null,
        "control characters must not pass builderVersion",
      );
      assertEquals(
        getReleaseAssetManifestSchema().safeParse(ctrl).success,
        false,
        "the zod validator must reject a control character in builderVersion",
      );
    }

    const untrimmed = validManifest();
    untrimmed.projectId = " 11111111-1111-1111-1111-111111111111 ";
    assertEquals(
      parseReleaseAssetManifest(untrimmed),
      null,
      "identifiers must be trimmed",
    );
    assertEquals(
      getReleaseAssetManifestSchema().safeParse(untrimmed).success,
      false,
      "identifiers must be trimmed",
    );
  });

  it("never throws for hostile object input", () => {
    const hostile = new Proxy({}, {
      ownKeys() {
        throw new Error("hostile ownKeys");
      },
    });
    assertEquals(parseReleaseAssetManifest(hostile, LEGACY), null);
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

  it("does not call a malformed v1 body a skew for a caller that reads v1", () => {
    // A runtime read accepts v1, so a v1 body that still fails is corrupt.
    // Reporting skew would send operators to upgrade the builder for something
    // an upgrade cannot fix.
    const reason = describeReadyReleaseAssetManifestRejection(
      { state: "ready", manifest_version: 1, manifest: { schemaVersion: 1, releaseId: "r1" } },
      "r1",
      { acceptLegacyV1: true },
    );

    assertEquals(reason, "the manifest body did not match the expected schema");
  });

  it("still names a skew for a version no caller reads", () => {
    const reason = describeReadyReleaseAssetManifestRejection(
      { state: "ready", manifest_version: 1, manifest: { schemaVersion: 3, releaseId: "r1" } },
      "r1",
      { acceptLegacyV1: true },
    );

    assertStringIncludes(reason, "schema version 3");
    assertStringIncludes(reason, `versions 1 and ${RELEASE_ASSET_MANIFEST_SCHEMA_VERSION}`);
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

    const m = validManifest();
    assertStringIncludes(
      describeReadyReleaseAssetManifestRejection(
        { state: "ready", manifest_version: m.manifestVersion, manifest: m },
        "33333333-3333-3333-3333-333333333333",
      ),
      "identifies a different release",
      "a release-identity mismatch must be named, not reported as unrecognized",
    );
    assertStringIncludes(
      describeReadyReleaseAssetManifestRejection(
        { state: "ready", manifest_version: m.manifestVersion + 1, manifest: m },
        m.releaseId,
      ),
      "disagree on the manifest version",
      "an envelope/body version disagreement must be named",
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
