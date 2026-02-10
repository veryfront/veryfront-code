import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";
import {
  type BundleCode,
  type BundleMetadata,
  computeCodeHash,
  computeHash,
  InMemoryBundleManifestStore,
} from "./bundle-manifest.ts";

describe("InMemoryBundleManifestStore", () => {
  it("basic operations", async () => {
    const store = new InMemoryBundleManifestStore();

    const metadata: BundleMetadata = {
      hash: "test-hash",
      codeHash: "code-hash-1",
      size: 1024,
      compiledAt: Date.now(),
      source: "test.mdx",
      mode: "development",
      meta: { type: "mdx" },
    };

    const code: BundleCode = {
      code: 'export default function Test() { return "Hello"; }',
    };

    await store.setBundleMetadata("test-key", metadata);
    await store.setBundleCode(metadata.codeHash, code);

    const retrievedMetadata = await store.getBundleMetadata("test-key");
    assertExists(retrievedMetadata);
    assertEquals(retrievedMetadata.hash, metadata.hash);
    assertEquals(retrievedMetadata.codeHash, metadata.codeHash);

    const retrievedCode = await store.getBundleCode(metadata.codeHash);
    assertExists(retrievedCode);
    assertEquals(retrievedCode.code, code.code);

    assertEquals(await store.isAvailable(), true);
  });

  it("TTL expiration", async () => {
    const store = new InMemoryBundleManifestStore();

    const metadata: BundleMetadata = {
      hash: "test-hash",
      codeHash: "code-hash-2",
      size: 1024,
      compiledAt: Date.now(),
      source: "test.mdx",
      mode: "development",
    };

    await store.setBundleMetadata("test-key", metadata, scaleMs(100));

    assertExists(await store.getBundleMetadata("test-key"));

    await delay(150);

    assertEquals(await store.getBundleMetadata("test-key"), undefined);
  });

  it("source indexing", async () => {
    const store = new InMemoryBundleManifestStore();

    const metadata1: BundleMetadata = {
      hash: "hash-1",
      codeHash: "code-1",
      size: 1024,
      compiledAt: Date.now(),
      source: "test.mdx",
      mode: "development",
    };

    const metadata2: BundleMetadata = {
      hash: "hash-2",
      codeHash: "code-2",
      size: 2048,
      compiledAt: Date.now(),
      source: "test.mdx",
      mode: "development",
    };

    await store.setBundleMetadata("key-1", metadata1);
    await store.setBundleMetadata("key-2", metadata2);

    assertEquals(await store.invalidateSource("test.mdx"), 2);

    assertEquals(await store.getBundleMetadata("key-1"), undefined);
    assertEquals(await store.getBundleMetadata("key-2"), undefined);
  });

  it("delete bundle", async () => {
    const store = new InMemoryBundleManifestStore();

    const metadata: BundleMetadata = {
      hash: "test-hash",
      codeHash: "code-hash-3",
      size: 1024,
      compiledAt: Date.now(),
      source: "test.mdx",
      mode: "development",
    };

    const code: BundleCode = {
      code: 'export default function Test() { return "Hello"; }',
    };

    await store.setBundleMetadata("test-key", metadata);
    await store.setBundleCode(metadata.codeHash, code);

    await store.deleteBundle("test-key");

    assertEquals(await store.getBundleMetadata("test-key"), undefined);
    assertEquals(await store.getBundleCode(metadata.codeHash), undefined);
  });

  it("clear all", async () => {
    const store = new InMemoryBundleManifestStore();

    const metadata: BundleMetadata = {
      hash: "test-hash",
      codeHash: "code-hash-4",
      size: 1024,
      compiledAt: Date.now(),
      source: "test.mdx",
      mode: "development",
    };

    await store.setBundleMetadata("test-key", metadata);
    await store.setBundleCode(metadata.codeHash, { code: "test" });

    await store.clear();

    assertEquals(await store.getBundleMetadata("test-key"), undefined);
    assertEquals(await store.getBundleCode(metadata.codeHash), undefined);
  });

  it("statistics", async () => {
    const store = new InMemoryBundleManifestStore();
    const now = Date.now();

    const metadata1: BundleMetadata = {
      hash: "hash-1",
      codeHash: "code-1",
      size: 1024,
      compiledAt: now - 1000,
      source: "test1.mdx",
      mode: "development",
    };

    const metadata2: BundleMetadata = {
      hash: "hash-2",
      codeHash: "code-2",
      size: 2048,
      compiledAt: now,
      source: "test2.mdx",
      mode: "production",
    };

    await store.setBundleMetadata("key-1", metadata1);
    await store.setBundleMetadata("key-2", metadata2);

    const stats = await store.getStats();
    assertEquals(stats.totalBundles, 2);
    assertEquals(stats.totalSize, 3072);
    assertEquals(stats.oldestBundle, now - 1000);
    assertEquals(stats.newestBundle, now);
  });
});

describe("computeHash", () => {
  it("generates consistent hash", async () => {
    const content = "Hello, World!";
    const hash1 = await computeHash(content);
    const hash2 = await computeHash(content);

    assertEquals(hash1, hash2);
    assertEquals(hash1.length, 64);
  });
});

describe("computeCodeHash", () => {
  it("generates consistent hash", async () => {
    const code: BundleCode = {
      code: "export default function Test() {}",
      css: ".test { color: red; }",
    };

    const hash1 = await computeCodeHash(code);
    const hash2 = await computeCodeHash(code);

    assertEquals(hash1, hash2);
    assertEquals(hash1.length, 64);
  });

  it("different for different content", async () => {
    const code1: BundleCode = { code: "export default function Test1() {}" };
    const code2: BundleCode = { code: "export default function Test2() {}" };

    const hash1 = await computeCodeHash(code1);
    const hash2 = await computeCodeHash(code2);

    assertEquals(hash1 !== hash2, true);
  });
});
