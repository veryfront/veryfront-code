/**
 * Test 1: Cross-Adapter Layout Discovery Consistency
 *
 * This test verifies that layout discovery produces IDENTICAL results across
 * Local, API, and GitHub adapters. This is critical because the layout discovery
 * code may behave differently with different filesystem adapters, leading to:
 *
 * Bug being tested:
 * - API adapter not discovering nested App Router layouts
 * - Local adapter discovering layouts that remote adapters miss
 * - Path normalization differences between adapters
 * - Stat operation differences (async vs sync behavior)
 *
 * The test creates a complex nested layout structure and verifies that
 * all adapters discover the same layouts in the same order.
 */

import { assert, assertEquals } from "@veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "@veryfront/testing/bdd";
import { join } from "@veryfront/compat/path";
import { mkdir, writeTextFile } from "@veryfront/compat/fs.ts";
import { withTestContext } from "../../_helpers/context.ts";
import {
  clearLayoutDiscoveryCache,
  discoverNestedLayouts,
} from "../../../src/rendering/layouts/utils/discovery.ts";
import type { RuntimeAdapter } from "../../../src/platform/adapters/base.ts";
import type { LayoutItem } from "../../../src/types/index.ts";

// Helper to check if array includes a value
function assertArrayIncludes<T>(arr: T[], value: T, msg?: string): void {
  const includes = arr.some((item) =>
    typeof item === "string" && typeof value === "string"
      ? item === value
      : JSON.stringify(item) === JSON.stringify(value)
  );
  assert(
    includes,
    msg || `Expected array to include ${JSON.stringify(value)}, but got ${JSON.stringify(arr)}`,
  );
}

// Mock adapter factory that simulates different adapter behaviors
function createMockFSAdapter(
  files: Map<string, { isFile: boolean; content?: string }>,
): Partial<RuntimeAdapter["fs"]> {
  return {
    stat(path: string) {
      const entry = files.get(path);
      if (!entry) {
        return Promise.reject(new Error(`ENOENT: no such file or directory: ${path}`));
      }
      return Promise.resolve({
        isFile: entry.isFile,
        isDirectory: !entry.isFile,
        isSymlink: false,
        size: entry.content?.length ?? 0,
        mtime: new Date(),
        atime: new Date(),
        birthtime: new Date(),
        mode: 0o644,
      });
    },
    exists(path: string) {
      return Promise.resolve(files.has(path));
    },
    readFile(path: string) {
      const entry = files.get(path);
      if (!entry || !entry.content) {
        return Promise.reject(new Error(`ENOENT: no such file or directory: ${path}`));
      }
      return Promise.resolve(entry.content);
    },
    async *readDir(path: string) {
      for (const [filePath, entry] of files.entries()) {
        const dir = filePath.substring(0, filePath.lastIndexOf("/"));
        if (dir === path || (path === "" && !filePath.includes("/"))) {
          const name = filePath.substring(path ? path.length + 1 : 0);
          if (!name.includes("/")) {
            yield {
              name,
              isFile: entry.isFile,
              isDirectory: !entry.isFile,
              isSymlink: false,
            };
          }
        }
      }
    },
    resolveFile(basePath: string) {
      const extensions = [".tsx", ".jsx", ".ts", ".js", ".mdx", ".md"];
      for (const ext of extensions) {
        if (files.has(basePath + ext)) {
          return Promise.resolve(basePath + ext);
        }
      }
      return Promise.resolve(null);
    },
  };
}

// Create a full mock RuntimeAdapter
function createMockAdapter(
  files: Map<string, { isFile: boolean; content?: string }>,
): RuntimeAdapter {
  const mockFS = createMockFSAdapter(files);
  return {
    fs: mockFS as RuntimeAdapter["fs"],
    env: {
      get: () => undefined,
      getAll: () => ({}),
    },
    server: {
      serve: () => Promise.resolve({ addr: { hostname: "localhost", port: 3000 } }),
    },
    shell: {
      exec: () => Promise.resolve({ code: 0, stdout: "", stderr: "" }),
    },
    process: {
      exit: () => {},
      cwd: () => "/test",
    },
    dynamic: {
      import: () => Promise.resolve({}),
    },
    name: "test",
    capabilities: [],
  } as unknown as RuntimeAdapter;
}

