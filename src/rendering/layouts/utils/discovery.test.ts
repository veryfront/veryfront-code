import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearLayoutDiscoveryCache,
  discoverNestedLayouts,
  getLayoutDiscoveryCacheStats,
} from "./discovery.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(
  existingFiles: Set<string> = new Set(),
  options: { statCalls?: string[]; statError?: Error; symlinks?: Set<string> } = {},
): RuntimeAdapter {
  return {
    fs: {
      readFile: async (path: string) => {
        if (existingFiles.has(path)) return `content of ${path}`;
        throw new Error(`File not found: ${path}`);
      },
      exists: async (path: string) => existingFiles.has(path),
      readDir: async function* () {},
      writeFile: async () => {},
      mkdir: async () => {},
      stat: async (path: string) => {
        options.statCalls?.push(path);
        if (options.statError) throw options.statError;
        if (existingFiles.has(path)) {
          return {
            isFile: true,
            isDirectory: false,
            isSymlink: options.symlinks?.has(path) ?? false,
            size: 100,
          };
        }
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
      },
      remove: async () => {},
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

describe("rendering/layouts/utils/discovery", () => {
  describe("clearLayoutDiscoveryCache", () => {
    it("should clear entire cache when no projectDir given", () => {
      clearLayoutDiscoveryCache();
      const stats = getLayoutDiscoveryCacheStats();
      assertEquals(stats.size, 0);
    });

    it("should clear cache for specific project", () => {
      clearLayoutDiscoveryCache("/project");
    });
  });

  describe("getLayoutDiscoveryCacheStats", () => {
    it("should return size and maxSize", () => {
      const stats = getLayoutDiscoveryCacheStats();
      assertEquals(typeof stats.size, "number");
      assertEquals(typeof stats.maxSize, "number");
      assertEquals(stats.maxSize, 500);
    });
  });

  describe("discoverNestedLayouts", () => {
    it("should return empty array when no layout files exist", async () => {
      const adapter = createMockAdapter();
      clearLayoutDiscoveryCache();
      const layouts = await discoverNestedLayouts(
        "/project/pages/index.mdx",
        "/project",
        "/project",
        adapter,
      );
      assertEquals(layouts.length, 0);
    });

    it("should discover mdx layout in same directory", async () => {
      const files = new Set(["/project/pages/layout.mdx"]);
      const adapter = createMockAdapter(files);
      clearLayoutDiscoveryCache();
      const layouts = await discoverNestedLayouts(
        "/project/pages/index.mdx",
        "/project",
        "/project",
        adapter,
      );
      assertEquals(layouts.length, 1);
      assertEquals(layouts[0]!.kind, "mdx");
      assertEquals(layouts[0]!.path, "/project/pages/layout.mdx");
    });

    it("should discover tsx layout in same directory", async () => {
      const files = new Set(["/project/pages/layout.tsx"]);
      const adapter = createMockAdapter(files);
      clearLayoutDiscoveryCache();
      const layouts = await discoverNestedLayouts(
        "/project/pages/index.mdx",
        "/project",
        "/project",
        adapter,
      );
      assertEquals(layouts.length, 1);
      assertEquals(layouts[0]!.kind, "tsx");
    });

    it("should discover layout in root directory", async () => {
      const files = new Set(["/project/layout.mdx"]);
      const adapter = createMockAdapter(files);
      clearLayoutDiscoveryCache();
      const layouts = await discoverNestedLayouts(
        "/project/pages/index.mdx",
        "/project",
        "/project",
        adapter,
      );
      assertEquals(layouts.length, 1);
      assertEquals(layouts[0]!.path, "/project/layout.mdx");
    });

    it("should discover layouts in ancestor directories", async () => {
      const files = new Set([
        "/project/pages/blog/layout.mdx",
        "/project/pages/layout.tsx",
      ]);
      const adapter = createMockAdapter(files);
      clearLayoutDiscoveryCache();
      const layouts = await discoverNestedLayouts(
        "/project/pages/blog/post.mdx",
        "/project",
        "/project",
        adapter,
      );
      assertEquals(layouts.length >= 1, true);
    });

    it("should use cache on repeated calls", async () => {
      const files = new Set(["/project/layout.mdx"]);
      const adapter = createMockAdapter(files);
      clearLayoutDiscoveryCache();

      const layouts1 = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
      );
      const layouts2 = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
      );
      assertEquals(layouts1.length, layouts2.length);
      const stats = getLayoutDiscoveryCacheStats();
      assertEquals(stats.size >= 1, true);
    });

    it("should handle deeply nested page paths", async () => {
      const adapter = createMockAdapter(new Set());
      clearLayoutDiscoveryCache();
      const layouts = await discoverNestedLayouts(
        "/project/a/b/c/d/e/page.mdx",
        "/project",
        "/project",
        adapter,
      );
      assertEquals(Array.isArray(layouts), true);
    });

    it("does not scan a sibling path that merely shares the root prefix", async () => {
      const statCalls: string[] = [];
      const adapter = createMockAdapter(new Set(["/project/layout.mdx"]), { statCalls });
      clearLayoutDiscoveryCache();

      const layouts = await discoverNestedLayouts(
        "/project-other/page.mdx",
        "/project",
        "/project",
        adapter,
      );

      assertEquals(layouts, []);
      assertEquals(statCalls, []);
    });

    it("returns defensive copies from the discovery cache", async () => {
      const adapter = createMockAdapter(new Set(["/project/layout.mdx"]));
      clearLayoutDiscoveryCache();

      const first = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
      );
      first.length = 0;
      const second = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
      );

      assertEquals(second.length, 1);
    });

    it("propagates filesystem failures other than missing candidates", async () => {
      const failure = Object.assign(new Error("permission denied"), { code: "EACCES" });
      const adapter = createMockAdapter(new Set(), { statError: failure });
      clearLayoutDiscoveryCache();

      await assertRejects(
        () =>
          discoverNestedLayouts(
            "/project/page.mdx",
            "/project",
            "/project",
            adapter,
          ),
        Error,
        "permission denied",
      );
    });

    it("does not load symlink layout candidates", async () => {
      const file = "/project/layout.mdx";
      const adapter = createMockAdapter(new Set([file]), { symlinks: new Set([file]) });
      clearLayoutDiscoveryCache();

      assertEquals(
        await discoverNestedLayouts("/project/page.mdx", "/project", "/project", adapter),
        [],
      );
    });
  });
});
