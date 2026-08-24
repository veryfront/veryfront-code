import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getBundleManifestStore,
  InMemoryBundleManifestStore,
  setBundleManifestStore,
} from "./bundle-manifest.ts";
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
  it("installs a freshly created store on the default production path", async () => {
    const previous = getBundleManifestStore();
    const sentinel = new InMemoryBundleManifestStore();
    setBundleManifestStore(sentinel);

    try {
      await initializeBundleManifest({}, "production");

      assertEquals(
        getBundleManifestStore() === sentinel,
        false,
        "initialize must install a freshly created store",
      );
      assertEquals(
        getBundleManifestStore() instanceof InMemoryBundleManifestStore,
        true,
        "the default production backend is the in-memory store",
      );
    } finally {
      setBundleManifestStore(previous);
    }
  });

  it("installs a freshly created store when the bundle manifest is disabled", async () => {
    const previous = getBundleManifestStore();
    const sentinel = new InMemoryBundleManifestStore();
    setBundleManifestStore(sentinel);

    try {
      await initializeBundleManifest(
        { cache: { bundleManifest: { enabled: false } } },
        "development",
      );

      assertEquals(
        getBundleManifestStore() === sentinel,
        false,
        "the disabled path must install a freshly created store",
      );
      assertEquals(
        getBundleManifestStore() instanceof InMemoryBundleManifestStore,
        true,
        "the disabled path installs the in-memory store",
      );
    } finally {
      setBundleManifestStore(previous);
    }
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
