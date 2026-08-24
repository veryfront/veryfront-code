import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { API_CACHE_KEY_MAX_LENGTH, isValidCacheKey, isValidCachePattern } from "./api-policy.ts";
import { sanitizeCacheKey } from "./utils.ts";
import {
  buildPreparedProjectCSSCacheKey,
  buildPreparedProjectCSSCacheScopePrefix,
  buildProjectCSSCacheKey,
  buildProjectCSSCacheScopePrefix,
  decodePreparedProjectCSSCacheKey,
  decodeProjectCSSCacheKey,
} from "./project-css.ts";

const STYLESHEET_HASH = "a".repeat(64);
const CANDIDATES_HASH = "b".repeat(64);
const PROFILE_HASH = "c".repeat(64);

function buildKey(projectScope: string, environment = "preview"): string {
  return buildProjectCSSCacheKey({
    projectScope,
    environment,
    stylesheetHash: STYLESHEET_HASH,
    candidatesHash: CANDIDATES_HASH,
    profileHash: PROFILE_HASH,
  });
}

describe("project CSS cache key codec", () => {
  it("emits a literal-safe framed identity and decodes the exact raw fields", () => {
    const key = buildKey("*");

    assertEquals(buildProjectCSSCacheScopePrefix("*"), "v5:s_002a_:");
    assertEquals(
      key,
      `v5:s_002a_:spreview_:${STYLESHEET_HASH}:${CANDIDATES_HASH}:${PROFILE_HASH}`,
    );
    assertEquals(decodeProjectCSSCacheKey(key), {
      projectScope: "*",
      environment: "preview",
    });
  });

  it("keeps reserved sanitizer-marker suffixes directly addressable", async () => {
    for (
      const [projectScope, environment] of [
        ["tenant-vf-sanitized", "preview"],
        ["tenant", "preview-vf-sanitized"],
      ] as const
    ) {
      const physicalKey = `project-css:${buildKey(projectScope, environment)}`;

      assertEquals(physicalKey.includes("vf-sanitized:"), false);
      assertEquals(await sanitizeCacheKey(physicalKey), physicalKey);
    }
  });

  it("round-trips arbitrary JavaScript scope strings without aliases", () => {
    const scopes = [
      "?",
      "tenant:branch",
      "Malmö/東京",
      "\ud800",
      "\udc00",
      "�",
      "\\ud800",
    ];
    const keys = scopes.map((projectScope) => buildKey(projectScope, "custom:*:environment"));

    assertEquals(new Set(keys).size, scopes.length);
    assertEquals(
      keys.map((key) => decodeProjectCSSCacheKey(key)),
      scopes.map((projectScope) => ({
        projectScope,
        environment: "custom:*:environment",
      })),
    );
    assertEquals(
      keys.every((key) => `project-css:${key}`.length <= API_CACHE_KEY_MAX_LENGTH),
      true,
    );
  });

  it("keeps a maximum canonical project slug addressable through the API backend", () => {
    const projectScope = "a".repeat(256);
    const key = buildKey(projectScope);
    const invalidationPattern = `project-css:${buildProjectCSSCacheScopePrefix(projectScope)}*`;

    assertEquals(isValidCacheKey(`project-css:${key}`), true);
    assertEquals(isValidCachePattern(invalidationPattern), true);
  });

  it("rejects oversized construction and malformed or non-canonical identities", () => {
    assertThrows(
      () => buildKey("x".repeat(API_CACHE_KEY_MAX_LENGTH)),
      RangeError,
      `${API_CACHE_KEY_MAX_LENGTH} characters`,
    );
    assertThrows(
      () =>
        buildProjectCSSCacheKey({
          projectScope: "project",
          environment: "preview",
          stylesheetHash: "not-a-digest",
          candidatesHash: CANDIDATES_HASH,
          profileHash: PROFILE_HASH,
        }),
      TypeError,
      "stylesheet hash",
    );

    const suffix = `:spreview_:${STYLESHEET_HASH}:${CANDIDATES_HASH}:${PROFILE_HASH}`;
    for (
      const malformed of [
        `v4:s_002a_${suffix}`,
        `v5:*${suffix}`,
        `v5:s_0061_${suffix}`,
        `v5:s_002a_${suffix}:extra`,
        `v5:s_002a_:spreview_:short:${CANDIDATES_HASH}:${PROFILE_HASH}`,
        `v5:s_002a_:spreview_:${STYLESHEET_HASH}:short:${PROFILE_HASH}`,
        `v5:s_002a_:spreview_:${STYLESHEET_HASH}:${CANDIDATES_HASH}:${"A".repeat(64)}`,
      ]
    ) {
      assertEquals(
        decodeProjectCSSCacheKey(malformed),
        null,
        "decodeProjectCSSCacheKey must reject any key buildProjectCSSCacheKey could not have emitted",
      );
    }
    assertEquals(
      Reflect.apply(decodeProjectCSSCacheKey, undefined, [undefined]),
      null,
    );
  });
});

describe("prepared project CSS cache key codec", () => {
  it("emits one bounded identity digest and decodes exact raw ownership", () => {
    const identityHash = "d".repeat(64);
    const key = buildPreparedProjectCSSCacheKey({
      projectScope: "*",
      environment: "preview-vf-sanitized",
      identityHash,
    });

    assertEquals(buildPreparedProjectCSSCacheScopePrefix("*"), "v5:s_002a_:");
    assertEquals(key, `v5:s_002a_:spreview-vf-sanitized_:${identityHash}`);
    assertEquals(decodePreparedProjectCSSCacheKey(key), {
      projectScope: "*",
      environment: "preview-vf-sanitized",
    });
    assertEquals(isValidCacheKey(`prepared-project-css:${key}`), true);
  });

  it("rejects retired, malformed, non-canonical, and non-string identities", () => {
    const digest = "d".repeat(64);
    for (
      const malformed of [
        `v4:sproject_:spreview_:${digest}`,
        `v5:sproject:spreview_:${digest}`,
        `v5:s_0070roject_:spreview_:${digest}`,
        `v5:sproject_:spreview_:short`,
        `v5:sproject_:spreview_:${digest}:extra`,
      ]
    ) {
      assertEquals(decodePreparedProjectCSSCacheKey(malformed), null);
    }
    assertEquals(
      Reflect.apply(decodePreparedProjectCSSCacheKey, undefined, [undefined]),
      null,
    );
  });
});
