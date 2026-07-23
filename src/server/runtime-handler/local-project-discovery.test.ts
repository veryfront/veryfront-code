import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";
import { resolve } from "#veryfront/compat/path/index.ts";
import {
  defaultDiscoveryCache,
  findLocalProjectPath,
  ProjectDiscoveryCache,
  standardProjectDirs,
} from "./local-project-discovery.ts";

const localProjectCache = defaultDiscoveryCache.projects;
const localAdapterCache = defaultDiscoveryCache.adapters;

describe("local-project-discovery", () => {
  // Clear caches after each test to prevent state leakage
  afterEach(() => {
    localProjectCache.clear();
    localAdapterCache.clear();
    __resetLogRecordEmitterForTests();
  });

  describe("constants", () => {
    it("has expected standard project directories", () => {
      assertEquals(standardProjectDirs, ["data/projects", "projects"]);
    });
  });

  describe("cache exports", () => {
    it("exports defaultDiscoveryCache.adapters with Map-like interface", () => {
      assertEquals(typeof defaultDiscoveryCache.adapters.get, "function");
      assertEquals(typeof defaultDiscoveryCache.adapters.set, "function");
      assertEquals(typeof defaultDiscoveryCache.adapters.clear, "function");
    });

    it("exports defaultDiscoveryCache.projects with Map-like interface", () => {
      assertEquals(typeof defaultDiscoveryCache.projects.get, "function");
      assertEquals(typeof defaultDiscoveryCache.projects.set, "function");
      assertEquals(typeof defaultDiscoveryCache.projects.clear, "function");
    });
  });

  describe("findLocalProjectPath", () => {
    // Create a minimal mock adapter
    function createMockAdapter(
      files: Record<string, { isDirectory: boolean }>,
      onStat?: (path: string) => void,
    ): RuntimeAdapter {
      return {
        fs: {
          stat: async (path: string) => {
            onStat?.(path);
            const entry = files[path];
            if (!entry) return null;
            return { isDirectory: entry.isDirectory };
          },
          readFile: async () => new Uint8Array(),
          readTextFile: async () => "",
          writeFile: async () => {},
          writeTextFile: async () => {},
          remove: async () => {},
          mkdir: async () => {},
          readDir: async function* () {},
          exists: async () => false,
          copy: async () => {},
          rename: async () => {},
        },
        tmpdir: () => "/tmp",
        homedir: () => "/home",
        env: {
          get: () => undefined,
          set: () => {},
          delete: () => {},
          has: () => false,
          toObject: () => ({}),
        },
        getIpAddress: () => "127.0.0.1",
        getHostname: () => "localhost",
      } as unknown as RuntimeAdapter;
    }

    it("accepts headerPath only when it points to a valid project directory", async () => {
      const adapter = createMockAdapter({
        "/custom/path": { isDirectory: true },
        "/custom/path/app": { isDirectory: true },
      });
      const path = await findLocalProjectPath("myproject", adapter, "/custom/path");

      assertEquals(path, "/custom/path");
      assertEquals(localProjectCache.get("myproject"), "/custom/path");
    });

    it("accepts a headerPath project that declares custom source directories", async () => {
      const adapter = createMockAdapter({
        "/custom/path": { isDirectory: true },
        "/custom/path/veryfront.config.ts": { isDirectory: false },
      });

      const path = await findLocalProjectPath("custom-roots", adapter, "/custom/path");

      assertEquals(path, "/custom/path");
    });

    it("ignores invalid headerPath override", async () => {
      const adapter = createMockAdapter({
        "/custom/path": { isDirectory: true },
        // Missing app/pages/components
      });

      const path = await findLocalProjectPath("myproject", adapter, "/custom/path");

      assertEquals(path, undefined);
      assertEquals(localProjectCache.has("myproject"), false);
    });

    it("propagates unexpected explicit-path filesystem failures without logging details", async () => {
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      const adapter = createMockAdapter({});
      adapter.fs.stat = () => {
        throw new Error("private filesystem failure at /private/path");
      };

      await assertRejects(
        () => findLocalProjectPath("private-project", adapter, "/private/path"),
        Error,
        "private filesystem failure",
      );

      const serialized = JSON.stringify(entries);
      assertEquals(serialized.includes("private-project"), false);
      assertEquals(serialized.includes("/private/path"), false);
      assertEquals(serialized.includes("private filesystem failure"), false);
    });

    it("propagates unexpected project marker lookup failures", async () => {
      const adapter = createMockAdapter({
        "/custom/path": { isDirectory: true },
      });
      adapter.fs.stat = (path: string) => {
        if (path === "/custom/path") {
          return Promise.resolve({ isDirectory: true } as never);
        }
        throw Object.assign(new Error("permission denied"), { code: "EACCES" });
      };

      await assertRejects(
        () => findLocalProjectPath("custom", adapter, "/custom/path"),
        Error,
        "permission denied",
      );
    });

    it("returns cached path if available", async () => {
      const adapter = createMockAdapter({});
      localProjectCache.set("cached-project", "/cached/path");

      const path = await findLocalProjectPath("cached-project", adapter);

      assertEquals(path, "/cached/path");
    });

    it("rejects unsafe slugs before probing the filesystem or cache", async () => {
      const statPaths: string[] = [];
      const adapter = createMockAdapter({
        "/custom/path": { isDirectory: true },
        "/custom/path/app": { isDirectory: true },
      }, (path) => statPaths.push(path));
      const cache = new ProjectDiscoveryCache();

      for (
        const slug of [
          "../escape",
          "../../escape",
          "nested/project",
          "nested\\project",
          "%2e%2e%2fescape",
          ".",
          "..",
        ]
      ) {
        assertEquals(
          await findLocalProjectPath(slug, adapter, "/custom/path", cache),
          undefined,
        );
      }

      assertEquals(statPaths, []);
      assertEquals(cache.projects.size, 0);
    });

    it("canonicalizes a safe slug before discovery and caching", async () => {
      const adapter = createMockAdapter({
        "data/projects/project-one": { isDirectory: true },
        "data/projects/project-one/app": { isDirectory: true },
      });
      const cache = new ProjectDiscoveryCache();

      const path = await findLocalProjectPath("  project-one  ", adapter, undefined, cache);

      assertEquals(path?.endsWith("data/projects/project-one"), true);
      assertEquals(cache.projects.has("project-one"), true);
      assertEquals(cache.projects.has("  project-one  "), false);
    });

    it("rejects symlink targets outside standard project roots before stat", async () => {
      const statPaths: string[] = [];
      const adapter = createMockAdapter({}, (path) => statPaths.push(path));
      adapter.fs.realPath = (path) => {
        for (const dir of standardProjectDirs) {
          const root = resolve(cwd(), dir);
          if (path === resolve(root, "linked-project")) {
            return Promise.resolve(resolve(cwd(), "outside/linked-project"));
          }
        }
        return Promise.resolve(path);
      };
      const cache = new ProjectDiscoveryCache();

      const path = await findLocalProjectPath("linked-project", adapter, undefined, cache);

      assertEquals(path, undefined);
      assertEquals(statPaths, []);
      assertEquals(cache.projects.has("linked-project"), false);
    });

    it("discovers project with app directory", async () => {
      const adapter = createMockAdapter({
        "data/projects/myapp": { isDirectory: true },
        "data/projects/myapp/app": { isDirectory: true },
      });

      const path = await findLocalProjectPath("myapp", adapter);

      // Should find and cache the project
      assertEquals(path?.endsWith("data/projects/myapp"), true);
      assertEquals(localProjectCache.has("myapp"), true);
    });

    it("discovers project with pages directory", async () => {
      const adapter = createMockAdapter({
        "projects/blog": { isDirectory: true },
        "projects/blog/pages": { isDirectory: true },
      });

      const path = await findLocalProjectPath("blog", adapter);

      assertEquals(path?.endsWith("projects/blog"), true);
    });

    it("discovers project with components directory", async () => {
      const adapter = createMockAdapter({
        "projects/demo": { isDirectory: true },
        "projects/demo/components": { isDirectory: true },
      });

      const path = await findLocalProjectPath("demo", adapter);

      assertEquals(path?.endsWith("projects/demo"), true);
    });

    it("discovers a project whose source roots are configured", async () => {
      const adapter = createMockAdapter({
        "projects/custom": { isDirectory: true },
        "projects/custom/veryfront.config.mjs": { isDirectory: false },
      });

      const path = await findLocalProjectPath("custom", adapter);

      assertEquals(path?.endsWith("projects/custom"), true);
    });

    it("returns undefined for non-existent project", async () => {
      const adapter = createMockAdapter({});

      const path = await findLocalProjectPath("nonexistent", adapter);

      assertEquals(path, undefined);
    });

    it("skips directories without app/pages/components", async () => {
      const adapter = createMockAdapter({
        "data/projects/empty": { isDirectory: true },
        // No app, pages, or components subdirs
      });

      const path = await findLocalProjectPath("empty", adapter);

      assertEquals(path, undefined);
    });

    it("searches directories in order", async () => {
      // Project exists in both data/projects and projects
      const adapter = createMockAdapter({
        "data/projects/myproject": { isDirectory: true },
        "data/projects/myproject/app": { isDirectory: true },
        "projects/myproject": { isDirectory: true },
        "projects/myproject/app": { isDirectory: true },
      });

      const path = await findLocalProjectPath("myproject", adapter);

      // Should find in data/projects first (earlier in standardProjectDirs)
      assertEquals(path?.includes("data/projects/myproject"), true);
    });
  });

  describe("ProjectDiscoveryCache", () => {
    it("creates independent project and adapter caches", () => {
      const cache = new ProjectDiscoveryCache();
      assertEquals(typeof cache.projects.get, "function");
      assertEquals(typeof cache.projects.set, "function");
      assertEquals(typeof cache.adapters.get, "function");
      assertEquals(typeof cache.adapters.set, "function");
    });

    it("clear() empties both caches", () => {
      const cache = new ProjectDiscoveryCache();
      cache.projects.set("slug", "/path");
      cache.adapters.set("/path", {} as RuntimeAdapter);
      assertEquals(cache.projects.has("slug"), true);
      assertEquals(cache.adapters.has("/path"), true);

      cache.clear();

      assertEquals(cache.projects.has("slug"), false);
      assertEquals(cache.adapters.has("/path"), false);
    });

    it("respects custom capacity limits", () => {
      const cache = new ProjectDiscoveryCache({ maxProjects: 2, maxAdapters: 1 });
      cache.projects.set("a", "/a");
      cache.projects.set("b", "/b");
      cache.projects.set("c", "/c"); // should evict "a"
      assertEquals(cache.projects.has("a"), false);
      assertEquals(cache.projects.has("c"), true);
    });

    it("injected cache isolates state from default singleton", () => {
      const isolated = new ProjectDiscoveryCache();
      isolated.projects.set("isolated-slug", "/isolated/path");

      // Default cache should not see it
      assertEquals(localProjectCache.has("isolated-slug"), false);
      // Isolated cache should have it
      assertEquals(isolated.projects.get("isolated-slug"), "/isolated/path");
    });
  });

  describe("findLocalProjectPath with injected cache", () => {
    function createMockAdapter(
      files: Record<string, { isDirectory: boolean }>,
    ): RuntimeAdapter {
      return {
        fs: {
          stat: async (path: string) => {
            const entry = files[path];
            if (!entry) return null;
            return { isDirectory: entry.isDirectory };
          },
          readFile: async () => new Uint8Array(),
          readTextFile: async () => "",
          writeFile: async () => {},
          writeTextFile: async () => {},
          remove: async () => {},
          mkdir: async () => {},
          readDir: async function* () {},
          exists: async () => false,
          copy: async () => {},
          rename: async () => {},
        },
        tmpdir: () => "/tmp",
        homedir: () => "/home",
        env: {
          get: () => undefined,
          set: () => {},
          delete: () => {},
          has: () => false,
          toObject: () => ({}),
        },
        getIpAddress: () => "127.0.0.1",
        getHostname: () => "localhost",
      } as unknown as RuntimeAdapter;
    }

    it("populates injected cache on discovery", async () => {
      const cache = new ProjectDiscoveryCache();
      const adapter = createMockAdapter({
        "data/projects/myapp": { isDirectory: true },
        "data/projects/myapp/app": { isDirectory: true },
      });

      const path = await findLocalProjectPath("myapp", adapter, undefined, cache);

      assertEquals(path?.endsWith("data/projects/myapp"), true);
      assertEquals(cache.projects.has("myapp"), true);
      // Default singleton should not be affected
      assertEquals(localProjectCache.has("myapp"), false);
    });

    it("returns cached path from injected cache on cache hit", async () => {
      const cache = new ProjectDiscoveryCache();
      cache.projects.set("cached", "/injected/cached/path");

      const adapter = createMockAdapter({});
      const path = await findLocalProjectPath("cached", adapter, undefined, cache);

      assertEquals(path, "/injected/cached/path");
    });

    it("returns undefined on cache miss with no matching directories", async () => {
      const cache = new ProjectDiscoveryCache();
      const adapter = createMockAdapter({});

      const path = await findLocalProjectPath("missing", adapter, undefined, cache);

      assertEquals(path, undefined);
      assertEquals(cache.projects.has("missing"), false);
    });

    it("populates injected cache when headerPath is valid", async () => {
      const cache = new ProjectDiscoveryCache();
      const adapter = createMockAdapter({
        "/header/path": { isDirectory: true },
        "/header/path/pages": { isDirectory: true },
      });

      const path = await findLocalProjectPath("proj", adapter, "/header/path", cache);

      assertEquals(path, "/header/path");
      assertEquals(cache.projects.get("proj"), "/header/path");
      assertEquals(localProjectCache.has("proj"), false);
    });
  });
});
