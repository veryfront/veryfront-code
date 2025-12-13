
import { assertEquals, assertExists } from "std/assert/mod.ts";
import {
  type BundleMetadata,
  getBundleManifestStore,
  InMemoryBundleManifestStore,
  setBundleManifestStore,
} from "@veryfront/utils/bundle-manifest.ts";
import {
  getBundleManifestTTL,
  initializeBundleManifest,
} from "@veryfront/utils/bundle-manifest-init.ts";
import type { VeryfrontConfig } from "@veryfront/config";

Deno.test("initializeBundleManifest - defaults to in-memory", async () => {
  const config: VeryfrontConfig = {};

  await initializeBundleManifest(config, "development");

  const store = getBundleManifestStore();
  assertExists(store);
  assertEquals(store instanceof InMemoryBundleManifestStore, true);
});

Deno.test("initializeBundleManifest - respects config enabled flag", async () => {
  const config: VeryfrontConfig = {
    cache: {
      bundleManifest: {
        enabled: false,
      },
    },
  };

  await initializeBundleManifest(config, "production");

  const store = getBundleManifestStore();
  assertEquals(store instanceof InMemoryBundleManifestStore, true);
});

Deno.test("initializeBundleManifest - memory store", async () => {
  const config: VeryfrontConfig = {
    cache: {
      bundleManifest: {
        type: "memory",
        enabled: true,
      },
    },
  };

  await initializeBundleManifest(config, "production");

  const store = getBundleManifestStore();
  assertEquals(store instanceof InMemoryBundleManifestStore, true);
});

Deno.test("getBundleManifestTTL - returns config value", () => {
  const config: VeryfrontConfig = {
    cache: {
      bundleManifest: {
        ttl: 5000,
      },
    },
  };

  const ttl = getBundleManifestTTL(config, "production");
  assertEquals(ttl, 5000);
});

Deno.test("getBundleManifestTTL - defaults for production", () => {
  const config: VeryfrontConfig = {};

  const ttl = getBundleManifestTTL(config, "production");
  assertEquals(ttl, 7 * 24 * 60 * 60 * 1000);
});

Deno.test("getBundleManifestTTL - defaults for development", () => {
  const config: VeryfrontConfig = {};

  const ttl = getBundleManifestTTL(config, "development");
  assertEquals(ttl, 60 * 60 * 1000);
});

Deno.test("bundle manifest - cache hit scenario", async () => {
  const store = new InMemoryBundleManifestStore();
  setBundleManifestStore(store);

  const metadata: BundleMetadata = {
    hash: "content-hash-123",
    codeHash: "compiled-hash-456",
    size: 1024,
    compiledAt: Date.now(),
    source: "pages/test.mdx",
    mode: "production",
    meta: {
      type: "mdx",
      reactVersion: "18.2.0",
    },
  };

  const code = {
    code: 'export default function MDXContent() { return "Test"; }',
  };

  await store.setBundleMetadata("mdx:production:content-hash-123", metadata);
  await store.setBundleCode("compiled-hash-456", code);

  const cachedMetadata = await store.getBundleMetadata("mdx:production:content-hash-123");
  assertExists(cachedMetadata);
  assertEquals(cachedMetadata.codeHash, "compiled-hash-456");

  const cachedCode = await store.getBundleCode("compiled-hash-456");
  assertExists(cachedCode);
  assertEquals(cachedCode.code, code.code);
});

Deno.test("bundle manifest - source invalidation", async () => {
  const store = new InMemoryBundleManifestStore();
  setBundleManifestStore(store);

  const metadata1: BundleMetadata = {
    hash: "hash-1",
    codeHash: "code-1",
    size: 1024,
    compiledAt: Date.now(),
    source: "pages/blog.mdx",
    mode: "production",
  };

  const metadata2: BundleMetadata = {
    hash: "hash-2",
    codeHash: "code-2",
    size: 2048,
    compiledAt: Date.now(),
    source: "pages/blog.mdx",
    mode: "development",
  };

  await store.setBundleMetadata("key-1", metadata1);
  await store.setBundleMetadata("key-2", metadata2);

  const count = await store.invalidateSource("pages/blog.mdx");
  assertEquals(count, 2);

  const check1 = await store.getBundleMetadata("key-1");
  const check2 = await store.getBundleMetadata("key-2");
  assertEquals(check1, undefined);
  assertEquals(check2, undefined);
});

Deno.test("bundle manifest - statistics tracking", async () => {
  const store = new InMemoryBundleManifestStore();
  setBundleManifestStore(store);

  const now = Date.now();

  for (let i = 0; i < 5; i++) {
    const metadata: BundleMetadata = {
      hash: `hash-${i}`,
      codeHash: `code-${i}`,
      size: 1024 * (i + 1),
      compiledAt: now - i * 1000,
      source: `pages/test${i}.mdx`,
      mode: "production",
    };
    await store.setBundleMetadata(`key-${i}`, metadata);
  }

  const stats = await store.getStats();
  assertEquals(stats.totalBundles, 5);
  assertEquals(stats.totalSize, 1024 + 2048 + 3072 + 4096 + 5120);
  assertEquals(stats.oldestBundle, now - 4000);
  assertEquals(stats.newestBundle, now);
});

Deno.test("bundle manifest - handles missing bundles gracefully", async () => {
  const store = new InMemoryBundleManifestStore();
  setBundleManifestStore(store);

  const metadata = await store.getBundleMetadata("nonexistent-key");
  assertEquals(metadata, undefined);

  const code = await store.getBundleCode("nonexistent-hash");
  assertEquals(code, undefined);
});

Deno.test("bundle manifest - concurrent access", async () => {
  const store = new InMemoryBundleManifestStore();
  setBundleManifestStore(store);

  const metadata: BundleMetadata = {
    hash: "concurrent-hash",
    codeHash: "concurrent-code",
    size: 1024,
    compiledAt: Date.now(),
    source: "test.mdx",
    mode: "production",
  };

  await Promise.all([
    store.setBundleMetadata("key-1", metadata),
    store.setBundleMetadata("key-2", metadata),
    store.setBundleMetadata("key-3", metadata),
  ]);

  const results = await Promise.all([
    store.getBundleMetadata("key-1"),
    store.getBundleMetadata("key-2"),
    store.getBundleMetadata("key-3"),
  ]);

  assertEquals(results.length, 3);
  results.forEach((result: BundleMetadata | undefined) => {
    assertExists(result);
    assertEquals(result.hash, "concurrent-hash");
  });
});
