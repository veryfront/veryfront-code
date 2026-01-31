import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getBundleManifestTTL } from "./bundle-manifest-init.ts";
import { BUNDLE_MANIFEST_DEV_TTL_MS, BUNDLE_MANIFEST_PROD_TTL_MS } from "./constants/cache.ts";

describe("getBundleManifestTTL", () => {
  it("should return production TTL for production mode when no config TTL", () => {
    const result = getBundleManifestTTL({}, "production");
    assertEquals(result, BUNDLE_MANIFEST_PROD_TTL_MS);
  });

  it("should return development TTL for development mode when no config TTL", () => {
    const result = getBundleManifestTTL({}, "development");
    assertEquals(result, BUNDLE_MANIFEST_DEV_TTL_MS);
  });

  it("should return config TTL when provided for production", () => {
    const result = getBundleManifestTTL({ cache: { bundleManifest: { ttl: 5000 } } }, "production");
    assertEquals(result, 5000);
  });

  it("should return config TTL when provided for development", () => {
    const result = getBundleManifestTTL(
      { cache: { bundleManifest: { ttl: 3000 } } },
      "development",
    );
    assertEquals(result, 3000);
  });

  it("should use mode-based default when cache config exists but no ttl", () => {
    const result = getBundleManifestTTL(
      { cache: { bundleManifest: { enabled: true } } },
      "production",
    );
    assertEquals(result, BUNDLE_MANIFEST_PROD_TTL_MS);
  });

  it("should distinguish production and development default TTLs", () => {
    const prodTTL = getBundleManifestTTL({}, "production");
    const devTTL = getBundleManifestTTL({}, "development");
    assertExists(prodTTL);
    assertExists(devTTL);
    assertEquals(prodTTL > devTTL, true);
  });
});
