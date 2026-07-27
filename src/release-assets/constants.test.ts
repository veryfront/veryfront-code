import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST,
  RELEASE_ASSET_CONTENT_TYPES,
  RELEASE_ASSET_MANIFEST_LIMITS,
  releaseAssetUrl,
} from "./constants.ts";

describe("release asset constants", () => {
  it("builds URLs only from canonical content identities", () => {
    const hash = "a".repeat(64);
    assertEquals(releaseAssetUrl(hash, "js"), `/_vf/assets/${hash}.js`);
    assertThrows(() => releaseAssetUrl("../asset", "js"));
    assertThrows(() => releaseAssetUrl(hash, "map" as "js"));
  });

  it("does not expose mutable content-type policy", () => {
    assertEquals(Object.isFrozen(RELEASE_ASSET_CONTENT_TYPES), true);
    assertEquals(Object.isFrozen(RELEASE_ASSET_CONTENT_TYPE_ALLOWLIST), true);
    assertEquals(Object.isFrozen(RELEASE_ASSET_MANIFEST_LIMITS), true);
  });
});
