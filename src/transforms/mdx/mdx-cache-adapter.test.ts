import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { expect } from "#std/expect.ts";
import { MDXCacheAdapter, type MDXCompilationResult } from "./mdx-cache-adapter.ts";
import type { VeryfrontConfig } from "#veryfront/config";

describe("MDXCacheAdapter", () => {
  let adapter: MDXCacheAdapter;

  const testConfig: VeryfrontConfig = {};

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
    adapter = new MDXCacheAdapter({
      config: testConfig,
      mode: "development",
    });
    adapter.clearAll();
  });

  afterEach(() => {
    adapter.clearAll();
  });

  describe("getCachedBundle", () => {
    it("should return undefined for uncached content", async () => {
      const result = await adapter.getCachedBundle("# Hello");
      expect(result).toBeUndefined();
    });

    it("should return cached bundle after setCachedBundle", async () => {
      const content = "# Test Content";
      const bundle = createBundle({
        compiledCode: "compiled code",
        headings: [{ id: "test", text: "Test", level: 1 }],
      });

      await adapter.setCachedBundle(content, bundle);
      const cached = await adapter.getCachedBundle(content);

      expect(cached).toBeDefined();
      expect(cached?.compiledCode).toBe("compiled code");
      expect(cached?.headings).toEqual([{ id: "test", text: "Test", level: 1 }]);
    });

    it("should use provided frontmatter over cached frontmatter", async () => {
      const content = "# Test";
      const bundle = createBundle({
        frontmatter: { cached: true },
      });

      await adapter.setCachedBundle(content, bundle);
      const cached = await adapter.getCachedBundle(content, { provided: true });

      expect(cached?.frontmatter).toEqual({ provided: true });
    });
  });

  describe("setCachedBundle", () => {
    it("should not cache bundle without compiled code", async () => {
      const content = "# Test";
      const bundle = createBundle({ compiledCode: "" });

      await adapter.setCachedBundle(content, bundle);
      const cached = await adapter.getCachedBundle(content);

      expect(cached).toBeUndefined();
    });
  });

  describe("invalidateBundle", () => {
    it("should remove cached bundle", async () => {
      const content = "# Test";
      const bundle = createBundle();

      await adapter.setCachedBundle(content, bundle);
      await adapter.invalidateBundle(content);
      const cached = await adapter.getCachedBundle(content);

      expect(cached).toBeUndefined();
    });
  });

  describe("clearAll", () => {
    it("should clear all cached bundles", async () => {
      await adapter.setCachedBundle("# One", createBundle());
      await adapter.setCachedBundle("# Two", createBundle());

      adapter.clearAll();

      expect(await adapter.getCachedBundle("# One")).toBeUndefined();
      expect(await adapter.getCachedBundle("# Two")).toBeUndefined();
    });
  });

  describe("getStats", () => {
    it("should return cache stats", async () => {
      await adapter.setCachedBundle("# Test", createBundle());
      const stats = adapter.getStats();

      expect(stats.totalBundles).toBe(1);
    });
  });

  describe("computeHash", () => {
    it("should compute consistent hash for same content", async () => {
      const content = "# Hello World";
      const hash1 = await adapter.computeHash(content);
      const hash2 = await adapter.computeHash(content);

      expect(hash1).toBe(hash2);
    });

    it("should compute different hash for different content", async () => {
      const hash1 = await adapter.computeHash("# Hello");
      const hash2 = await adapter.computeHash("# World");

      expect(hash1).not.toBe(hash2);
    });
  });
});
