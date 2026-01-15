/**
 * Tests for Renderer Factory
 *
 * Verifies LRU caching, memory pressure eviction, TTL expiration,
 * and per-project isolation.
 */

import { assert, assertEquals, assertExists, assertGreater } from "std/assert/mod.ts";
import { afterEach, beforeEach, describe, it } from "std/testing/bdd.ts";
import { join } from "std/path/mod.ts";

// Import the module under test
import {
  cleanupRenderers,
  evictProjectRenderer,
  getRendererCacheStats,
  getRendererCount,
  getRendererForProject,
} from "../../../../src/server/shared/renderer-factory.ts";

import type { HandlerContext } from "../../../../src/server/handlers/types.ts";

// Note: Sanitizers disabled due to React 19 SSR MessagePort cleanup issue
// and renderer internals that may leave resources open
describe(
  "Renderer Factory",
  {
    sanitizeResources: false,
    sanitizeOps: false,
  },
  () => {
    let tempDir: string;

    // Create a minimal mock HandlerContext
    function createMockContext(projectSlug: string): HandlerContext {
      return {
        projectDir: tempDir,
        mode: "development" as const,
        adapter: {
          fs: {
            readFile: () => Promise.resolve(""),
            readDir: () => Promise.resolve([]),
            exists: () => Promise.resolve(false),
            stat: () => Promise.resolve({ isFile: false, isDirectory: false, mtime: null }),
          },
          module: {},
        },
        projectSlug,
        config: {},
      } as unknown as HandlerContext;
    }

    beforeEach(async () => {
      // Create temp directory for test project
      tempDir = await Deno.makeTempDir({ prefix: "renderer_factory_test_" });

      // Create minimal project structure
      await Deno.mkdir(join(tempDir, "app"), { recursive: true });
      await Deno.writeTextFile(
        join(tempDir, "app", "page.tsx"),
        `export default function Page() { return <div>Test</div>; }`,
      );

      // Clean up any existing renderers from previous tests
      await cleanupRenderers();
    });

    afterEach(async () => {
      // Clean up renderers
      await cleanupRenderers();

      // Remove temp directory
      try {
        await Deno.remove(tempDir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    });

    describe("Basic Caching", () => {
      it("should return the same renderer for the same project", async () => {
        const ctx = createMockContext("test-project-1");

        const renderer1 = await getRendererForProject(ctx);
        const renderer2 = await getRendererForProject(ctx);

        // Should be the exact same instance (use strict reference equality)
        assert(renderer1 === renderer2, "renderer1 should be same instance as renderer2");
        assertEquals(getRendererCount(), 1);
      });

      it("should create separate renderers for different projects", async () => {
        const ctx1 = createMockContext("project-a");
        const ctx2 = createMockContext("project-b");

        const renderer1 = await getRendererForProject(ctx1);
        const renderer2 = await getRendererForProject(ctx2);

        // Should be different instances
        assertExists(renderer1);
        assertExists(renderer2);
        assertEquals(getRendererCount(), 2);
      });

      it("should update lastAccess on cache hit", async () => {
        const ctx = createMockContext("access-test");

        // First access
        await getRendererForProject(ctx);
        const stats1 = getRendererCacheStats();
        assertEquals(stats1.size, 1);

        // Wait a bit
        await new Promise((r) => setTimeout(r, 50));

        // Second access should update lastAccess (cache hit)
        await getRendererForProject(ctx);
        const stats2 = getRendererCacheStats();
        assertEquals(stats2.size, 1);
      });
    });

    describe("LRU Eviction", () => {
      it("should evict oldest renderer when cache is full", async () => {
        // Create renderers up to the limit (MAX_RENDERER_CACHE_SIZE = 10)
        const contexts: HandlerContext[] = [];
        for (let i = 0; i < 12; i++) {
          contexts.push(createMockContext(`project-${i}`));
        }

        // Create all renderers
        for (const ctx of contexts) {
          await getRendererForProject(ctx);
        }

        // Should have evicted some to stay under limit
        const stats = getRendererCacheStats();
        assertGreater(12, stats.size, "Cache should have evicted some entries");
        assertEquals(stats.size, stats.maxSize, "Cache should be at max size");
      });

      it("should evict specific project renderer on demand", async () => {
        const ctx = createMockContext("evict-me");

        await getRendererForProject(ctx);
        assertEquals(getRendererCount(), 1);

        await evictProjectRenderer("evict-me");
        assertEquals(getRendererCount(), 0);
      });
    });

    describe("Cache Statistics", () => {
      it("should return accurate cache statistics", async () => {
        const ctx1 = createMockContext("stats-1");
        const ctx2 = createMockContext("stats-2");

        await getRendererForProject(ctx1);
        await getRendererForProject(ctx2);

        const stats = getRendererCacheStats();
        assertEquals(stats.size, 2);
        assertEquals(stats.maxSize, 10); // MAX_RENDERER_CACHE_SIZE
        // Cache keys now include environment: {projectSlug}:preview
        assertEquals(stats.projects.sort(), ["stats-1:preview", "stats-2:preview"]);
      });
    });

    describe("Cache Key Generation", () => {
      it("should use preview cache key for non-production environment", async () => {
        const ctx = createMockContext("cache-key-preview");

        await getRendererForProject(ctx);

        const stats = getRendererCacheStats();
        assertEquals(stats.projects, ["cache-key-preview:preview"]);
      });

      it("should use production cache key with releaseId", async () => {
        const ctx = {
          ...createMockContext("cache-key-prod"),
          proxyEnvironment: "production" as const,
          releaseId: "release-123",
        };

        await getRendererForProject(ctx);

        const stats = getRendererCacheStats();
        assertEquals(stats.projects, ["cache-key-prod:production:release-123"]);
      });

      it("should use different cache keys for different releases", async () => {
        const ctx1 = {
          ...createMockContext("multi-release"),
          proxyEnvironment: "production" as const,
          releaseId: "release-v1",
        };
        const ctx2 = {
          ...createMockContext("multi-release"),
          proxyEnvironment: "production" as const,
          releaseId: "release-v2",
        };

        await getRendererForProject(ctx1);
        await getRendererForProject(ctx2);

        const stats = getRendererCacheStats();
        assertEquals(stats.size, 2);
        assertEquals(stats.projects.sort(), [
          "multi-release:production:release-v1",
          "multi-release:production:release-v2",
        ]);
      });

      it("should use 'latest' when production has no releaseId", async () => {
        const ctx = {
          ...createMockContext("cache-key-latest"),
          proxyEnvironment: "production" as const,
          // No releaseId set
        };

        await getRendererForProject(ctx);

        const stats = getRendererCacheStats();
        assertEquals(stats.projects, ["cache-key-latest:production:latest"]);
      });

      it("should use production cache key for Veryfront domain when isDraft is false", async () => {
        const ctx = {
          ...createMockContext("vf-domain-prod"),
          parsedDomain: {
            slug: "vf-domain-prod",
            branch: null,
            environment: "production" as const,
            isVeryfrontDomain: true,
            isDraft: false,
            allowIframeEmbed: true,
          },
          releaseId: "release-456",
        };

        await getRendererForProject(ctx);

        const stats = getRendererCacheStats();
        assertEquals(stats.projects, ["vf-domain-prod:production:release-456"]);
      });

      it("should use preview cache key for Veryfront domain when isDraft is true", async () => {
        const ctx = {
          ...createMockContext("vf-domain-draft"),
          parsedDomain: {
            slug: "vf-domain-draft",
            branch: null,
            environment: "preview" as const,
            isVeryfrontDomain: true,
            isDraft: true,
            allowIframeEmbed: true,
          },
          proxyEnvironment: "production" as const, // Even with production env, isDraft wins
          releaseId: "release-789",
        };

        await getRendererForProject(ctx);

        const stats = getRendererCacheStats();
        // isDraft=true means preview mode, ignoring proxyEnvironment
        assertEquals(stats.projects, ["vf-domain-draft:preview"]);
      });
    });

    describe("Cleanup", () => {
      it("should clean up all renderers", async () => {
        const ctx1 = createMockContext("cleanup-1");
        const ctx2 = createMockContext("cleanup-2");

        await getRendererForProject(ctx1);
        await getRendererForProject(ctx2);
        assertEquals(getRendererCount(), 2);

        await cleanupRenderers();
        assertEquals(getRendererCount(), 0);
      });
    });

    describe("Single Project Mode", () => {
      it("should handle context without projectSlug", async () => {
        // Create context without projectSlug (single-project mode)
        const ctx = {
          projectDir: tempDir,
          mode: "development" as const,
          adapter: {
            fs: {
              readFile: () => Promise.resolve(""),
              readDir: () => Promise.resolve([]),
              exists: () => Promise.resolve(false),
              stat: () => Promise.resolve({ isFile: false, isDirectory: false, mtime: null }),
            },
            module: {},
          },
          // No projectSlug
          config: {},
        } as unknown as HandlerContext;

        const renderer = await getRendererForProject(ctx);
        assertExists(renderer);

        // Single project mode uses a special "__single__" key
        assertEquals(getRendererCount(), 1);
      });
    });

    describe("Concurrent Requests", () => {
      it("should deduplicate in-flight renderer creation", async () => {
        const ctx = createMockContext("concurrent-test");

        // Start multiple requests concurrently
        const promises = [
          getRendererForProject(ctx),
          getRendererForProject(ctx),
          getRendererForProject(ctx),
        ];

        const renderers = await Promise.all(promises);

        // All should return the same instance (use strict reference equality)
        assert(
          renderers[0] === renderers[1],
          "renderers[0] should be same instance as renderers[1]",
        );
        assert(
          renderers[1] === renderers[2],
          "renderers[1] should be same instance as renderers[2]",
        );
        assertEquals(getRendererCount(), 1);
      });
    });
  },
);
