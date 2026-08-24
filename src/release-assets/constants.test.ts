import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_MANIFEST_LIMITS,
  RELEASE_ASSET_MANIFEST_SCHEMA_VERSION,
  releaseAssetUrl,
} from "./constants.ts";

describe("release asset constants", () => {
  it("builds URLs only from canonical content identities", () => {
    const hash = "a".repeat(64);
    assertEquals(releaseAssetUrl(hash, "js"), `/_vf/assets/${hash}.js`);
    assertThrows(() => releaseAssetUrl("../asset", "js"), TypeError, "64 lowercase hexadecimal");
    // Near misses: only exactly 64 lowercase hex characters is an identity.
    assertThrows(
      () => releaseAssetUrl("A".repeat(64), "js"),
      TypeError,
      "64 lowercase hexadecimal",
    );
    assertThrows(
      () => releaseAssetUrl("a".repeat(63), "js"),
      TypeError,
      "64 lowercase hexadecimal",
    );
    assertThrows(
      () => releaseAssetUrl("a".repeat(65), "js"),
      TypeError,
      "64 lowercase hexadecimal",
    );
    assertThrows(() => releaseAssetUrl(hash, "map" as "js"));
  });

  it("does not expose mutable content-type policy", () => {
    assertEquals(Object.isFrozen(RELEASE_ASSET_CONTENT_TYPES), true);
    assertEquals(Object.isFrozen(RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST), true);
    assertEquals(Object.isFrozen(RELEASE_ASSET_MANIFEST_LIMITS), true);
  });

  it("publishes the strict CSS identity manifest version and bounds", () => {
    assertEquals(RELEASE_ASSET_MANIFEST_SCHEMA_VERSION, 2);
    assertEquals(RELEASE_ASSET_MANIFEST_LIMITS.styleProfileHashLength, 64);
    assertEquals(RELEASE_ASSET_MANIFEST_LIMITS.cssPipelineIdentityLength, 2_048);
  });
});
