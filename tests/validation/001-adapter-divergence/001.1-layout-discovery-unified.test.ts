/**
 * Test: 001.1 Layout Discovery Unified
 *
 * Validates the fix for issue 001.1 from the architecture audit:
 * - API and filesystem adapters now use the same code path
 * - discoverNestedLayouts is called for ALL adapter types
 * - Nested layouts like app/dashboard/layout.tsx are discovered
 *
 * @see plans/architecture-audit/001.1-layout-bug-critical.md
 */

import { assertEquals, assert } from "@veryfront/testing/assert";
import { describe, it, beforeEach } from "@veryfront/testing/bdd";
import {
  discoverNestedLayouts,
  clearLayoutDiscoveryCache,
} from "../../../src/rendering/layouts/utils/discovery.ts";
import type { RuntimeAdapter, FileSystemAdapter } from "../../../src/platform/adapters/base.ts";

// Mock adapter that simulates the Veryfront API filesystem
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

describe("001.1 Layout Discovery Unified", () => {
  beforeEach(() => {
    clearLayoutDiscoveryCache();
  });

  describe("Nested Layout Discovery", () => {
    it("should discover app router nested layouts", async () => {
      const projectDir = "/project";
      const existingFiles = new Set([
        "/project/app/layout.tsx",
        "/project/app/dashboard/layout.tsx",
        "/project/app/dashboard/settings/page.tsx",
      ]);

      const adapter = createMockAdapter(existingFiles);
      const pageFilePath = "/project/app/dashboard/settings/page.tsx";
      const rootDir = "/project/app";

      const layouts = await discoverNestedLayouts(
        pageFilePath,
        rootDir,
        projectDir,
        adapter,
      );

      // Should find both the root layout and dashboard layout
      assertEquals(layouts.length, 2, "Should find 2 nested layouts");

      const paths = layouts.map((l) => l.path);
      assert(paths.includes("/project/app/layout.tsx"), "Should include root layout");
      assert(
        paths.includes("/project/app/dashboard/layout.tsx"),
        "Should include dashboard layout",
      );
    });

    it("should discover deeply nested layouts", async () => {
      const projectDir = "/project";
      const existingFiles = new Set([
        "/project/app/layout.tsx",
        "/project/app/admin/layout.tsx",
        "/project/app/admin/users/layout.tsx",
        "/project/app/admin/users/[id]/page.tsx",
      ]);

      const adapter = createMockAdapter(existingFiles);
      const pageFilePath = "/project/app/admin/users/[id]/page.tsx";
      const rootDir = "/project/app";

      const layouts = await discoverNestedLayouts(
        pageFilePath,
        rootDir,
        projectDir,
        adapter,
      );

      // Should find all 3 layouts
      assertEquals(layouts.length, 3, "Should find 3 nested layouts");

      const paths = layouts.map((l) => l.path);
      assert(paths.includes("/project/app/layout.tsx"), "Should include root layout");
      assert(paths.includes("/project/app/admin/layout.tsx"), "Should include admin layout");
      assert(
        paths.includes("/project/app/admin/users/layout.tsx"),
        "Should include users layout",
      );
    });

    it("should handle pages without nested layouts", async () => {
      const projectDir = "/project";
      const existingFiles = new Set([
        "/project/app/about/page.tsx",
      ]);

      const adapter = createMockAdapter(existingFiles);
      const pageFilePath = "/project/app/about/page.tsx";
      const rootDir = "/project/app";

      const layouts = await discoverNestedLayouts(
        pageFilePath,
        rootDir,
        projectDir,
        adapter,
      );

      assertEquals(layouts.length, 0, "Should find no layouts");
    });

    it("should handle MDX layouts", async () => {
      const projectDir = "/project";
      const existingFiles = new Set([
        "/project/app/layout.mdx",
        "/project/app/blog/layout.tsx",
        "/project/app/blog/[slug]/page.tsx",
      ]);

      const adapter = createMockAdapter(existingFiles);
      const pageFilePath = "/project/app/blog/[slug]/page.tsx";
      const rootDir = "/project/app";

      const layouts = await discoverNestedLayouts(
        pageFilePath,
        rootDir,
        projectDir,
        adapter,
      );

      assertEquals(layouts.length, 2, "Should find 2 layouts");

      const mdxLayout = layouts.find((l) => l.path?.endsWith(".mdx"));
      const tsxLayout = layouts.find((l) => l.path?.endsWith(".tsx"));

      assert(mdxLayout, "Should find MDX layout");
      assertEquals(mdxLayout?.kind, "mdx", "MDX layout should have kind 'mdx'");

      assert(tsxLayout, "Should find TSX layout");
      assertEquals(tsxLayout?.kind, "tsx", "TSX layout should have kind 'tsx'");
    });
  });

  describe("Pages Router Support", () => {
    it("should discover pages router layouts", async () => {
      const projectDir = "/project";
      const existingFiles = new Set([
        "/project/pages/layout.tsx",
        "/project/pages/dashboard/layout.tsx",
        "/project/pages/dashboard/index.tsx",
      ]);

      const adapter = createMockAdapter(existingFiles);
      const pageFilePath = "/project/pages/dashboard/index.tsx";
      const rootDir = "/project/pages";

      const layouts = await discoverNestedLayouts(
        pageFilePath,
        rootDir,
        projectDir,
        adapter,
      );

      assertEquals(layouts.length, 2, "Should find 2 layouts");
    });
  });
});
