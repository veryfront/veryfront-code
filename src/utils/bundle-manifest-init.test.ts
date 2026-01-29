import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getBundleManifestTTL } from "./bundle-manifest-init.ts";
import { BUNDLE_MANIFEST_DEV_TTL_MS, BUNDLE_MANIFEST_PROD_TTL_MS } from "./constants/cache.ts";

describe("getBundleManifestTTL", () => {
  it("should return production TTL for production mode when no config TTL", () => {
    const config = {} as Parameters<typeof getBundleManifestTTL>[0];
    const result = getBundleManifestTTL(config, "production");
    assertEquals(result, BUNDLE_MANIFEST_PROD_TTL_MS);
  });

  it("should return development TTL for development mode when no config TTL", () => {
    const config = {} as Parameters<typeof getBundleManifestTTL>[0];
    const result = getBundleManifestTTL(config, "development");
    assertEquals(result, BUNDLE_MANIFEST_DEV_TTL_MS);
  });

  it("should return config TTL when provided for production", () => {
    const config = {
      cache: { bundleManifest: { ttl: 5000 } },
    } as Parameters<typeof getBundleManifestTTL>[0];
    const result = getBundleManifestTTL(config, "production");
    assertEquals(result, 5000);
  });

  it("should return config TTL when provided for development", () => {
    const config = {
      cache: { bundleManifest: { ttl: 3000 } },
    } as Parameters<typeof getBundleManifestTTL>[0];
    const result = getBundleManifestTTL(config, "development");
    assertEquals(result, 3000);
  });

  it("should use mode-based default when cache config exists but no ttl", () => {
    const config = {
      cache: { bundleManifest: { enabled: true } },
    } as Parameters<typeof getBundleManifestTTL>[0];
    const result = getBundleManifestTTL(config, "production");
    assertEquals(result, BUNDLE_MANIFEST_PROD_TTL_MS);
  });

  it("should distinguish production and development default TTLs", () => {
    const config = {} as Parameters<typeof getBundleManifestTTL>[0];
    const prodTTL = getBundleManifestTTL(config, "production");
    const devTTL = getBundleManifestTTL(config, "development");
    assertEquals(prodTTL > devTTL, true);
  });
});
