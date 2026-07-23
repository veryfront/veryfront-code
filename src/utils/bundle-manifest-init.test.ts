import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getBundleManifestStore } from "./bundle-manifest.ts";
import { getBundleManifestTTL, initializeBundleManifest } from "./bundle-manifest-init.ts";
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

describe("initializeBundleManifest", () => {
  it("defaults to a disabled store in development", async () => {
    await initializeBundleManifest({}, "development");

    assertEquals(await getBundleManifestStore().isAvailable(), false);
  });

  it("defaults to an in-memory store in production", async () => {
    await initializeBundleManifest({}, "production");

    assertEquals(await getBundleManifestStore().isAvailable(), true);
  });

  it("rejects unknown backend config instead of silently using memory", async () => {
    await assertRejects(
      () =>
        initializeBundleManifest(
          { cache: { bundleManifest: { enabled: true, type: "unknown" } } },
          "production",
        ),
      Error,
      "Unsupported bundle manifest store type",
    );
  });

  it("installs a no-op store when bundle manifests are disabled", async () => {
    await initializeBundleManifest(
      { cache: { bundleManifest: { enabled: false } } },
      "production",
    );
    const store = getBundleManifestStore();

    await store.setBundleCode("code", { code: "compiled" });
    await store.setBundleMetadata("key", {
      hash: "hash",
      codeHash: "code",
      size: 8,
      compiledAt: Date.now(),
      source: "source.mdx",
      mode: "production",
    });

    assertEquals(await store.isAvailable(), false);
    assertEquals(await store.getBundleMetadata("key"), undefined);
    assertEquals(await store.getBundleCode("code"), undefined);
    assertEquals(await store.getStats(), { totalBundles: 0, totalSize: 0 });
  });

  it("rejects explicit redis backend config instead of silently falling back to memory", async () => {
    await assertRejects(
      () =>
        initializeBundleManifest(
          { cache: { bundleManifest: { enabled: true, type: "redis" } } },
          "production",
        ),
      Error,
      'Bundle manifest store type "redis" is configured but is not implemented',
    );
  });

  it("rejects explicit kv backend config instead of silently falling back to memory", async () => {
    await assertRejects(
      () =>
        initializeBundleManifest(
          { cache: { bundleManifest: { enabled: true, type: "kv" } } },
          "production",
        ),
      Error,
      'Bundle manifest store type "kv" is configured but is not implemented',
    );
  });
});
