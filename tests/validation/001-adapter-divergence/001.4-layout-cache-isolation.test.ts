/**
 * Test: 001.4 Layout Cache Isolation
 *
 * Validates the fix for issue 001.4 from the architecture audit:
 * - Cache keys include projectDir for multi-tenant isolation
 * - Cache has bounded size with LRU eviction
 * - Project-specific cache clearing works correctly
 *
 * @see plans/architecture-audit/001.4-layout-cache-no-project-scope.md
 */

import { assertEquals, assert } from "@veryfront/testing/assert";
import { describe, it, beforeEach } from "@veryfront/testing/bdd";
import {
  discoverNestedLayouts,
  clearLayoutDiscoveryCache,
  getLayoutDiscoveryCacheStats,
} from "../../../src/rendering/layouts/utils/discovery.ts";
import type { RuntimeAdapter, FileSystemAdapter } from "../../../src/platform/adapters/base.ts";

function createMockAdapter(existingFiles: Set<string>): RuntimeAdapter {
  const mockFS: FileSystemAdapter = {
    stat: async (path: string) => {
      if (existingFiles.has(path)) {
        return {
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: 100,
          mtime: new Date(),
        };
      }
      throw new Error(`File not found: ${path}`);
    },
    readFile: async () => "",
    writeFile: async () => {},
    readDir: async function* () {},
    exists: async (path: string) => existingFiles.has(path),
    mkdir: async () => {},
    remove: async () => {},
    makeTempDir: async () => "/tmp/test",
    watch: () => ({
      close: () => {},
      [Symbol.asyncIterator]: async function* () {},
    }),
  };

  return {
    id: "memory",
    name: "test",
    capabilities: {
      typescript: true,
      jsx: true,
      http2: false,
      websocket: true,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: true,
    },
    fs: mockFS,
    env: {
      get: () => undefined,
      set: () => {},
      toObject: () => ({}),
    },
    server: {
      upgradeWebSocket: () => ({ socket: {} as WebSocket, response: new Response() }),
    },
    serve: async () => ({
      stop: async () => {},
      addr: { hostname: "localhost", port: 8080 },
    }),
  };
}

