/**
 * Tests for cache portability - ensuring code stored in distributed cache
 * is portable across different environments (build server -> production pod).
 *
 * @module cache/portability.test
 */

import { afterEach, beforeAll, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import {
  CACHE_DIR_TOKEN,
  detokenizeAllCachePaths,
  hasHardcodedCachePaths,
  tokenizeAllVeryFrontPaths,
} from "./paths.ts";
import { createTokenizingGateway, type TokenizingCacheGateway } from "./tokenizing-gateway.ts";
import { type CacheBackend, MemoryCacheBackend } from "./backend.ts";

/**
 * Mock distributed backend that simulates Redis behavior.
 * Unlike MemoryCacheBackend, this is treated as "distributed" for testing.
 */
class MockDistributedBackend implements CacheBackend {
  readonly type = "redis" as const;
  private store = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, value: string, _ttl?: number): Promise<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }

  del(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  /** Access the raw stored value for testing */
  getRawStoredValue(key: string): string | undefined {
    return this.store.get(key);
  }

  clear(): void {
    this.store.clear();
  }
}

describe("Cache Portability", () => {
  describe("Path Detection", () => {
    it("detects absolute macOS user paths", () => {
      const code = `import x from "file:///Users/dev/.cache/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(hasHardcodedCachePaths(code), true);
    });

    it("detects absolute Linux home paths", () => {
      const code = `import x from "file:///home/ci/.cache/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(hasHardcodedCachePaths(code), true);
    });

    it("detects /app/.cache paths (Docker containers)", () => {
      const code = `import x from "file:///app/.cache/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(hasHardcodedCachePaths(code), true);
    });

    it("detects veryfront-http-bundle anywhere in path", () => {
      const code = `import x from "file:///some/random/path/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(hasHardcodedCachePaths(code), true);
    });

    it("detects veryfront-mdx-esm anywhere in path", () => {
      const code = `import x from "file:///custom/path/veryfront-mdx-esm/mod-123.mjs"`;
      assertEquals(hasHardcodedCachePaths(code), true);
    });

    it("does not detect portable tokens", () => {
      const code = `import x from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/http-123.mjs"`;
      assertEquals(hasHardcodedCachePaths(code), false);
    });

    it("does not detect regular file:// paths without cache markers", () => {
      const code = `import x from "file:///usr/local/lib/node_modules/react/index.js"`;
      assertEquals(hasHardcodedCachePaths(code), false);
    });
  });

  describe("Tokenization", () => {
    let localCacheDir: string;

    beforeAll(() => {
      localCacheDir = getCacheBaseDir();
    });

    it("tokenizes current environment paths", () => {
      const code = `import x from "file://${localCacheDir}/veryfront-http-bundle/http-123.mjs"`;
      const tokenized = tokenizeAllVeryFrontPaths(code);

      assert(tokenized.includes(CACHE_DIR_TOKEN), "Should contain token");
      assert(!tokenized.includes(localCacheDir), "Should not contain local cache dir");
    });

    it("tokenizes paths from any environment (aggressive mode)", () => {
      // Simulate code from a different build server
      const buildServerCode = `import x from "file:///home/ci/projects/.cache/veryfront-http-bundle/http-123.mjs"`;
      const tokenized = tokenizeAllVeryFrontPaths(buildServerCode);

      assert(tokenized.includes(CACHE_DIR_TOKEN), "Should contain token");
      assert(!tokenized.includes("/home/ci/"), "Should not contain build server path");
    });

    it("tokenizes multiple paths in the same code", () => {
      const code = `
        import a from "file:///Users/dev/.cache/veryfront-http-bundle/http-123.mjs";
        import b from "file:///Users/dev/.cache/veryfront-mdx-esm/mdx-456.mjs";
      `;
      const tokenized = tokenizeAllVeryFrontPaths(code);

      // Count occurrences of token
      const tokenCount = (tokenized.match(new RegExp(CACHE_DIR_TOKEN, "g")) || []).length;
      assertEquals(tokenCount, 2);
    });

    it("preserves non-cache paths", () => {
      const code = `
        import react from "https://esm.sh/react@18";
        import local from "./local-file.ts";
      `;
      const tokenized = tokenizeAllVeryFrontPaths(code);

      assert(tokenized.includes("https://esm.sh/react@18"), "Should preserve esm.sh URL");
      assert(tokenized.includes("./local-file.ts"), "Should preserve relative import");
    });
  });

  describe("Detokenization", () => {
    let localCacheDir: string;

    beforeAll(() => {
      localCacheDir = getCacheBaseDir();
    });

    it("replaces tokens with local cache directory", () => {
      const portable = `import x from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/http-123.mjs"`;
      const local = detokenizeAllCachePaths(portable);

      assert(!local.includes(CACHE_DIR_TOKEN), "Should not contain token");
      assert(local.includes(localCacheDir), "Should contain local cache dir");
    });

    it("handles multiple tokens", () => {
      const portable = `
        import a from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/a.mjs";
        import b from "file://${CACHE_DIR_TOKEN}/veryfront-mdx-esm/b.mjs";
      `;
      const local = detokenizeAllCachePaths(portable);

      assert(!local.includes(CACHE_DIR_TOKEN), "Should not contain token");
      // Count occurrences of local cache dir
      const dirCount =
        (local.match(new RegExp(localCacheDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || [])
          .length;
      assertEquals(dirCount, 2);
    });
  });

  describe("Round-trip", () => {
    let localCacheDir: string;

    beforeAll(() => {
      localCacheDir = getCacheBaseDir();
    });

    it("tokenize -> detokenize preserves code", () => {
      const original = `import x from "file://${localCacheDir}/veryfront-http-bundle/http-123.mjs"`;
      const tokenized = tokenizeAllVeryFrontPaths(original);
      const restored = detokenizeAllCachePaths(tokenized);

      assertEquals(restored, original);
    });

    it("handles complex code with multiple imports", () => {
      const original = `
        // Module from HTTP bundle cache
        import { Component } from "file://${localCacheDir}/veryfront-http-bundle/react-component-123.mjs";
        // MDX module
        import { MDXContent } from "file://${localCacheDir}/veryfront-mdx-esm/article-456.mjs";
        // External ESM
        import React from "https://esm.sh/react@18";
        // Relative import
        import { helper } from "./utils.ts";

        export default function Page() {
          return <Component><MDXContent /></Component>;
        }
      `;
      const tokenized = tokenizeAllVeryFrontPaths(original);
      const restored = detokenizeAllCachePaths(tokenized);

      assertEquals(restored, original);
    });
  });

  describe("TokenizingCacheGateway", () => {
    let mockBackend: MockDistributedBackend;
    let gateway: TokenizingCacheGateway;
    let localCacheDir: string;

    beforeAll(() => {
      localCacheDir = getCacheBaseDir();
    });

    beforeEach(() => {
      mockBackend = new MockDistributedBackend();
      gateway = createTokenizingGateway(mockBackend, "TEST-GATEWAY");
    });

    afterEach(() => {
      mockBackend.clear();
    });

    it("tokenizes code on setCode", async () => {
      const codeWithPaths =
        `import x from "file://${localCacheDir}/veryfront-http-bundle/http-123.mjs"`;

      await gateway.setCode("key1", codeWithPaths);

      // Verify the stored value is tokenized
      const storedValue = mockBackend.getRawStoredValue("key1");
      assert(storedValue?.includes(CACHE_DIR_TOKEN), "Stored value should contain token");
      assert(!storedValue?.includes(localCacheDir), "Stored value should not contain local dir");
    });

    it("detokenizes code on getCode", async () => {
      // Store tokenized code directly in the backend
      const tokenizedCode =
        `import x from "file://${CACHE_DIR_TOKEN}/veryfront-http-bundle/http-123.mjs"`;
      await mockBackend.set("key2", tokenizedCode);

      // Get through gateway
      const code = await gateway.getCode("key2");

      assert(!code?.includes(CACHE_DIR_TOKEN), "Retrieved code should not contain token");
      assert(code?.includes(localCacheDir), "Retrieved code should contain local dir");
    });

    it("provides isDistributed() = true for distributed backends", () => {
      assertEquals(gateway.isDistributed(), true);
    });

    it("provides isDistributed() = false for memory backends", () => {
      const memBackend = new MemoryCacheBackend();
      const memGateway = createTokenizingGateway(memBackend, "MEM-GATEWAY");

      assertEquals(memGateway.isDistributed(), false);
    });

    it("skips tokenization for memory backends (optimization)", async () => {
      const memBackend = new MemoryCacheBackend();
      const memGateway = createTokenizingGateway(memBackend, "MEM-GATEWAY");

      const codeWithPaths =
        `import x from "file://${localCacheDir}/veryfront-http-bundle/http-123.mjs"`;
      await memGateway.setCode("key1", codeWithPaths);

      // For memory backend, code should NOT be tokenized
      const stored = await memBackend.get("key1");
      assertEquals(stored, codeWithPaths);
      assert(!stored?.includes(CACHE_DIR_TOKEN), "Memory backend should not tokenize");
    });

    it("pass-through get/set do not tokenize", async () => {
      const metadata = JSON.stringify({ version: 1, hash: "abc123" });

      await gateway.set("metadata-key", metadata);

      // Stored value should be unchanged
      const stored = mockBackend.getRawStoredValue("metadata-key");
      assertEquals(stored, metadata);
    });

    describe("Invariant Validation", () => {
      it("rejects code with un-tokenizable paths on setCode", async () => {
        // Create a backend that simulates tokenization failure
        // This shouldn't happen with proper tokenization, but tests the safety net
        const code = `import x from "file:///app/.cache/veryfront-http-bundle/http-123.mjs"`;

        // The tokenization should handle this, so no error expected
        // This test verifies the happy path
        await gateway.setCode("key", code);

        const stored = mockBackend.getRawStoredValue("key");
        assert(stored?.includes(CACHE_DIR_TOKEN), "Stored code should contain token");
      });
    });

    describe("Cross-environment scenarios", () => {
      it("handles code from different build environments", async () => {
        // Simulate code from a CI build server
        const buildServerCode =
          `import x from "file:///home/ci/runner/.cache/veryfront-http-bundle/http-123.mjs"`;

        await gateway.setCode("ci-build", buildServerCode);

        // Verify tokenization
        const stored = mockBackend.getRawStoredValue("ci-build");
        assert(stored?.includes(CACHE_DIR_TOKEN), "Should be tokenized");
        assert(!stored?.includes("/home/ci/"), "Should not contain CI path");

        // Verify retrieval produces local paths
        const retrieved = await gateway.getCode("ci-build");
        assert(!retrieved?.includes(CACHE_DIR_TOKEN), "Retrieved should not contain token");
        assert(retrieved?.includes(localCacheDir), "Retrieved should contain local dir");
      });

      it("handles code with mixed path sources", async () => {
        // Code with paths from multiple environments (shouldn't happen in practice,
        // but tests robustness)
        const mixedCode = `
          import a from "file:///Users/dev/.cache/veryfront-http-bundle/a.mjs";
          import b from "file:///home/ci/.cache/veryfront-http-bundle/b.mjs";
        `;

        await gateway.setCode("mixed", mixedCode);

        const stored = mockBackend.getRawStoredValue("mixed");
        const tokenCount = (stored?.match(new RegExp(CACHE_DIR_TOKEN, "g")) || []).length;
        assertEquals(tokenCount, 2);
      });
    });
  });

  describe("Integration with existing cache patterns", () => {
    it("transform cache JSON entry tokenization", () => {
      const localCacheDir = getCacheBaseDir();
      // Transform cache stores JSON with code inside
      const entry = {
        code:
          `import x from "file://${localCacheDir}/veryfront-http-bundle/http-123.mjs"`,
        hash: "abc123",
        timestamp: Date.now(),
      };

      // Tokenize the code field
      const tokenizedEntry = {
        ...entry,
        code: tokenizeAllVeryFrontPaths(entry.code),
      };

      // Verify tokenization
      assert(tokenizedEntry.code.includes(CACHE_DIR_TOKEN), "Should be tokenized");

      // Verify round-trip
      const restoredEntry = {
        ...tokenizedEntry,
        code: detokenizeAllCachePaths(tokenizedEntry.code),
      };

      assertEquals(restoredEntry.code, entry.code);
    });
  });
});
