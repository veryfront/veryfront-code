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

import { assert, assertEquals } from "#veryfront/testing/assert";
import { beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  clearLayoutDiscoveryCache,
  discoverNestedLayouts,
  getLayoutDiscoveryCacheStats,
} from "../../../src/rendering/layouts/utils/discovery.ts";
import type { FileSystemAdapter, RuntimeAdapter } from "../../../src/platform/adapters/base.ts";

function createMockAdapter(existingFiles: Set<string>): RuntimeAdapter {
  const mockFS: FileSystemAdapter = {
    stat: async (path: string) => {
      if (!existingFiles.has(path)) {
        throw new Error(`File not found: ${path}`);
      }

      return {
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        size: 100,
        mtime: new Date(),
      };
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
      const adapterA = createMockAdapter(
        new Set(["/projects/project-a/app/layout.tsx", "/projects/project-a/app/page.tsx"]),
      );
      const adapterB = createMockAdapter(new Set(["/projects/project-b/app/page.tsx"]));

      const layoutsA = await discoverNestedLayouts(
        "/projects/project-a/app/page.tsx",
        "/projects/project-a/app",
        "/projects/project-a",
        adapterA,
      );

      const layoutsB = await discoverNestedLayouts(
        "/projects/project-b/app/page.tsx",
        "/projects/project-b/app",
        "/projects/project-b",
        adapterB,
      );

      assertEquals(layoutsA.length, 1, "Project A should have 1 layout");
      assertEquals(layoutsB.length, 0, "Project B should have 0 layouts");

      const stats = getLayoutDiscoveryCacheStats();
      assertEquals(stats.size, 2, "Cache should have 2 separate entries");
    });

    it("should not leak layouts between projects with same structure", async () => {
      const adapterA = createMockAdapter(
        new Set(["/tenant-a/app/layout.tsx", "/tenant-a/app/dashboard/page.tsx"]),
      );
      const adapterB = createMockAdapter(
        new Set(["/tenant-b/app/layout.tsx", "/tenant-b/app/dashboard/page.tsx"]),
      );

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
      const adapter = createMockAdapter(
        new Set(["/project/app/layout.tsx", "/project/app/page.tsx"]),
      );

      const layouts1 = await discoverNestedLayouts(
        "/project/app/page.tsx",
        "/project/app",
        "/project",
        adapter,
      );

      assertEquals(getLayoutDiscoveryCacheStats().size, 1, "Should have 1 cached entry");

      const layouts2 = await discoverNestedLayouts(
        "/project/app/page.tsx",
        "/project/app",
        "/project",
        adapter,
      );

      assertEquals(getLayoutDiscoveryCacheStats().size, 1, "Should still have 1 cached entry");
      assertEquals(layouts1.length, layouts2.length);
      assertEquals(layouts1[0]?.path, layouts2[0]?.path);
    });
  });

  describe("Project-Specific Cache Clearing", () => {
    it("should clear only entries for specified project", async () => {
      const adapterA = createMockAdapter(
        new Set(["/project-a/app/layout.tsx", "/project-a/app/page.tsx"]),
      );
      const adapterB = createMockAdapter(
        new Set(["/project-b/app/layout.tsx", "/project-b/app/page.tsx"]),
      );

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

      clearLayoutDiscoveryCache("/project-a");

      const statsAfterClear = getLayoutDiscoveryCacheStats();
      assertEquals(statsAfterClear.size, 1, "Should have 1 cached entry after clearing project A");
    });

    it("should clear all entries when no project specified", async () => {
      await discoverNestedLayouts(
        "/project-a/app/page.tsx",
        "/project-a/app",
        "/project-a",
        createMockAdapter(new Set(["/project-a/app/page.tsx"])),
      );

      await discoverNestedLayouts(
        "/project-b/app/page.tsx",
        "/project-b/app",
        "/project-b",
        createMockAdapter(new Set(["/project-b/app/page.tsx"])),
      );

      assertEquals(getLayoutDiscoveryCacheStats().size, 2, "Should have 2 cached entries");

      clearLayoutDiscoveryCache();

      assertEquals(getLayoutDiscoveryCacheStats().size, 0, "Should have 0 cached entries");
    });
  });
});
