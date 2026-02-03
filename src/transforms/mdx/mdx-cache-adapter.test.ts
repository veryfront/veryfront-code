import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { delay } from "#std/async.ts";
import { MDXCacheAdapter, type MDXCompilationResult } from "./mdx-cache-adapter.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  type BundleManifestStore,
  InMemoryBundleManifestStore,
  setBundleManifestStore,
} from "#veryfront/utils/bundle-manifest.ts";

describe("MDXCacheAdapter", () => {
  let adapter: MDXCacheAdapter;
  let manifestStore: BundleManifestStore;

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

  beforeEach(() => {
    manifestStore = new InMemoryBundleManifestStore();
    setBundleManifestStore(manifestStore);

    adapter = new MDXCacheAdapter({
      config: testConfig,
      mode: "development",
    });
  });

  afterEach(async () => {
    await manifestStore.clear();
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

      const cached = await adapter.getCachedBundle(testContent);

      expect(cached).toBeDefined();
      expect(cached?.compiledCode).toBe(testBundle.compiledCode);
      expect(cached?.frontmatter).toEqual({});
    });

    it("should preserve frontmatter on cache hit", async () => {
      const frontmatter = {
        title: "Custom Title",
        description: "Custom Description",
      };

      await adapter.setCachedBundle(testContent, testBundle, "test.mdx");
      const cached = await adapter.getCachedBundle(testContent, frontmatter);

      expect(cached?.frontmatter).toEqual(frontmatter);
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

      const cached1 = await adapter.getCachedBundle(content1);
      const cached2 = await adapter.getCachedBundle(content2);

      expect(cached1?.compiledCode).toBe("// Page 1");
      expect(cached2?.compiledCode).toBe("// Page 2");
    });

    it("should not cache bundle without compiled code", async () => {
      await adapter.setCachedBundle(
        testContent,
        createBundle({ compiledCode: "" }),
        "test.mdx",
      );

      const cached = await adapter.getCachedBundle(testContent);
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

      const cached1 = await shortAdapter.getCachedBundle(content);
      expect(cached1).toBeDefined();

      await delay(150);

      const cached2 = await shortAdapter.getCachedBundle(content);
      expect(cached2).toBeUndefined();
    });

    it("should use different TTL for production mode", async () => {
      const prodAdapter = new MDXCacheAdapter({
        config: testConfig,
        mode: "production",
      });

      const content = "# Production Test";
      await prodAdapter.setCachedBundle(content, createBundle(), "prod.mdx");

      const cached = await prodAdapter.getCachedBundle(content);
      expect(cached).toBeDefined();
    });
  });

  describe("Cache Invalidation", () => {
    const testContent = "# Test Content";
    const testBundle = createBundle();

    it("should invalidate specific bundle by content", async () => {
      await adapter.setCachedBundle(testContent, testBundle, "test.mdx");

      expect(await adapter.getCachedBundle(testContent)).toBeDefined();

      await adapter.invalidateBundle(testContent);

      expect(await adapter.getCachedBundle(testContent)).toBeUndefined();
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

    it("should handle invalidation errors gracefully", async () => {
      const failingStore: BundleManifestStore = {
        ...manifestStore,
        deleteBundle: () => Promise.reject(new Error("Delete error")),
        invalidateSource: () => Promise.reject(new Error("Invalidate error")),
      };
      setBundleManifestStore(failingStore);

      await adapter.invalidateBundle("# Test");
      await adapter.invalidateSource("/path/to/file");
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
      expect(await devAdapter.getCachedBundle(content)).toBeDefined();
    });

    it("should use production mode cache key", async () => {
      const prodAdapter = new MDXCacheAdapter({
        config: testConfig,
        mode: "production",
      });

      const content = "# Prod Test";
      await prodAdapter.setCachedBundle(content, createBundle(), "prod.mdx");

      expect(await prodAdapter.getCachedBundle(content)).toBeDefined();
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

      expect(await prodAdapter.getCachedBundle(content)).toBeUndefined();
      expect(await devAdapter.getCachedBundle(content)).toBeDefined();
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

      await adapter.setCachedBundle(content, bundle, "/path/to/test.mdx");

      const hash = await adapter.computeHash(content);
      const cacheKey = `mdx:development:${hash}`;
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
      const cached = await adapter.getCachedBundle(content);

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
      const cached = await adapter.getCachedBundle(content);

      expect(cached).toBeDefined();
      expect(cached?.compiledCode).toBe(bundle.compiledCode);
    });
  });
});
