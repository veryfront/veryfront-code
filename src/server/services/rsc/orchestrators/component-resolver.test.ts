import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractParams, resolveComponentPath } from "./component-resolver.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockFs(existingFiles: Set<string>): FileSystemAdapter {
  return {
    stat: async (path: string) => {
      if (existingFiles.has(path)) {
        return { isFile: true, isDirectory: false, size: 100 };
      }
      throw new Deno.errors.NotFound("not found");
    },
    readFile: async () => "",
    exists: async (path: string) => existingFiles.has(path),
  } as unknown as FileSystemAdapter;
}

function createRecordingFs(existingFiles: Set<string>, probedPaths: string[]): FileSystemAdapter {
  return {
    stat: async (path: string) => {
      probedPaths.push(path);
      if (existingFiles.has(path)) {
        return { isFile: true, isDirectory: false, size: 100 };
      }
      throw new Deno.errors.NotFound("not found");
    },
    readFile: async () => "",
    exists: async (path: string) => existingFiles.has(path),
  } as unknown as FileSystemAdapter;
}

describe("server/services/rsc/orchestrators/component-resolver", () => {
  describe("resolveComponentPath", () => {
    it("should resolve root page for index pathname", async () => {
      const fs = createMockFs(new Set(["/project/app/page.tsx"]));
      const result = await resolveComponentPath("/", "/project", fs);
      assertEquals(result, "/project/app/page.tsx");
    });

    it("should resolve root page for empty string", async () => {
      const fs = createMockFs(new Set(["/project/app/page.tsx"]));
      const result = await resolveComponentPath("", "/project", fs);
      assertEquals(result, "/project/app/page.tsx");
    });

    it("should resolve page in subdirectory", async () => {
      const fs = createMockFs(new Set(["/project/app/about/page.tsx"]));
      const result = await resolveComponentPath("/about", "/project", fs);
      assertEquals(result, "/project/app/about/page.tsx");
    });

    it("should resolve .mdx files first (higher priority)", async () => {
      const fs = createMockFs(
        new Set([
          "/project/app/docs/page.mdx",
          "/project/app/docs/page.tsx",
        ]),
      );
      const result = await resolveComponentPath("/docs", "/project", fs);
      assertEquals(result, "/project/app/docs/page.mdx");
    });

    it("should resolve .md files", async () => {
      const fs = createMockFs(new Set(["/project/app/readme/page.md"]));
      const result = await resolveComponentPath("/readme", "/project", fs);
      assertEquals(result, "/project/app/readme/page.md");
    });

    it("should resolve flat file pattern (e.g., app/about.tsx)", async () => {
      const fs = createMockFs(new Set(["/project/app/about.tsx"]));
      const result = await resolveComponentPath("/about", "/project", fs);
      assertEquals(result, "/project/app/about.tsx");
    });

    it("should return null when no matching file exists", async () => {
      const fs = createMockFs(new Set([]));
      const result = await resolveComponentPath("/nonexistent", "/project", fs);
      assertEquals(result, null);
    });

    it("propagates unexpected filesystem failures instead of reporting a false miss", async () => {
      const fs = {
        stat: () => Promise.reject(new Error("private storage failure marker")),
      } as unknown as FileSystemAdapter;

      await assertRejects(
        () => resolveComponentPath("/dashboard", "/project", fs),
        Error,
        "private storage failure marker",
      );
    });

    it("should resolve .jsx files", async () => {
      const fs = createMockFs(new Set(["/project/app/legacy/page.jsx"]));
      const result = await resolveComponentPath("/legacy", "/project", fs);
      assertEquals(result, "/project/app/legacy/page.jsx");
    });

    it("should resolve .js files", async () => {
      const fs = createMockFs(new Set(["/project/app/simple/page.js"]));
      const result = await resolveComponentPath("/simple", "/project", fs);
      assertEquals(result, "/project/app/simple/page.js");
    });

    it("should strip leading slash from pathname", async () => {
      const fs = createMockFs(new Set(["/project/app/test/page.tsx"]));
      const result1 = await resolveComponentPath("/test", "/project", fs);
      const result2 = await resolveComponentPath("test", "/project", fs);
      assertEquals(result1, result2);
    });

    it("should strip _veryfront/rsc/render/ prefix", async () => {
      const fs = createMockFs(new Set(["/project/app/hello/page.tsx"]));
      const result = await resolveComponentPath("/_veryfront/rsc/render/hello", "/project", fs);
      assertEquals(result, "/project/app/hello/page.tsx");
    });

    it("should resolve nested paths", async () => {
      const fs = createMockFs(new Set(["/project/app/docs/api/v2/page.tsx"]));
      const result = await resolveComponentPath("/docs/api/v2", "/project", fs);
      assertEquals(result, "/project/app/docs/api/v2/page.tsx");
    });

    it("resolves routes from the configured app directory", async () => {
      const fs = createMockFs(new Set(["/project/frontend/about/page.tsx"]));
      const result = await resolveComponentPath("/about", "/project", fs, "frontend");
      assertEquals(result, "/project/frontend/about/page.tsx");
    });

    it("rejects traversal and unsafe route syntax before probing the filesystem", async () => {
      const unsafeRoutes = [
        "/../../secret",
        "/safe/../secret",
        "/safe\\..\\secret",
        "/safe/\0secret",
        "//server/share",
        "/safe?next=secret",
        "/safe#secret",
      ];

      for (const route of unsafeRoutes) {
        const probedPaths: string[] = [];
        const fs = createRecordingFs(new Set(["/secret/page.mdx"]), probedPaths);
        const result = await resolveComponentPath(route, "/project", fs);

        assertEquals(result, null, `Expected ${JSON.stringify(route)} to be rejected`);
        assertEquals(
          probedPaths,
          [],
          `Unsafe route ${JSON.stringify(route)} probed the filesystem`,
        );
      }
    });

    it("rejects configured app directories that resolve outside the project", async () => {
      const probedPaths: string[] = [];
      const fs = createRecordingFs(new Set(["/outside/page.tsx"]), probedPaths);
      const result = await resolveComponentPath("/", "/project", fs, "../outside");

      assertEquals(result, null);
      assertEquals(probedPaths, []);
    });
  });

  describe("extractParams", () => {
    it("should return empty object", () => {
      assertEquals(extractParams("/test"), {});
    });

    it("should return empty object for any pathname", () => {
      assertEquals(extractParams("/foo/bar/baz"), {});
    });

    it("should return empty object for empty string", () => {
      assertEquals(extractParams(""), {});
    });
  });
});
