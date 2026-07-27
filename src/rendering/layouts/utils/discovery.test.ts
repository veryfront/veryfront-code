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
        if (existingFiles.has(path)) {
          return { isFile: true, isDirectory: false, size: 100 };
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
      assertEquals(layouts[0]?.kind, "mdx");
      assertEquals(layouts[0]?.path, "/project/pages/layout.mdx");
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
      assertEquals(layouts[0]?.kind, "tsx");
    });

    it("uses declared extension priority when a directory has multiple layouts", async () => {
      const files = new Set([
        "/project/pages/layout.mdx",
        "/project/pages/layout.tsx",
      ]);
      const adapter = createMockAdapter(files);
      clearLayoutDiscoveryCache();

      const layouts = await discoverNestedLayouts(
        "/project/pages/index.mdx",
        "/project",
        "/project",
        adapter,
      );

      assertEquals(layouts, [{
        kind: "mdx",
        path: "/project/pages/layout.mdx",
      }]);
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
      assertEquals(layouts[0]?.path, "/project/layout.mdx");
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

    it("canonicalizes trailing directory separators in cache identities", async () => {
      const adapter = createMockAdapter(new Set(["/project/app/layout.mdx"]));
      const originalStat = adapter.fs.stat.bind(adapter.fs);
      let statCalls = 0;
      adapter.fs.stat = (path) => {
        statCalls++;
        return originalStat(path);
      };
      clearLayoutDiscoveryCache();

      await discoverNestedLayouts(
        "/project/app/page.mdx",
        "/project/app",
        "/project",
        adapter,
      );
      const callsAfterFirstDiscovery = statCalls;
      await discoverNestedLayouts(
        "/project/app/page.mdx",
        "/project/app/",
        "/project/",
        adapter,
      );

      assertEquals(statCalls, callsAfterFirstDiscovery);
    });

    it("does not republish an in-flight result after project cache clearing", async () => {
      const files = new Set(["/project/layout.mdx"]);
      const adapter = createMockAdapter(files);
      const originalStat = adapter.fs.stat.bind(adapter.fs);
      const firstLayoutStat = Promise.withResolvers<void>();
      const releaseFirstLayoutStat = Promise.withResolvers<void>();
      let delayFirstLayoutStat = true;
      adapter.fs.stat = async (path) => {
        if (delayFirstLayoutStat && path === "/project/layout.mdx") {
          delayFirstLayoutStat = false;
          firstLayoutStat.resolve();
          await releaseFirstLayoutStat.promise;
        }
        return await originalStat(path);
      };
      clearLayoutDiscoveryCache();

      const staleDiscovery = discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
      );
      await firstLayoutStat.promise;
      clearLayoutDiscoveryCache("/project");
      releaseFirstLayoutStat.resolve();
      assertEquals((await staleDiscovery)[0]?.kind, "mdx");

      files.clear();
      files.add("/project/layout.tsx");
      const freshDiscovery = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
      );

      assertEquals(freshDiscovery[0]?.kind, "tsx");
    });

    it("does not expose mutable cached layout containers to callers", async () => {
      const adapter = createMockAdapter(new Set(["/project/layout.mdx"]));
      clearLayoutDiscoveryCache();

      const first = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
      );
      first[0]!.path = "/mutated/layout.mdx";
      first.push({ kind: "mdx", path: "/injected/layout.mdx" });

      const second = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
      );

      assertEquals(second, [{
        kind: "mdx",
        path: "/project/layout.mdx",
      }]);
    });

    it("isolates identical discovery paths across adapter instances", async () => {
      const mdxAdapter = createMockAdapter(new Set(["/project/layout.mdx"]));
      const tsxAdapter = createMockAdapter(new Set(["/project/layout.tsx"]));
      clearLayoutDiscoveryCache();

      const mdxLayouts = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        mdxAdapter,
      );
      const tsxLayouts = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        tsxAdapter,
      );

      assertEquals(mdxLayouts[0]?.kind, "mdx");
      assertEquals(tsxLayouts[0]?.kind, "tsx");
    });

    it("isolates content snapshots exposed through one adapter instance", async () => {
      const files = new Set(["/project/layout.mdx"]);
      const adapter = createMockAdapter(files);
      clearLayoutDiscoveryCache();

      const branchLayouts = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
        { cacheScope: "branch:main" },
      );
      files.clear();
      files.add("/project/layout.tsx");
      const releaseLayouts = await discoverNestedLayouts(
        "/project/page.mdx",
        "/project",
        "/project",
        adapter,
        { cacheScope: "release:v1" },
      );

      assertEquals(branchLayouts[0]?.kind, "mdx");
      assertEquals(releaseLayouts[0]?.kind, "tsx");
    });

    it("propagates operational stat failures instead of publishing a partial result", async () => {
      const adapter = createMockAdapter();
      adapter.fs.stat = () =>
        Promise.reject(Object.assign(new Error("backend unavailable"), { code: "EIO" }));
      clearLayoutDiscoveryCache();

      await assertRejects(
        () =>
          discoverNestedLayouts(
            "/project/pages/index.mdx",
            "/project",
            "/project",
            adapter,
          ),
        Error,
        "backend unavailable",
      );
      assertEquals(getLayoutDiscoveryCacheStats().size, 0);
    });

    it("does not inspect prefix-colliding directories outside the router root", async () => {
      let statCalls = 0;
      const adapter = createMockAdapter(new Set(["/project/application/layout.mdx"]));
      const originalStat = adapter.fs.stat.bind(adapter.fs);
      adapter.fs.stat = (path) => {
        statCalls += 1;
        return originalStat(path);
      };
      clearLayoutDiscoveryCache();

      const layouts = await discoverNestedLayouts(
        "/project/application/page.mdx",
        "/project/app",
        "/project",
        adapter,
      );

      assertEquals(layouts, []);
      assertEquals(statCalls, 0);
    });

    it("does not alias distinct layout identities when their legacy hashes collide", async () => {
      const firstProject = "/project-1282ds3";
      const secondProject = "/project-wkck55";
      const adapter = createMockAdapter(
        new Set([
          `${firstProject}/layout.mdx`,
          `${secondProject}/layout.tsx`,
        ]),
      );
      clearLayoutDiscoveryCache();

      const first = await discoverNestedLayouts(
        `${firstProject}/pages/index.mdx`,
        firstProject,
        firstProject,
        adapter,
      );
      const second = await discoverNestedLayouts(
        `${secondProject}/pages/index.mdx`,
        secondProject,
        secondProject,
        adapter,
      );

      assertEquals(first[0]?.kind, "mdx");
      assertEquals(first[0]?.path, `${firstProject}/layout.mdx`);
      assertEquals(second[0]?.kind, "tsx");
      assertEquals(second[0]?.path, `${secondProject}/layout.tsx`);
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

    it("bounds adversarially deep ancestor scans", async () => {
      const nestedPath = Array.from({ length: 257 }, (_, index) => `d${index}`).join("/");
      const adapter = createMockAdapter();
      clearLayoutDiscoveryCache();

      await assertRejects(
        () =>
          discoverNestedLayouts(
            `/project/${nestedPath}/page.mdx`,
            "/project",
            "/project",
            adapter,
          ),
        RangeError,
        "ancestor limit",
      );
    });
  });
});