describe("001.4 Layout Cache Isolation", () => {
  beforeEach(() => {
    clearLayoutDiscoveryCache();
  });

  describe("Project-Scoped Cache Keys", () => {
    it("should cache results separately per project", async () => {
      // Project A has a root layout
      const projectAFiles = new Set([
        "/projects/project-a/app/layout.tsx",
        "/projects/project-a/app/page.tsx",
      ]);
      const adapterA = createMockAdapter(projectAFiles);

      // Project B has no root layout
      const projectBFiles = new Set([
        "/projects/project-b/app/page.tsx",
      ]);
      const adapterB = createMockAdapter(projectBFiles);

      // Same page path structure, different projects
      const pagePathA = "/projects/project-a/app/page.tsx";
      const pagePathB = "/projects/project-b/app/page.tsx";
      const rootDirA = "/projects/project-a/app";
      const rootDirB = "/projects/project-b/app";

      // Discover layouts for project A
      const layoutsA = await discoverNestedLayouts(
        pagePathA,
        rootDirA,
        "/projects/project-a",
        adapterA,
      );

      // Discover layouts for project B
      const layoutsB = await discoverNestedLayouts(
        pagePathB,
        rootDirB,
        "/projects/project-b",
        adapterB,
      );

      // Project A should have 1 layout, Project B should have 0
      assertEquals(layoutsA.length, 1, "Project A should have 1 layout");
      assertEquals(layoutsB.length, 0, "Project B should have 0 layouts");

      // Cache should have 2 entries (one per project)
      const stats = getLayoutDiscoveryCacheStats();
      assertEquals(stats.size, 2, "Cache should have 2 separate entries");
    });

    it("should not leak layouts between projects with same structure", async () => {
      // Both projects have same file structure but are different projects
      const projectAFiles = new Set([
        "/tenant-a/app/layout.tsx",
        "/tenant-a/app/dashboard/page.tsx",
      ]);

      const projectBFiles = new Set([
        "/tenant-b/app/layout.tsx",
        "/tenant-b/app/dashboard/page.tsx",
      ]);

      const adapterA = createMockAdapter(projectAFiles);
      const adapterB = createMockAdapter(projectBFiles);

      const layoutsA = await discoverNestedLayouts(
        "/tenant-a/app/dashboard/page.tsx",
        "/tenant-a/app",
        "/tenant-a",
        adapterA,
      );

      const layoutsB = await discoverNestedLayouts(
        "/tenant-b/app/dashboard/page.tsx",
        "/tenant-b/app",
        "/tenant-b",
        adapterB,
      );

      // Each should have their own layout paths
      assertEquals(layoutsA.length, 1);
      assertEquals(layoutsB.length, 1);
      assertEquals(layoutsA[0]?.path, "/tenant-a/app/layout.tsx");
      assertEquals(layoutsB[0]?.path, "/tenant-b/app/layout.tsx");
    });
  });

  describe("LRU Cache Behavior", () => {
    it("should have bounded cache size", () => {
      const stats = getLayoutDiscoveryCacheStats();
      assert(stats.maxSize > 0, "Cache should have max size limit");
      assertEquals(stats.maxSize, 500, "Default max size should be 500");
    });

    it("should reuse cached results", async () => {
      const projectDir = "/project";
      const existingFiles = new Set([
        "/project/app/layout.tsx",
        "/project/app/page.tsx",
      ]);
      const adapter = createMockAdapter(existingFiles);

      // First call
      const layouts1 = await discoverNestedLayouts(
        "/project/app/page.tsx",
        "/project/app",
        projectDir,
        adapter,
      );

      const statsAfter1 = getLayoutDiscoveryCacheStats();
      assertEquals(statsAfter1.size, 1, "Should have 1 cached entry");

      // Second call - should use cache
      const layouts2 = await discoverNestedLayouts(
        "/project/app/page.tsx",
        "/project/app",
        projectDir,
        adapter,
      );

      const statsAfter2 = getLayoutDiscoveryCacheStats();
      assertEquals(statsAfter2.size, 1, "Should still have 1 cached entry");

      // Results should be the same
      assertEquals(layouts1.length, layouts2.length);
      assertEquals(layouts1[0]?.path, layouts2[0]?.path);
    });
  });

  describe("Project-Specific Cache Clearing", () => {
    it("should clear only entries for specified project", async () => {
      const projectAFiles = new Set(["/project-a/app/layout.tsx", "/project-a/app/page.tsx"]);
      const projectBFiles = new Set(["/project-b/app/layout.tsx", "/project-b/app/page.tsx"]);

      const adapterA = createMockAdapter(projectAFiles);
      const adapterB = createMockAdapter(projectBFiles);

      // Populate cache for both projects
      await discoverNestedLayouts(
        "/project-a/app/page.tsx",
        "/project-a/app",
        "/project-a",
        adapterA,
      );

      await discoverNestedLayouts(
        "/project-b/app/page.tsx",
        "/project-b/app",
        "/project-b",
        adapterB,
      );

      assertEquals(getLayoutDiscoveryCacheStats().size, 2, "Should have 2 cached entries");

      // Clear only project A
      clearLayoutDiscoveryCache("/project-a");

      // Project A should be cleared, Project B should remain
      // Note: We can't directly verify which entries remain, but size should decrease
      const statsAfterClear = getLayoutDiscoveryCacheStats();
      assertEquals(statsAfterClear.size, 1, "Should have 1 cached entry after clearing project A");
    });

    it("should clear all entries when no project specified", async () => {
      const projectAFiles = new Set(["/project-a/app/page.tsx"]);
      const projectBFiles = new Set(["/project-b/app/page.tsx"]);

      await discoverNestedLayouts(
        "/project-a/app/page.tsx",
        "/project-a/app",
        "/project-a",
        createMockAdapter(projectAFiles),
      );

      await discoverNestedLayouts(
        "/project-b/app/page.tsx",
        "/project-b/app",
        "/project-b",
        createMockAdapter(projectBFiles),
      );

      assertEquals(getLayoutDiscoveryCacheStats().size, 2, "Should have 2 cached entries");

      // Clear all
      clearLayoutDiscoveryCache();

      assertEquals(getLayoutDiscoveryCacheStats().size, 0, "Should have 0 cached entries");
    });
  });
});
