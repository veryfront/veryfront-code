import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
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

function createMetadata(id: string, codeHash = `code-${id}`): BundleMetadata {
  return {
    hash: `hash-${id}`,
    codeHash,
    size: id.length,
    compiledAt: id.length,
    source: `${id}.mdx`,
    mode: "development",
  };
}

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

  it("removes a replaced key from its previous source index", async () => {
    const store = new InMemoryBundleManifestStore();
    const original: BundleMetadata = {
      hash: "hash-original",
      codeHash: "code-original",
      size: 10,
      compiledAt: Date.now(),
      source: "original.mdx",
      mode: "development",
    };
    const replacement: BundleMetadata = {
      ...original,
      hash: "hash-replacement",
      codeHash: "code-replacement",
      source: "replacement.mdx",
    };

    await store.setBundleMetadata("shared-key", original);
    await store.setBundleMetadata("shared-key", replacement);

    assertEquals(await store.invalidateSource("original.mdx"), 0);
    assertEquals(await store.getBundleMetadata("shared-key"), replacement);
  });

  it("snapshots metadata on write and returns detached reads", async () => {
    const store = new InMemoryBundleManifestStore();
    const metadata: BundleMetadata = {
      hash: "hash-original",
      codeHash: "code-original",
      size: 10,
      compiledAt: 123,
      source: "original.mdx",
      scope: "project-a",
      mode: "development",
      meta: {
        type: "mdx",
        headings: [{ id: "heading", text: "Original", level: 1 }],
      },
    };
    await store.setBundleCode("code-original", { code: "export default 1" });
    await store.setBundleMetadata("key", metadata);

    metadata.codeHash = "code-mutated-before-read";
    metadata.source = "mutated-before-read.mdx";
    metadata.meta!.type = "component";
    metadata.meta!.headings![0]!.text = "Mutated before read";

    const firstRead = await store.getBundleMetadata("key");
    assertExists(firstRead);
    assertEquals(firstRead.codeHash, "code-original");
    assertEquals(firstRead.source, "original.mdx");
    assertEquals(firstRead.meta, {
      type: "mdx",
      headings: [{ id: "heading", text: "Original", level: 1 }],
    });

    firstRead.codeHash = "code-mutated-after-read";
    firstRead.source = "mutated-after-read.mdx";
    firstRead.meta!.headings![0]!.text = "Mutated after read";

    const secondRead = await store.getBundleMetadata("key");
    assertExists(secondRead);
    assertEquals(secondRead.codeHash, "code-original");
    assertEquals(secondRead.source, "original.mdx");
    assertEquals(secondRead.meta?.headings?.[0]?.text, "Original");

    assertEquals(await store.invalidateSource("original.mdx", "project-a"), 1);
    assertEquals(await store.getBundleMetadata("key"), undefined);
    assertEquals(await store.getBundleCode("code-original"), undefined);
  });

  it("snapshots shared bundle code and detaches reads until the final reference is removed", async () => {
    const store = new InMemoryBundleManifestStore();
    const sharedCode: BundleCode = {
      code: "export default 'original'",
      sourceMap: "original-map",
      css: ".original {}",
    };

    await store.setBundleCode("shared-code", sharedCode);
    await store.setBundleMetadata("first", createMetadata("first", "shared-code"));
    await store.setBundleMetadata("second", createMetadata("second", "shared-code"));

    sharedCode.code = "export default 'mutated-input'";
    sharedCode.sourceMap = "mutated-input-map";
    sharedCode.css = ".mutated-input {}";

    const firstRead = await store.getBundleCode("shared-code");
    assertExists(firstRead);
    assertEquals(firstRead, {
      code: "export default 'original'",
      sourceMap: "original-map",
      css: ".original {}",
    });

    firstRead.code = "export default 'mutated-read'";
    firstRead.sourceMap = "mutated-read-map";
    firstRead.css = ".mutated-read {}";

    await store.deleteBundle("first");
    assertEquals(await store.getBundleCode("shared-code"), {
      code: "export default 'original'",
      sourceMap: "original-map",
      css: ".original {}",
    });

    await store.deleteBundle("second");
    assertEquals(await store.getBundleCode("shared-code"), undefined);
  });

  it("does not delete code that is still referenced by another bundle", async () => {
    const store = new InMemoryBundleManifestStore();
    const sharedCode: BundleCode = { code: "export default 1" };
    const first: BundleMetadata = {
      hash: "hash-first",
      codeHash: "shared-code",
      size: 10,
      compiledAt: Date.now(),
      source: "first.mdx",
      mode: "development",
    };
    const second: BundleMetadata = {
      ...first,
      hash: "hash-second",
      source: "second.mdx",
    };

    await store.setBundleMetadata("first", first);
    await store.setBundleMetadata("second", second);
    await store.setBundleCode("shared-code", sharedCode);
    await store.deleteBundle("first");

    assertEquals(await store.getBundleMetadata("second"), second);
    assertEquals(await store.getBundleCode("shared-code"), sharedCode);
  });

  it("does not shorten shared code retention when a later scope uses a shorter TTL", async () => {
    let now = 0;
    const store = new InMemoryBundleManifestStore({ now: () => now });
    const code = { code: "export default 'shared'" };

    await store.setBundleCode("shared-code", code, 100);
    await store.setBundleMetadata("long-scope", createMetadata("long", "shared-code"), 100);

    now = 10;
    await store.setBundleCode("shared-code", code, 5);
    await store.setBundleMetadata("short-scope", createMetadata("short", "shared-code"), 5);

    now = 16;
    assertEquals(await store.getBundleMetadata("short-scope"), undefined);
    assertExists(await store.getBundleMetadata("long-scope"));
    assertEquals(await store.getBundleCode("shared-code"), code);

    now = 100;
    assertEquals(await store.getBundleMetadata("long-scope"), undefined);
    assertEquals(await store.getBundleCode("shared-code"), undefined);
  });

  it("excludes expired bundles from source invalidation and statistics", async () => {
    const store = new InMemoryBundleManifestStore();
    const metadata: BundleMetadata = {
      hash: "hash-expiring",
      codeHash: "code-expiring",
      size: 10,
      compiledAt: Date.now(),
      source: "expiring.mdx",
      mode: "development",
    };

    await store.setBundleMetadata("expiring", metadata, 1);
    await delay(10);

    assertEquals(await store.invalidateSource("expiring.mdx"), 0);
    assertEquals(await store.getStats(), {
      totalBundles: 0,
      totalSize: 0,
      oldestBundle: undefined,
      newestBundle: undefined,
    });
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

  it("evicts metadata by deterministic least-recently-used order", async () => {
    const store = new InMemoryBundleManifestStore({
      maxMetadataEntries: 2,
      maxCodeEntries: 10,
    });
    for (const id of ["a", "b"]) {
      await store.setBundleCode(`code-${id}`, { code: id });
      await store.setBundleMetadata(id, createMetadata(id));
    }
    await store.getBundleMetadata("a");
    await store.setBundleCode("code-c", { code: "c" });
    await store.setBundleMetadata("c", createMetadata("c"));

    assertExists(await store.getBundleMetadata("a"));
    assertEquals(await store.getBundleMetadata("b"), undefined);
    assertExists(await store.getBundleMetadata("c"));
    assertEquals(await store.getBundleCode("code-b"), undefined);
  });

  it("evicts code by deterministic LRU order and removes dependent metadata", async () => {
    const store = new InMemoryBundleManifestStore({
      maxMetadataEntries: 10,
      maxCodeEntries: 2,
    });
    for (const id of ["a", "b"]) {
      await store.setBundleCode(`code-${id}`, { code: id });
      await store.setBundleMetadata(id, createMetadata(id));
    }
    await store.getBundleCode("code-a");
    await store.setBundleCode("code-c", { code: "c" });
    await store.setBundleMetadata("c", createMetadata("c"));

    assertExists(await store.getBundleCode("code-a"));
    assertEquals(await store.getBundleCode("code-b"), undefined);
    assertEquals(await store.getBundleMetadata("b"), undefined);
    assertExists(await store.getBundleMetadata("c"));
  });

  it("sweeps expired metadata and code opportunistically with an injected clock", async () => {
    let now = 0;
    const store = new InMemoryBundleManifestStore({ now: () => now });
    await store.setBundleCode("code-old", { code: "old" }, 5);
    await store.setBundleMetadata("old", createMetadata("old", "code-old"), 5);

    now = 10;
    await store.setBundleCode("code-new", { code: "new" });
    await store.setBundleMetadata("new", createMetadata("new", "code-new"));

    assertEquals(await store.getBundleMetadata("old"), undefined);
    assertEquals(await store.getBundleCode("code-old"), undefined);
    assertEquals((await store.getStats()).totalBundles, 1);
  });

  it("treats a zero TTL as immediate expiry", async () => {
    const store = new InMemoryBundleManifestStore({ now: () => 100 });
    await store.setBundleCode("code-zero", { code: "zero" }, 0);
    await store.setBundleMetadata("zero", createMetadata("zero", "code-zero"), 0);

    assertEquals(await store.getBundleCode("code-zero"), undefined);
    assertEquals(await store.getBundleMetadata("zero"), undefined);
  });

  it("validates capacity and TTL options before mutating state", async () => {
    assertThrows(
      () => new InMemoryBundleManifestStore({ maxMetadataEntries: -1 }),
      RangeError,
      "maxMetadataEntries",
    );
    assertThrows(
      () => new InMemoryBundleManifestStore({ maxCodeEntries: 1.5 }),
      RangeError,
      "maxCodeEntries",
    );

    const store = new InMemoryBundleManifestStore();
    await assertRejects(
      () => store.setBundleCode("invalid", { code: "invalid" }, Number.POSITIVE_INFINITY),
      RangeError,
      "ttlMs",
    );
    assertEquals(await store.getBundleCode("invalid"), undefined);
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
