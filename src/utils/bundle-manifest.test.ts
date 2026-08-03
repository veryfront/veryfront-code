import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { FakeTime } from "#std/testing/time";
import { scaleMs } from "#veryfront/testing/timing.ts";
import {
  BUNDLE_MANIFEST_SWEEP_INTERVAL_MS,
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

  it("snapshots bundle code on write and read", async () => {
    const store = new InMemoryBundleManifestStore();
    const code: BundleCode = {
      code: "export default 'original'",
      sourceMap: "original-map",
      css: ".original {}",
    };

    await store.setBundleCode("code-hash", code);
    code.code = "export default 'mutated input'";

    const firstRead = await store.getBundleCode("code-hash");
    assertExists(firstRead);
    assertEquals(firstRead.code, "export default 'original'");
    firstRead.code = "export default 'mutated output'";

    assertEquals(await store.getBundleCode("code-hash"), {
      code: "export default 'original'",
      sourceMap: "original-map",
      css: ".original {}",
    });
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

    await store.deleteBundle("second");
    assertEquals(await store.getBundleCode("shared-code"), undefined);
  });

  it("retains shared code across partial source invalidation", async () => {
    const store = new InMemoryBundleManifestStore();
    const sharedCode: BundleCode = { code: "export default 1" };
    const metadata: BundleMetadata = {
      hash: "hash",
      codeHash: "shared-code",
      size: 10,
      compiledAt: Date.now(),
      source: "first.mdx",
      mode: "development",
    };

    await store.setBundleCode(metadata.codeHash, sharedCode);
    await store.setBundleMetadata("first-a", metadata);
    await store.setBundleMetadata("first-b", { ...metadata, hash: "hash-b" });
    await store.setBundleMetadata("second", { ...metadata, source: "second.mdx" });

    assertEquals(await store.invalidateSource("first.mdx"), 2);
    assertEquals(await store.getBundleCode(metadata.codeHash), sharedCode);

    assertEquals(await store.invalidateSource("second.mdx"), 1);
    assertEquals(await store.getBundleCode(metadata.codeHash), undefined);
  });

  it("transfers code references when metadata is replaced", async () => {
    const store = new InMemoryBundleManifestStore();
    const originalCode: BundleCode = { code: "export default 'original'" };
    const replacementCode: BundleCode = { code: "export default 'replacement'" };
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

    await store.setBundleCode(original.codeHash, originalCode);
    await store.setBundleCode(replacement.codeHash, replacementCode);
    await store.setBundleMetadata("replaced", original);
    await store.setBundleMetadata("remaining-original", {
      ...original,
      source: "remaining.mdx",
    });
    await store.setBundleMetadata("replaced", replacement);

    assertEquals(await store.getBundleCode(original.codeHash), originalCode);
    assertEquals(await store.getBundleCode(replacement.codeHash), replacementCode);

    await store.deleteBundle("remaining-original");
    assertEquals(await store.getBundleCode(original.codeHash), undefined);
    assertEquals(await store.getBundleCode(replacement.codeHash), replacementCode);

    await store.deleteBundle("replaced");
    assertEquals(await store.getBundleCode(replacement.codeHash), undefined);
  });

  it("does not double-count an unchanged key and code hash", async () => {
    const store = new InMemoryBundleManifestStore();
    const code: BundleCode = { code: "export default true" };
    const metadata: BundleMetadata = {
      hash: "hash",
      codeHash: "code",
      size: 10,
      compiledAt: Date.now(),
      source: "source.mdx",
      mode: "development",
    };

    await store.setBundleCode(metadata.codeHash, code);
    await store.setBundleMetadata("key", metadata);
    await store.setBundleMetadata("key", { ...metadata, hash: "updated-hash" });
    await store.deleteBundle("key");

    assertEquals(await store.getBundleCode(metadata.codeHash), undefined);
  });

  it("snapshots metadata supplied by callers", async () => {
    const store = new InMemoryBundleManifestStore();
    const code: BundleCode = { code: "export default true" };
    const metadata: BundleMetadata = {
      hash: "original-hash",
      codeHash: "original-code",
      size: 10,
      compiledAt: Date.now(),
      source: "original.mdx",
      mode: "development",
      meta: {
        type: "mdx",
        headings: [{ id: "original", text: "Original", level: 1 }],
      },
    };

    await store.setBundleCode(metadata.codeHash, code);
    await store.setBundleMetadata("key", metadata);

    metadata.codeHash = "mutated-code";
    metadata.source = "mutated.mdx";
    const suppliedHeading = metadata.meta?.headings?.[0];
    assertExists(suppliedHeading);
    suppliedHeading.text = "Mutated";

    const stored = await store.getBundleMetadata("key");
    assertEquals(stored?.codeHash, "original-code");
    assertEquals(stored?.source, "original.mdx");
    assertEquals(stored?.meta?.headings?.[0]?.text, "Original");

    await store.deleteBundle("key");
    assertEquals(await store.getBundleCode("original-code"), undefined);
    assertEquals(await store.invalidateSource("original.mdx"), 0);
  });

  it("does not expose indexed metadata records to callers", async () => {
    const store = new InMemoryBundleManifestStore();
    const first: BundleMetadata = {
      hash: "first-hash",
      codeHash: "first-code",
      size: 10,
      compiledAt: Date.now(),
      source: "first.mdx",
      mode: "development",
      meta: {
        type: "mdx",
        headings: [{ id: "first", text: "First", level: 1 }],
      },
    };
    const second: BundleMetadata = {
      ...first,
      hash: "second-hash",
      codeHash: "second-code",
      source: "second.mdx",
    };

    await store.setBundleCode(first.codeHash, { code: "export default 1" });
    await store.setBundleCode(second.codeHash, { code: "export default 2" });
    await store.setBundleMetadata("first", first);
    await store.setBundleMetadata("second", second);

    const exposed = await store.getBundleMetadata("first");
    assertExists(exposed);
    exposed.codeHash = second.codeHash;
    exposed.source = second.source;
    const exposedHeading = exposed.meta?.headings?.[0];
    assertExists(exposedHeading);
    exposedHeading.text = "Mutated";

    const stored = await store.getBundleMetadata("first");
    assertEquals(stored?.codeHash, first.codeHash);
    assertEquals(stored?.source, first.source);
    assertEquals(stored?.meta?.headings?.[0]?.text, "First");

    await store.deleteBundle("first");
    assertEquals(await store.getBundleCode(first.codeHash), undefined);
    assertEquals(await store.getBundleCode(second.codeHash), { code: "export default 2" });
    assertEquals(await store.invalidateSource(first.source), 0);
    assertEquals(await store.getBundleMetadata("second"), second);
  });

  it("releases code and source references when metadata expires", async () => {
    using time = new FakeTime();
    const store = new InMemoryBundleManifestStore();
    const code: BundleCode = { code: "export default true" };
    const metadata: BundleMetadata = {
      hash: "hash",
      codeHash: "code",
      size: 10,
      compiledAt: Date.now(),
      source: "source.mdx",
      mode: "development",
    };

    await store.setBundleCode(metadata.codeHash, code);
    await store.setBundleMetadata("key", metadata, 10);
    await time.tickAsync(11);

    assertEquals(await store.getBundleMetadata("key"), undefined);
    assertEquals(await store.getBundleCode(metadata.codeHash), undefined);
    assertEquals(await store.invalidateSource(metadata.source), 0);
  });

  it("keeps referenced code alive past a shorter code ttl", async () => {
    using time = new FakeTime();
    const store = new InMemoryBundleManifestStore();
    const code: BundleCode = { code: "export default true" };
    const metadata: BundleMetadata = {
      hash: "hash",
      codeHash: "code",
      size: 10,
      compiledAt: Date.now(),
      source: "source.mdx",
      mode: "development",
    };

    await store.setBundleCode(metadata.codeHash, code, 10);
    await store.setBundleMetadata("key", metadata, 100);
    await time.tickAsync(10);

    assertEquals(await store.getBundleCode(metadata.codeHash), code);
    await store.deleteBundle("key");
    assertEquals(await store.getBundleCode(metadata.codeHash), undefined);
  });

  it("does not expose stored bundle code records to caller mutation", async () => {
    const store = new InMemoryBundleManifestStore();
    const code: BundleCode = {
      code: "export default 'original'",
      css: ".original { color: red; }",
      sourceMap: "{}",
    };

    await store.setBundleCode("code", code);
    code.code = "export default 'mutated after set'";
    code.css = ".mutated { color: blue; }";

    const firstRead = await store.getBundleCode("code");
    assertEquals(firstRead, {
      code: "export default 'original'",
      css: ".original { color: red; }",
      sourceMap: "{}",
    });

    assertExists(firstRead);
    firstRead.code = "export default 'mutated after read'";
    firstRead.sourceMap = "mutated";

    assertEquals(await store.getBundleCode("code"), {
      code: "export default 'original'",
      css: ".original { color: red; }",
      sourceMap: "{}",
    });
  });

  it("prunes unread expired metadata before resolving referenced code", async () => {
    using time = new FakeTime();
    const store = new InMemoryBundleManifestStore();
    const metadata: BundleMetadata = {
      hash: "hash",
      codeHash: "code",
      size: 10,
      compiledAt: Date.now(),
      source: "source.mdx",
      mode: "development",
    };

    await store.setBundleCode(metadata.codeHash, { code: "export default true" });
    await store.setBundleMetadata("key", metadata, 10);
    await time.tickAsync(10);

    assertEquals(await store.getBundleCode(metadata.codeHash), undefined);
    assertEquals(await store.invalidateSource(metadata.source), 0);
    assertEquals((await store.getStats()).totalBundles, 0);
  });

  it("excludes expired metadata from stats without a pruning sweep", async () => {
    using time = new FakeTime();
    const store = new InMemoryBundleManifestStore();
    const now = Date.now();
    const expiring: BundleMetadata = {
      hash: "expiring-hash",
      codeHash: "expiring-code",
      size: 100,
      compiledAt: now - 1000,
      source: "expiring.mdx",
      mode: "development",
    };
    const durable: BundleMetadata = {
      hash: "durable-hash",
      codeHash: "durable-code",
      size: 50,
      compiledAt: now,
      source: "durable.mdx",
      mode: "development",
    };

    await store.setBundleCode(expiring.codeHash, { code: "export default 1" }, 10);
    await store.setBundleMetadata("expiring", expiring, 10);
    await store.setBundleMetadata("durable", durable);
    await time.tickAsync(10);

    const stats = await store.getStats();
    assertEquals(stats.totalBundles, 1);
    assertEquals(stats.totalSize, durable.size);
    assertEquals(stats.oldestBundle, durable.compiledAt);
    assertEquals(stats.newestBundle, durable.compiledAt);

    // The expired entry was excluded from the view, never served, and its
    // code is not resolvable either.
    assertEquals(await store.getBundleMetadata("expiring"), undefined);
    assertEquals(await store.getBundleCode(expiring.codeHash), undefined);
    assertEquals(await store.getBundleMetadata("durable"), durable);
  });

  it("sweeps unread expired metadata on writes after the sweep interval", async () => {
    using time = new FakeTime();
    const store = new InMemoryBundleManifestStore();
    const stale: BundleMetadata = {
      hash: "stale-hash",
      codeHash: "stale-code",
      size: 10,
      compiledAt: Date.now(),
      source: "stale.mdx",
      mode: "development",
    };

    await store.setBundleMetadata("stale", stale, 10);
    await time.tickAsync(BUNDLE_MANIFEST_SWEEP_INTERVAL_MS + 1);

    // An unrelated write amortizes the full sweep; the expired entry must be
    // gone from the source index without ever having been read.
    await store.setBundleMetadata("fresh", { ...stale, hash: "fresh-hash", source: "fresh.mdx" });

    assertEquals(await store.invalidateSource(stale.source), 0);
    assertEquals((await store.getStats()).totalBundles, 1);
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

  it("clear resets code reference counts", async () => {
    const store = new InMemoryBundleManifestStore();
    const code: BundleCode = { code: "export default true" };
    const metadata: BundleMetadata = {
      hash: "hash",
      codeHash: "shared-code",
      size: 10,
      compiledAt: Date.now(),
      source: "source.mdx",
      mode: "development",
    };

    await store.setBundleMetadata("first", metadata);
    await store.setBundleMetadata("second", { ...metadata, source: "second.mdx" });
    await store.clear();

    await store.setBundleCode(metadata.codeHash, code);
    await store.setBundleMetadata("after-clear", metadata);
    await store.deleteBundle("after-clear");

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