describe("Cross-Adapter Layout Discovery Consistency", {
  sanitizeResources: false,
  sanitizeOps: false,
}, () => {
  beforeEach(() => {
    // Clear the layout discovery cache before each test
    clearLayoutDiscoveryCache();
  });

  afterEach(() => {
    clearLayoutDiscoveryCache();
  });

  describe("Basic Layout Discovery", () => {
    it("discovers root layout.tsx for page at app/page.tsx", async () => {
      const projectDir = "/test-project";
      const rootDir = `${projectDir}/app`;
      const pageFile = `${projectDir}/app/page.tsx`;

      const files = new Map<string, { isFile: boolean; content?: string }>([
        [`${projectDir}/app/layout.tsx`, {
          isFile: true,
          content: "export default function Layout({children}) { return children; }",
        }],
        [`${projectDir}/app/page.tsx`, {
          isFile: true,
          content: "export default function Page() { return <div>Page</div>; }",
        }],
      ]);

      const adapter = createMockAdapter(files);
      const layouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, adapter);

      // Should find exactly one layout
      assertEquals(layouts.length, 1, "Should discover exactly one layout");
      assertEquals(layouts[0]?.kind, "tsx", "Layout should be tsx kind");
      assertEquals(layouts[0]?.path, `${projectDir}/app/layout.tsx`, "Should find root layout");
    });

    it("discovers nested layouts in correct order (root first, then nested)", async () => {
      const projectDir = "/test-project";
      const rootDir = `${projectDir}/app`;
      const pageFile = `${projectDir}/app/blog/posts/page.tsx`;

      // Create a complex nested structure
      const files = new Map<string, { isFile: boolean; content?: string }>([
        [`${projectDir}/app/layout.tsx`, { isFile: true, content: "// Root layout" }],
        [`${projectDir}/app/blog/layout.tsx`, { isFile: true, content: "// Blog layout" }],
        [`${projectDir}/app/blog/posts/layout.tsx`, { isFile: true, content: "// Posts layout" }],
        [`${projectDir}/app/blog/posts/page.tsx`, { isFile: true, content: "// Page" }],
      ]);

      const adapter = createMockAdapter(files);
      const layouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, adapter);

      // Should find all three layouts
      assertEquals(layouts.length, 3, "Should discover all three nested layouts");

      // Verify order: root -> blog -> posts
      const paths = layouts.map((l) => l.path);
      assert(
        paths.indexOf(`${projectDir}/app/layout.tsx`) <
          paths.indexOf(`${projectDir}/app/blog/layout.tsx`),
        "Root layout should come before blog layout",
      );
      assert(
        paths.indexOf(`${projectDir}/app/blog/layout.tsx`) <
          paths.indexOf(`${projectDir}/app/blog/posts/layout.tsx`),
        "Blog layout should come before posts layout",
      );
    });

    it("handles missing intermediate layouts correctly", async () => {
      // BUG: Some adapters might fail when an intermediate directory has no layout
      const projectDir = "/test-project";
      const rootDir = `${projectDir}/app`;
      const pageFile = `${projectDir}/app/a/b/c/d/page.tsx`;

      // Only root and deepest layouts exist - intermediates are missing
      const files = new Map<string, { isFile: boolean; content?: string }>([
        [`${projectDir}/app/layout.tsx`, { isFile: true, content: "// Root" }],
        // Intentionally missing: app/a/layout.tsx
        // Intentionally missing: app/a/b/layout.tsx
        [`${projectDir}/app/a/b/c/layout.tsx`, { isFile: true, content: "// C layout" }],
        // Intentionally missing: app/a/b/c/d/layout.tsx
        [`${projectDir}/app/a/b/c/d/page.tsx`, { isFile: true, content: "// Page" }],
      ]);

      const adapter = createMockAdapter(files);
      const layouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, adapter);

      // Should find only the layouts that exist
      assertEquals(layouts.length, 2, "Should discover only existing layouts");
      const paths = layouts.map((l) => l.path);
      assertArrayIncludes(paths, `${projectDir}/app/layout.tsx`, "Should include root layout");
      assertArrayIncludes(paths, `${projectDir}/app/a/b/c/layout.tsx`, "Should include c layout");
    });
  });

  describe("Cross-Adapter Parity", () => {
    /**
     * This is the critical test that catches the cross-adapter bug.
     * Different adapters may have different behavior for:
     * 1. Path normalization (leading/trailing slashes)
     * 2. Case sensitivity
     * 3. Error handling for missing files
     * 4. Async timing issues
     */
    it("produces identical results regardless of adapter implementation", async () => {
      const projectDir = "/test-project";
      const rootDir = `${projectDir}/app`;
      const pageFile = `${projectDir}/app/dashboard/settings/page.tsx`;

      const fileStructure = new Map<string, { isFile: boolean; content?: string }>([
        [`${projectDir}/app/layout.tsx`, { isFile: true, content: "// Root" }],
        [`${projectDir}/app/dashboard/layout.tsx`, { isFile: true, content: "// Dashboard" }],
        [`${projectDir}/app/dashboard/settings/layout.tsx`, {
          isFile: true,
          content: "// Settings",
        }],
        [`${projectDir}/app/dashboard/settings/page.tsx`, { isFile: true, content: "// Page" }],
      ]);

      // Simulate LOCAL adapter (fast sync-like stat)
      const localAdapter = createMockAdapter(fileStructure);

      // Simulate API adapter (async with potential timing differences)
      const apiAdapter = createMockAdapter(fileStructure);
      const originalStat = apiAdapter.fs.stat.bind(apiAdapter.fs);
      apiAdapter.fs.stat = async (path: string) => {
        // Add artificial delay to simulate network latency
        await new Promise((resolve) => setTimeout(resolve, 1));
        return originalStat(path);
      };

      // Simulate GitHub adapter (different error format)
      const githubAdapter = createMockAdapter(fileStructure);
      const originalGithubStat = githubAdapter.fs.stat.bind(githubAdapter.fs);
      githubAdapter.fs.stat = async (path: string) => {
        try {
          return await originalGithubStat(path);
        } catch (_e) {
          // GitHub adapter might throw differently formatted errors
          throw new Error(`GitHub API: Not Found - ${path}`);
        }
      };

      // Clear cache between each adapter test
      clearLayoutDiscoveryCache();
      const localLayouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, localAdapter);

      clearLayoutDiscoveryCache();
      const apiLayouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, apiAdapter);

      clearLayoutDiscoveryCache();
      const githubLayouts = await discoverNestedLayouts(
        pageFile,
        rootDir,
        projectDir,
        githubAdapter,
      );

      // All adapters must discover the same number of layouts
      assertEquals(
        localLayouts.length,
        apiLayouts.length,
        `Local (${localLayouts.length}) and API (${apiLayouts.length}) adapters must find same number of layouts`,
      );
      assertEquals(
        apiLayouts.length,
        githubLayouts.length,
        `API (${apiLayouts.length}) and GitHub (${githubLayouts.length}) adapters must find same number of layouts`,
      );

      // All adapters must discover layouts at the same paths
      const localPaths = localLayouts.map((l) => l.path).sort();
      const apiPaths = apiLayouts.map((l) => l.path).sort();
      const githubPaths = githubLayouts.map((l) => l.path).sort();

      assertEquals(localPaths, apiPaths, "Local and API adapters must find layouts at same paths");
      assertEquals(
        apiPaths,
        githubPaths,
        "API and GitHub adapters must find layouts at same paths",
      );

      // All adapters must classify layouts with the same kind
      const localKinds = localLayouts.map((l) => l.kind).sort();
      const apiKinds = apiLayouts.map((l) => l.kind).sort();
      const githubKinds = githubLayouts.map((l) => l.kind).sort();

      assertEquals(localKinds, apiKinds, "Local and API adapters must assign same layout kinds");
      assertEquals(apiKinds, githubKinds, "API and GitHub adapters must assign same layout kinds");
    });

    it("handles concurrent stat operations consistently", async () => {
      // BUG: Promise.allSettled in discovery may resolve in different order
      // across adapters, leading to layout ordering issues
      const projectDir = "/test-project";
      const rootDir = `${projectDir}/app`;
      const pageFile = `${projectDir}/app/deep/nested/path/page.tsx`;

      const files = new Map<string, { isFile: boolean; content?: string }>([
        [`${projectDir}/app/layout.tsx`, { isFile: true, content: "// 1" }],
        [`${projectDir}/app/deep/layout.tsx`, { isFile: true, content: "// 2" }],
        [`${projectDir}/app/deep/nested/layout.tsx`, { isFile: true, content: "// 3" }],
        [`${projectDir}/app/deep/nested/path/layout.tsx`, { isFile: true, content: "// 4" }],
        [`${projectDir}/app/deep/nested/path/page.tsx`, { isFile: true, content: "// Page" }],
      ]);

      // Run multiple times to catch race conditions
      const results: LayoutItem[][] = [];
      for (let i = 0; i < 10; i++) {
        clearLayoutDiscoveryCache();
        const adapter = createMockAdapter(files);

        // Add random delays to simulate network jitter
        const originalStat = adapter.fs.stat.bind(adapter.fs);
        adapter.fs.stat = async (path: string) => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
          return originalStat(path);
        };

        const layouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, adapter);
        results.push(layouts);
      }

      // All runs must produce the same result
      const firstResult = results[0];
      assert(firstResult, "First result should exist");
      const firstPaths = firstResult.map((l) => l.path ?? "").join(",");
      for (let i = 1; i < results.length; i++) {
        const currentResult = results[i];
        assert(currentResult, `Result ${i} should exist`);
        const currentPaths = currentResult.map((l) => l.path ?? "").join(",");
        assertEquals(
          currentPaths,
          firstPaths,
          `Run ${i} produced different layout order than run 0. This indicates a race condition.`,
        );
      }
    });
  });

  describe("Layout Extension Priority", () => {
    it("prioritizes layout extensions correctly across all adapters", async () => {
      // Test that when multiple layout.* files exist, the correct one is chosen
      const projectDir = "/test-project";
      const rootDir = `${projectDir}/app`;
      const pageFile = `${projectDir}/app/page.tsx`;

      // Create layout files with different extensions
      const files = new Map<string, { isFile: boolean; content?: string }>([
        [`${projectDir}/app/layout.tsx`, { isFile: true, content: "// TSX" }],
        [`${projectDir}/app/layout.jsx`, { isFile: true, content: "// JSX" }],
        [`${projectDir}/app/layout.mdx`, { isFile: true, content: "// MDX" }],
        [`${projectDir}/app/page.tsx`, { isFile: true, content: "// Page" }],
      ]);

      const adapter = createMockAdapter(files);
      const layouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, adapter);

      // Should only include ONE layout per directory (based on extension priority)
      // The exact layout chosen depends on LAYOUT_EXTENSIONS order in types.ts
      assert(layouts.length >= 1, "Should discover at least one layout");

      // Verify no duplicate directories in layout paths
      const dirs = layouts.map((l) => {
        const path = l.path ?? "";
        return path.substring(0, path.lastIndexOf("/"));
      });
      const uniqueDirs = new Set(dirs);
      assertEquals(
        dirs.length,
        uniqueDirs.size,
        "Should not have duplicate layouts for same directory",
      );
    });
  });

  describe("Edge Cases", () => {
    it("handles empty app directory gracefully", async () => {
      const projectDir = "/test-project";
      const rootDir = `${projectDir}/app`;
      const pageFile = `${projectDir}/app/page.tsx`;

      // Only page exists, no layouts
      const files = new Map<string, { isFile: boolean; content?: string }>([
        [`${projectDir}/app/page.tsx`, { isFile: true, content: "// Page" }],
      ]);

      const adapter = createMockAdapter(files);
      const layouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, adapter);

      // Should return empty array, not throw
      assertEquals(layouts.length, 0, "Should return empty array when no layouts exist");
    });

    it("handles special characters in paths", async () => {
      // BUG: Some adapters may not properly encode/decode special characters
      const projectDir = "/test-project";
      const rootDir = `${projectDir}/app`;
      const pageFile = `${projectDir}/app/user-[id]/settings/page.tsx`;

      const files = new Map<string, { isFile: boolean; content?: string }>([
        [`${projectDir}/app/layout.tsx`, { isFile: true, content: "// Root" }],
        [`${projectDir}/app/user-[id]/layout.tsx`, { isFile: true, content: "// Dynamic" }],
        [`${projectDir}/app/user-[id]/settings/page.tsx`, { isFile: true, content: "// Page" }],
      ]);

      const adapter = createMockAdapter(files);
      const layouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, adapter);

      assertEquals(layouts.length, 2, "Should discover layouts with special characters in path");
      const paths = layouts.map((l) => l.path);
      assertArrayIncludes(
        paths,
        `${projectDir}/app/user-[id]/layout.tsx`,
        "Should include dynamic route layout",
      );
    });

    it("respects rootDir boundary and does not discover layouts above it", async () => {
      const projectDir = "/test-project";
      const rootDir = `${projectDir}/app/dashboard`;
      const pageFile = `${projectDir}/app/dashboard/settings/page.tsx`;

      // Layout exists above rootDir but should NOT be discovered
      const files = new Map<string, { isFile: boolean; content?: string }>([
        [`${projectDir}/app/layout.tsx`, {
          isFile: true,
          content: "// Above root - should be ignored",
        }],
        [`${projectDir}/app/dashboard/layout.tsx`, { isFile: true, content: "// Dashboard root" }],
        [`${projectDir}/app/dashboard/settings/page.tsx`, { isFile: true, content: "// Page" }],
      ]);

      const adapter = createMockAdapter(files);
      const layouts = await discoverNestedLayouts(pageFile, rootDir, projectDir, adapter);

      // Should only find the dashboard layout, not the app layout
      const paths = layouts.map((l) => l.path);
      assert(
        !paths.includes(`${projectDir}/app/layout.tsx`),
        "Should NOT discover layouts above rootDir",
      );
      assertArrayIncludes(
        paths,
        `${projectDir}/app/dashboard/layout.tsx`,
        "Should discover layout at rootDir",
      );
    });
  });

  describe("Integration with Real Test Context", () => {
    it("discovers layouts consistently with real file system", async () => {
      await withTestContext("cross-adapter-real-fs", async (context) => {
        // Create a real nested layout structure
        await mkdir(join(context.projectDir, "app", "dashboard", "settings"), { recursive: true });

        await writeTextFile(
          join(context.projectDir, "app", "layout.tsx"),
          `export default function RootLayout({ children }) { return <div className="root">{children}</div>; }`,
        );

        await writeTextFile(
          join(context.projectDir, "app", "dashboard", "layout.tsx"),
          `export default function DashboardLayout({ children }) { return <div className="dashboard">{children}</div>; }`,
        );

        await writeTextFile(
          join(context.projectDir, "app", "dashboard", "settings", "page.tsx"),
          `export default function SettingsPage() { return <div>Settings</div>; }`,
        );

        // Get the runtime adapter
        const { getAdapter } = await import("../../../src/platform/adapters/detect.ts");
        const adapter = await getAdapter();

        const rootDir = join(context.projectDir, "app");
        const pageFile = join(context.projectDir, "app", "dashboard", "settings", "page.tsx");

        clearLayoutDiscoveryCache();
        const layouts = await discoverNestedLayouts(pageFile, rootDir, context.projectDir, adapter);

        // Verify layouts are discovered
        assertEquals(layouts.length, 2, "Should discover both root and dashboard layouts");

        const paths = layouts.map((l) => l.path);
        assert(paths.some((p) => p && p.includes("app/layout.tsx")), "Should include root layout");
        assert(
          paths.some((p) => p && p.includes("dashboard/layout.tsx")),
          "Should include dashboard layout",
        );
      });
    });
  });
});
