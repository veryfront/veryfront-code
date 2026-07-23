import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { delay } from "#std/async.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import {
  cloneMDXCompilationResult,
  MDXCacheAdapter,
  type MDXCompilationResult,
} from "./mdx-cache-adapter.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  type BundleManifestStore,
  InMemoryBundleManifestStore,
  setBundleManifestStore,
} from "#veryfront/utils/bundle-manifest.ts";
import {
  register as registerContract,
  tryResolve as tryResolveContract,
  unregister as unregisterContract,
} from "#veryfront/extensions/contracts.ts";
import type { ContentProcessor } from "#veryfront/extensions/content/index.ts";

describe("MDXCacheAdapter", () => {
  let adapter: MDXCacheAdapter;
  let manifestStore: BundleManifestStore;
  let previousProcessor: ContentProcessor | undefined;

  const testConfig: VeryfrontConfig = {
    cache: {
      bundleManifest: {
        enabled: true,
        type: "memory",
        ttl: 60000,
      },
    },
  };

  function createBundle(
    overrides: Partial<MDXCompilationResult> = {},
  ): MDXCompilationResult {
    return {
      compiledCode: "export default function() {}",
      frontmatter: {},
      headings: [],
      nodeMap: new Map<number, unknown>(),
      ...overrides,
    };
  }

  function storeProxy(overrides: Partial<BundleManifestStore>): BundleManifestStore {
    return new Proxy(manifestStore, {
      get(target, property) {
        const override = overrides[property as keyof BundleManifestStore];
        if (override !== undefined) return override;
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  beforeEach(() => {
    previousProcessor = tryResolveContract<ContentProcessor>("ContentProcessor");
    registerContract<ContentProcessor>("ContentProcessor", {
      cacheIdentity: "test-content-processor@1",
      resultIsolation: "structured-clone",
      compileMdx: () => Promise.reject(new Error("not used by cache adapter tests")),
      compileMarkdown: () => Promise.reject(new Error("not used by cache adapter tests")),
      getRemarkPlugins: () => [],
      getRehypePlugins: () => [],
    });
    manifestStore = new InMemoryBundleManifestStore();
    setBundleManifestStore(manifestStore);

    adapter = new MDXCacheAdapter({
      config: testConfig,
      mode: "development",
    });
  });

  afterEach(async () => {
    await manifestStore.clear();
    if (previousProcessor) registerContract("ContentProcessor", previousProcessor);
    else unregisterContract("ContentProcessor");
  });

  describe("Content Hash Computation", () => {
    it("should compute consistent hash for same content", async () => {
      const content = "# Hello World\n\nThis is a test.";
      const hash1 = await adapter.computeHash(content);
      const hash2 = await adapter.computeHash(content);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should compute different hash for different content", async () => {
      const hash1 = await adapter.computeHash("# Hello World");
      const hash2 = await adapter.computeHash("# Goodbye World");

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty content", async () => {
      const hash = await adapter.computeHash("");

      expect(hash).toBeTruthy();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("should handle unicode content", async () => {
      const hash = await adapter.computeHash("# 你好世界 🌍");

      expect(hash).toBeTruthy();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("rejects sparse frontmatter identities instead of colliding with dense arrays", async () => {
      const sparse = new Array(2);
      sparse[1] = "x";

      await assertRejects(
        () => adapter.computeCompilationIdentity("# Sparse", { values: sparse }),
        TypeError,
        "Sparse arrays",
      );
      const dense = await adapter.computeCompilationIdentity("# Sparse", { values: ["x"] });
      expect(dense).toBeTruthy();
    });

    it("rejects accessors and excessive depth without executing user code", async () => {
      let getterCalls = 0;
      const frontmatter: Record<string, unknown> = {};
      Object.defineProperty(frontmatter, "secret", {
        enumerable: true,
        get() {
          getterCalls++;
          return "unsafe";
        },
      });

      await assertRejects(
        () => adapter.computeCompilationIdentity("# Getter", frontmatter),
        TypeError,
        "accessor properties",
      );
      assertEquals(getterCalls, 0);

      let nested: Record<string, unknown> = {};
      const root = nested;
      for (let index = 0; index < 66; index++) {
        const child: Record<string, unknown> = {};
        nested.child = child;
        nested = child;
      }
      await assertRejects(
        () => adapter.computeCompilationIdentity("# Deep", root),
        TypeError,
        "deeply nested",
      );
    });

    it("requires a stable identity from the resolved content processor", async () => {
      registerContract(
        "ContentProcessor",
        {
          compileMdx: () => Promise.reject(new Error("not used")),
          compileMarkdown: () => Promise.reject(new Error("not used")),
          getRemarkPlugins: () => [],
          getRehypePlugins: () => [],
        } satisfies ContentProcessor,
      );

      await assertRejects(
        () => adapter.computeCompilationIdentity("# No identity"),
        TypeError,
        "cacheIdentity",
      );
    });
  });

  describe("Cache Hit/Miss", () => {
    const testContent = "# Test Page\n\nThis is test content.";
    const testBundle = createBundle({
      compiledCode: "export default function MDXContent() { return null; }",
      frontmatter: { title: "Test Page" },
    });

    it("should return undefined on cache miss", async () => {
      const result = await adapter.getCachedBundle(testContent);
      expect(result).toBeUndefined();
    });

    it("should return cached bundle on cache hit", async () => {
      await adapter.setCachedBundle(testContent, testBundle, "test.mdx");

      const cached = await adapter.getCachedBundle(testContent, undefined, "test.mdx");

      expect(cached).toBeDefined();
      expect(cached?.compiledCode).toBe(testBundle.compiledCode);
      expect(cached?.frontmatter).toEqual(testBundle.frontmatter);
    });

    it("rejects mismatched metadata and tampered executable code", async () => {
      const source = "integrity.mdx";
      await adapter.setCachedBundle(testContent, testBundle, source);
      const cacheKey = await adapter.computeCompilationIdentity(
        testContent,
        undefined,
        source,
      );
      const metadata = await manifestStore.getBundleMetadata(cacheKey);
      expect(metadata).toBeDefined();

      setBundleManifestStore(storeProxy({
        getBundleMetadata: () => Promise.resolve({ ...metadata!, hash: "0".repeat(64) }),
      }));
      expect(await adapter.getCachedBundle(testContent, undefined, source)).toBeUndefined();

      setBundleManifestStore(storeProxy({
        getBundleCode: () => Promise.resolve({ code: "export default 'tampered'" }),
      }));
      expect(await adapter.getCachedBundle(testContent, undefined, source)).toBeUndefined();
    });

    it("isolates entries by the live content processor identity", async () => {
      await adapter.setCachedBundle(testContent, testBundle, "provider.mdx");
      registerContract<ContentProcessor>("ContentProcessor", {
        cacheIdentity: "test-content-processor@2",
        resultIsolation: "structured-clone",
        compileMdx: () => Promise.reject(new Error("not used")),
        compileMarkdown: () => Promise.reject(new Error("not used")),
        getRemarkPlugins: () => [],
        getRehypePlugins: () => [],
      });

      expect(
        await adapter.getCachedBundle(testContent, undefined, "provider.mdx"),
      ).toBeUndefined();
    });

    it("does not persist invalid or unbounded compilation metadata", async () => {
      await adapter.setCachedBundle(
        "# Invalid heading",
        createBundle({ headings: [{ id: "bad", text: "Bad", level: 7 }] }),
        "bad.mdx",
      );
      await adapter.setCachedBundle(
        "# Oversized heading",
        createBundle({
          headings: [{ id: "large", text: "x".repeat(64 * 1024 + 1), level: 1 }],
        }),
        "large.mdx",
      );

      expect((await adapter.getStats()).totalBundles).toBe(0);
    });

    it("fails closed when asked to detach opaque compilation values", () => {
      assertThrows(
        () =>
          cloneMDXCompilationResult(
            createBundle({ globals: { callback: () => "shared" } }),
          ),
        TypeError,
        "not safely cloneable",
      );
    });

    it("should preserve frontmatter on cache hit", async () => {
      const frontmatter = {
        title: "Custom Title",
        description: "Custom Description",
      };

      await adapter.setCachedBundle(
        testContent,
        createBundle({ ...testBundle, frontmatter }),
        "test.mdx",
        frontmatter,
      );
      const cached = await adapter.getCachedBundle(testContent, frontmatter, "test.mdx");

      expect(cached?.frontmatter).toEqual(frontmatter);
    });

    it("preserves and detaches all mutable compilation metadata on cache hits", async () => {
      const identityFrontmatter = { title: "Parity", tags: ["one"] };
      const bundle = createBundle({
        frontmatter: identityFrontmatter,
        globals: { settings: { theme: "dark" } },
        headings: [{ id: "parity", text: "Parity", level: 1 }],
        nodeMap: new Map([[7, { position: { line: 3 } }]]),
        rawHtml: "<h1>Parity</h1>",
      });

      await adapter.setCachedBundle("# Parity", bundle, "parity.md", identityFrontmatter);
      const first = await adapter.getCachedBundle(
        "# Parity",
        identityFrontmatter,
        "parity.md",
      );
      expect(first).toEqual(bundle);

      (first!.frontmatter!.tags as string[])[0] = "mutated";
      (first!.globals!.settings as { theme: string }).theme = "light";
      (first!.nodeMap!.get(7) as { position: { line: number } }).position.line = 99;
      first!.headings![0]!.text = "Mutated";

      const second = await adapter.getCachedBundle(
        "# Parity",
        identityFrontmatter,
        "parity.md",
      );
      expect(second).toEqual(bundle);
    });

    it("should handle cache miss with frontmatter", async () => {
      const result = await adapter.getCachedBundle(testContent, {
        title: "Custom Title",
      });
      expect(result).toBeUndefined();
    });

    it("should cache multiple different bundles", async () => {
      const content1 = "# Page 1";
      const content2 = "# Page 2";
      const bundle1 = { ...testBundle, compiledCode: "// Page 1" };
      const bundle2 = { ...testBundle, compiledCode: "// Page 2" };

      await adapter.setCachedBundle(content1, bundle1, "page1.mdx");
      await adapter.setCachedBundle(content2, bundle2, "page2.mdx");

      const cached1 = await adapter.getCachedBundle(content1, undefined, "page1.mdx");
      const cached2 = await adapter.getCachedBundle(content2, undefined, "page2.mdx");

      expect(cached1?.compiledCode).toBe("// Page 1");
      expect(cached2?.compiledCode).toBe("// Page 2");
    });

    it("isolates compilation-affecting frontmatter and Studio mode", async () => {
      const content = "# Variant";
      const filePath = "/project/content/variant.md";
      const prose = { prose: true };
      const raw = { prose: false };

      await adapter.setCachedBundle(
        content,
        createBundle({ compiledCode: "// prose" }),
        filePath,
        prose,
        false,
      );
      await adapter.setCachedBundle(
        content,
        createBundle({ compiledCode: "// raw studio" }),
        filePath,
        raw,
        true,
      );

      expect((await adapter.getCachedBundle(content, prose, filePath, false))?.compiledCode).toBe(
        "// prose",
      );
      expect((await adapter.getCachedBundle(content, raw, filePath, true))?.compiledCode).toBe(
        "// raw studio",
      );
      expect(await adapter.getCachedBundle(content, raw, filePath, false)).toBeUndefined();
    });

    it("should not cache bundle without compiled code", async () => {
      await adapter.setCachedBundle(
        testContent,
        createBundle({ compiledCode: "" }),
        "test.mdx",
      );

      const cached = await adapter.getCachedBundle(testContent, undefined, "test.mdx");
      expect(cached).toBeUndefined();
    });
  });

  describe("TTL Expiration", () => {
    it("should respect custom TTL configuration", async () => {
      const shortTTLConfig: VeryfrontConfig = {
        cache: {
          bundleManifest: {
            enabled: true,
            type: "memory",
            ttl: 100,
          },
        },
      };

      const shortAdapter = new MDXCacheAdapter({
        config: shortTTLConfig,
        mode: "development",
      });

      const content = "# Short TTL Test";
      await shortAdapter.setCachedBundle(content, createBundle(), "test.mdx");

      const cached1 = await shortAdapter.getCachedBundle(content, undefined, "test.mdx");
      expect(cached1).toBeDefined();

      await delay(150);

      const cached2 = await shortAdapter.getCachedBundle(content, undefined, "test.mdx");
      expect(cached2).toBeUndefined();
    });

    it("should use different TTL for production mode", async () => {
      const prodAdapter = new MDXCacheAdapter({
        config: testConfig,
        mode: "production",
      });

      const content = "# Production Test";
      await prodAdapter.setCachedBundle(content, createBundle(), "prod.mdx");

      const cached = await prodAdapter.getCachedBundle(content, undefined, "prod.mdx");
      expect(cached).toBeDefined();
    });
  });

  describe("Cache Invalidation", () => {
    const testContent = "# Test Content";
    const testBundle = createBundle();

    it("should invalidate specific bundle by content", async () => {
      await adapter.setCachedBundle(testContent, testBundle, "test.mdx");

      expect(await adapter.getCachedBundle(testContent, undefined, "test.mdx")).toBeDefined();

      await adapter.invalidateBundle(testContent, undefined, "test.mdx");

      expect(await adapter.getCachedBundle(testContent, undefined, "test.mdx")).toBeUndefined();
    });

    it("should invalidate all bundles for a source file", async () => {
      const sourcePath = "/path/to/test.mdx";
      const bundle1 = { ...testBundle, compiledCode: "// v1" };
      const bundle2 = { ...testBundle, compiledCode: "// v2" };

      await adapter.setCachedBundle("# Version 1", bundle1, sourcePath);
      await adapter.setCachedBundle("# Version 2", bundle2, sourcePath);

      const count = await adapter.invalidateSource(sourcePath);
      expect(count).toBeGreaterThan(0);
    });

    it("should clear all cached bundles", async () => {
      await adapter.setCachedBundle("# Page 1", testBundle, "page1.mdx");
      await adapter.setCachedBundle("# Page 2", testBundle, "page2.mdx");
      await adapter.setCachedBundle("# Page 3", testBundle, "page3.mdx");

      expect((await adapter.getStats()).totalBundles).toBeGreaterThan(0);

      await adapter.clearAll();

      expect((await adapter.getStats()).totalBundles).toBe(0);
    });
  });

  describe("Statistics", () => {
    it("should report accurate cache statistics", async () => {
      const bundle = createBundle({
        compiledCode: "export default function() { return 'test'; }",
      });

      let stats = await adapter.getStats();
      expect(stats.totalBundles).toBe(0);
      expect(stats.totalSize).toBe(0);

      await adapter.setCachedBundle("# Page 1", bundle, "page1.mdx");
      await adapter.setCachedBundle("# Page 2", bundle, "page2.mdx");

      stats = await adapter.getStats();
      expect(stats.totalBundles).toBe(2);
      expect(stats.totalSize).toBeGreaterThan(0);
      expect(stats.oldestBundle).toBeDefined();
      expect(stats.newestBundle).toBeDefined();
    });

    it("should track bundle timestamps", async () => {
      const startTime = Date.now();

      await adapter.setCachedBundle("# Test", createBundle(), "test.mdx");

      const stats = await adapter.getStats();
      expect(stats.oldestBundle).toBeGreaterThanOrEqual(startTime);
      expect(stats.newestBundle).toBeGreaterThanOrEqual(startTime);
    });
  });

  describe("Error Handling", () => {
    it("should handle getCachedBundle errors gracefully", async () => {
      const failingStore: BundleManifestStore = {
        ...manifestStore,
        getBundleMetadata: () => Promise.reject(new Error("Storage error")),
      };
      setBundleManifestStore(failingStore);

      const result = await adapter.getCachedBundle("# Test");
      expect(result).toBeUndefined();
    });

    it("should handle setCachedBundle errors gracefully", async () => {
      const failingStore: BundleManifestStore = {
        ...manifestStore,
        setBundleCode: () => Promise.reject(new Error("Storage error")),
        setBundleMetadata: () => Promise.reject(new Error("Storage error")),
      };
      setBundleManifestStore(failingStore);

      await adapter.setCachedBundle("# Test", createBundle(), "test.mdx");
    });

    it("propagates destructive invalidation failures", async () => {
      const failingStore: BundleManifestStore = {
        ...manifestStore,
        capabilities: {
          scopedSourceInvalidation: true,
          prefixInvalidation: true,
          prefixStats: true,
        },
        deleteBundle: () => Promise.reject(new Error("Delete error")),
        invalidateSource: () => Promise.reject(new Error("Invalidate error")),
        invalidatePrefix: () => Promise.reject(new Error("Prefix error")),
      };
      setBundleManifestStore(failingStore);

      await assertRejects(() => adapter.invalidateBundle("# Test"), Error, "Delete error");
      await assertRejects(
        () => adapter.invalidateSource("/path/to/file"),
        Error,
        "Invalidate error",
      );

      const scoped = new MDXCacheAdapter({
        config: testConfig,
        mode: "development",
        scope: "project-a",
      });
      await assertRejects(() => scoped.clearAll(), Error, "Prefix error");
    });

    it("should handle getStats errors gracefully", async () => {
      const failingStore: BundleManifestStore = {
        ...manifestStore,
        getStats: () => Promise.reject(new Error("Stats error")),
      };
      setBundleManifestStore(failingStore);

      const stats = await adapter.getStats();
      expect(stats.totalBundles).toBe(0);
      expect(stats.totalSize).toBe(0);
    });
  });

  describe("Mode-Specific Behavior", () => {
    it("should use development mode cache key", async () => {
      const devAdapter = new MDXCacheAdapter({
        config: testConfig,
        mode: "development",
      });

      const content = "# Dev Test";
      await devAdapter.computeHash(content);

      await devAdapter.setCachedBundle(content, createBundle(), "dev.mdx");
      expect(await devAdapter.getCachedBundle(content, undefined, "dev.mdx")).toBeDefined();
    });

    it("should use production mode cache key", async () => {
      const prodAdapter = new MDXCacheAdapter({
        config: testConfig,
        mode: "production",
      });

      const content = "# Prod Test";
      await prodAdapter.setCachedBundle(content, createBundle(), "prod.mdx");

      expect(await prodAdapter.getCachedBundle(content, undefined, "prod.mdx")).toBeDefined();
    });

    it("should not share cache between modes", async () => {
      const devAdapter = new MDXCacheAdapter({
        config: testConfig,
        mode: "development",
      });

      const prodAdapter = new MDXCacheAdapter({
        config: testConfig,
        mode: "production",
      });

      const content = "# Shared Content";
      await devAdapter.setCachedBundle(content, createBundle(), "test.mdx");

      expect(await prodAdapter.getCachedBundle(content, undefined, "test.mdx")).toBeUndefined();
      expect(await devAdapter.getCachedBundle(content, undefined, "test.mdx")).toBeDefined();
    });
  });

  describe("Project Scope Isolation", () => {
    it("isolates identical content compiled from different file locations", async () => {
      const scoped = new MDXCacheAdapter({
        config: testConfig,
        mode: "production",
        scope: "project-a:release-1",
      });
      const content = "import X from './widget.ts';\n<X />";
      const firstPath = "/project/pages/a/index.mdx";
      const secondPath = "/project/pages/b/index.mdx";

      await scoped.setCachedBundle(
        content,
        createBundle({ compiledCode: "// compiled-a" }),
        firstPath,
      );
      await scoped.setCachedBundle(
        content,
        createBundle({ compiledCode: "// compiled-b" }),
        secondPath,
      );

      expect((await scoped.getCachedBundle(content, undefined, firstPath))?.compiledCode).toBe(
        "// compiled-a",
      );
      expect((await scoped.getCachedBundle(content, undefined, secondPath))?.compiledCode).toBe(
        "// compiled-b",
      );
      expect((await scoped.getStats()).totalBundles).toBe(2);
    });

    it("isolates cache entries and source invalidation for identical project content", async () => {
      const first = new MDXCacheAdapter({
        config: testConfig,
        mode: "production",
        scope: "project-a:release-1",
      });
      const second = new MDXCacheAdapter({
        config: testConfig,
        mode: "production",
        scope: "project-b:release-1",
      });
      const content = "# Shared source";
      const source = "/content/index.mdx";

      await first.setCachedBundle(
        content,
        createBundle({ compiledCode: "export default 'project-a'" }),
        source,
      );
      await second.setCachedBundle(
        content,
        createBundle({ compiledCode: "export default 'project-b'" }),
        source,
      );

      expect((await first.getCachedBundle(content, undefined, source))?.compiledCode).toBe(
        "export default 'project-a'",
      );
      expect((await second.getCachedBundle(content, undefined, source))?.compiledCode).toBe(
        "export default 'project-b'",
      );
      expect((await first.getStats()).totalBundles).toBe(1);
      expect((await second.getStats()).totalBundles).toBe(1);

      expect(await first.invalidateSource(source)).toBe(1);
      expect(await first.getCachedBundle(content, undefined, source)).toBeUndefined();
      expect((await second.getCachedBundle(content, undefined, source))?.compiledCode).toBe(
        "export default 'project-b'",
      );
    });

    it("clears only the requesting project scope", async () => {
      const first = new MDXCacheAdapter({
        config: testConfig,
        mode: "development",
        scope: "project-a",
      });
      const second = new MDXCacheAdapter({
        config: testConfig,
        mode: "development",
        scope: "project-b",
      });
      const content = "# Shared source";
      await first.setCachedBundle(content, createBundle({ compiledCode: "// a" }), "index.mdx");
      await second.setCachedBundle(content, createBundle({ compiledCode: "// b" }), "index.mdx");

      await first.clearAll();

      expect(await first.getCachedBundle(content, undefined, "index.mdx")).toBeUndefined();
      expect((await second.getCachedBundle(content, undefined, "index.mdx"))?.compiledCode).toBe(
        "// b",
      );
    });

    it("rejects unsafe scoped operations on legacy custom stores", async () => {
      let sourceInvalidations = 0;
      let clears = 0;
      let statsReads = 0;
      const legacyStore: BundleManifestStore = {
        getBundleMetadata: (key) => manifestStore.getBundleMetadata(key),
        setBundleMetadata: (key, metadata, ttl) =>
          manifestStore.setBundleMetadata(key, metadata, ttl),
        getBundleCode: (hash) => manifestStore.getBundleCode(hash),
        setBundleCode: (hash, code, ttl) => manifestStore.setBundleCode(hash, code, ttl),
        deleteBundle: (key) => manifestStore.deleteBundle(key),
        invalidateSource: (source) => {
          sourceInvalidations++;
          return manifestStore.invalidateSource(source);
        },
        clear: () => {
          clears++;
          return manifestStore.clear();
        },
        isAvailable: () => Promise.resolve(true),
        getStats: () => {
          statsReads++;
          return manifestStore.getStats();
        },
      };
      setBundleManifestStore(legacyStore);
      const scoped = new MDXCacheAdapter({
        config: testConfig,
        mode: "development",
        scope: "project-a",
      });

      await assertRejects(
        () => scoped.invalidateSource("index.mdx"),
        Error,
        "scoped source invalidation",
      );
      await assertRejects(
        () => scoped.clearAll(),
        Error,
        "scoped prefix invalidation",
      );
      await assertRejects(
        () => scoped.getStats(),
        Error,
        "scoped statistics",
      );
      assertEquals(sourceInvalidations, 0);
      assertEquals(clears, 0);
      assertEquals(statsReads, 0);
    });
  });

  describe("Disabled Cache", () => {
    it("performs no manifest-store operations when explicitly disabled", async () => {
      const operations: string[] = [];
      const disabledStore: BundleManifestStore = {
        getBundleMetadata: () => {
          operations.push("getBundleMetadata");
          return Promise.resolve(undefined);
        },
        setBundleMetadata: () => {
          operations.push("setBundleMetadata");
          return Promise.resolve();
        },
        getBundleCode: () => {
          operations.push("getBundleCode");
          return Promise.resolve(undefined);
        },
        setBundleCode: () => {
          operations.push("setBundleCode");
          return Promise.resolve();
        },
        deleteBundle: () => {
          operations.push("deleteBundle");
          return Promise.resolve();
        },
        invalidateSource: () => {
          operations.push("invalidateSource");
          return Promise.resolve(0);
        },
        clear: () => {
          operations.push("clear");
          return Promise.resolve();
        },
        isAvailable: () => {
          operations.push("isAvailable");
          return Promise.resolve(true);
        },
        getStats: () => {
          operations.push("getStats");
          return Promise.resolve({ totalBundles: 0, totalSize: 0 });
        },
      };
      setBundleManifestStore(disabledStore);
      const disabled = new MDXCacheAdapter({
        config: { cache: { bundleManifest: { enabled: false, type: "memory" } } },
        mode: "production",
        scope: "disabled-project",
      });

      await disabled.setCachedBundle("# disabled", createBundle(), "disabled.mdx");
      expect(await disabled.getCachedBundle("# disabled", undefined, "disabled.mdx"))
        .toBeUndefined();
      await disabled.invalidateBundle("# disabled");
      expect(await disabled.invalidateSource("disabled.mdx")).toBe(0);
      await disabled.clearAll();
      expect(await disabled.getStats()).toEqual({ totalBundles: 0, totalSize: 0 });
      expect(operations).toEqual([]);
    });
  });

  describe("Bundle Metadata", () => {
    it("should store bundle with correct metadata", async () => {
      const content = "# Test Metadata";
      const bundle = createBundle({
        compiledCode: "export default function MDXContent() { return null; }",
        frontmatter: { title: "Test" },
        headings: [{ id: "test", text: "Test", level: 1 }],
      });

      await adapter.setCachedBundle(
        content,
        bundle,
        "/path/to/test.mdx",
        bundle.frontmatter,
      );

      const cacheKey = await adapter.computeCompilationIdentity(
        content,
        bundle.frontmatter,
        "/path/to/test.mdx",
      );
      const metadata = await manifestStore.getBundleMetadata(cacheKey);

      expect(metadata).toBeDefined();
      expect(metadata?.source).toBe("/path/to/test.mdx");
      expect(metadata?.mode).toBe("development");
      expect(metadata?.meta?.type).toBe("mdx");
      expect(metadata?.size).toBeGreaterThan(0);
    });
  });

  describe("HTTP Bundle Validation", () => {
    it("should return cached bundle when no HTTP bundles are present", async () => {
      // Bundles without HTTP imports should work normally
      const content = "# No HTTP Imports";
      const bundle = createBundle({
        compiledCode: 'import React from "react";\nexport default () => null;',
      });

      await adapter.setCachedBundle(content, bundle, "no-http.mdx");
      const cached = await adapter.getCachedBundle(content, undefined, "no-http.mdx");

      expect(cached).toBeDefined();
      expect(cached?.compiledCode).toBe(bundle.compiledCode);
    });

    it("should skip validation for bundles without HTTP bundle paths", async () => {
      // Even with file:// imports that aren't HTTP bundles, should work
      const content = "# Local File Imports";
      const bundle = createBundle({
        compiledCode:
          'import Component from "file:///app/components/Test.js";\nexport default Component;',
      });

      await adapter.setCachedBundle(content, bundle, "local-file.mdx");
      const cached = await adapter.getCachedBundle(content, undefined, "local-file.mdx");

      expect(cached).toBeDefined();
      expect(cached?.compiledCode).toBe(bundle.compiledCode);
    });
  });
});
