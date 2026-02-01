import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  findLocalProjectPath,
  localAdapterCache,
  localProjectCache,
  standardProjectDirs,
} from "./local-project-discovery.ts";

describe("local-project-discovery", () => {
  // Clear caches after each test to prevent state leakage
  afterEach(() => {
    localProjectCache.clear();
    localAdapterCache.clear();
  });

  describe("constants", () => {
    it("has expected standard project directories", () => {
      assertEquals(standardProjectDirs, ["data/projects", "projects", "examples"]);
    });
  });

  describe("cache exports", () => {
    it("exports localAdapterCache with Map-like interface", () => {
      assertEquals(typeof localAdapterCache.get, "function");
      assertEquals(typeof localAdapterCache.set, "function");
      assertEquals(typeof localAdapterCache.clear, "function");
    });

    it("exports localProjectCache with Map-like interface", () => {
      assertEquals(typeof localProjectCache.get, "function");
      assertEquals(typeof localProjectCache.set, "function");
      assertEquals(typeof localProjectCache.clear, "function");
    });
  });

  describe("findLocalProjectPath", () => {
    // Create a minimal mock adapter
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

    it("returns headerPath immediately if provided", async () => {
      const adapter = createMockAdapter({});
      const path = await findLocalProjectPath("myproject", adapter, "/custom/path");

      assertEquals(path, "/custom/path");
      assertEquals(localProjectCache.get("myproject"), "/custom/path");
    });

    it("returns cached path if available", async () => {
      const adapter = createMockAdapter({});
      localProjectCache.set("cached-project", "/cached/path");

      const path = await findLocalProjectPath("cached-project", adapter);

      assertEquals(path, "/cached/path");
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
        "examples/demo": { isDirectory: true },
        "examples/demo/components": { isDirectory: true },
      });

      const path = await findLocalProjectPath("demo", adapter);

      assertEquals(path?.endsWith("examples/demo"), true);
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
      // Project exists in both data/projects and examples
      const adapter = createMockAdapter({
        "data/projects/myproject": { isDirectory: true },
        "data/projects/myproject/app": { isDirectory: true },
        "examples/myproject": { isDirectory: true },
        "examples/myproject/app": { isDirectory: true },
      });

      const path = await findLocalProjectPath("myproject", adapter);

      // Should find in data/projects first (earlier in standardProjectDirs)
      assertEquals(path?.includes("data/projects/myproject"), true);
    });
  });
});
