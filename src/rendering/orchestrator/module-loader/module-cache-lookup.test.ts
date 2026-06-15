import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { getModuleCacheKey, resolveCachedModulePath } from "./module-cache-lookup.ts";

async function withCachedFile<T>(
  content: string,
  test: (path: string) => Promise<T>,
): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "vf-module-cache-lookup-" });
  const path = join(dir, "module.js");
  await Deno.writeTextFile(path, content);

  try {
    return await test(path);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  }
}

describe("module-loader/module-cache-lookup", () => {
  it("builds a stable cache key scoped by project, source, and file path", () => {
    assertEquals(
      getModuleCacheKey("/project/app/page.tsx", "project-id", "/project", "source-id"),
      "project-id:source-id:/project/app/page.tsx",
    );
  });

  it("uses projectDir and default source when IDs are unavailable", () => {
    assertEquals(
      getModuleCacheKey("/project/app/page.tsx", undefined, "/project", undefined),
      "/project:default:/project/app/page.tsx",
    );
  });

  it("returns a valid in-memory cached module path", async () => {
    await withCachedFile("export const ok = true;", async (cachedPath) => {
      const moduleCache = new Map([["cache-key", cachedPath]]);

      assertEquals(
        await resolveCachedModulePath({
          cacheKey: "cache-key",
          filePath: "/project/app/page.tsx",
          projectDir: "/project",
          moduleCache,
        }),
        cachedPath,
      );
      assertEquals(moduleCache.get("cache-key"), cachedPath);
    });
  });

  it("invalidates in-memory cached modules that still contain unresolved vf imports", async () => {
    await withCachedFile(`import x from "/_vf_modules/react.js";`, async (cachedPath) => {
      const moduleCache = new Map([["cache-key", cachedPath]]);

      assertEquals(
        await resolveCachedModulePath({
          cacheKey: "cache-key",
          filePath: "/project/app/page.tsx",
          projectDir: "/project",
          moduleCache,
        }),
        undefined,
      );
      assertEquals(moduleCache.has("cache-key"), false);
    });
  });

  it("promotes an MDX-ESM cache hit into the in-memory cache", async () => {
    const moduleCache = new Map<string, string>();

    const cachedPath = await resolveCachedModulePath({
      cacheKey: "cache-key",
      filePath: "/project/app/page.tsx",
      projectDir: "/project",
      projectId: "project-id",
      contentSourceId: "source-id",
      reactVersion: "19.1.0",
      moduleCache,
      lookupMdxCache: (path, cacheDir, projectDir, _unused, options, reactVersion) => {
        assertEquals(path, "/project/app/page.tsx");
        assertEquals(cacheDir.endsWith("/project-id/source-id"), true);
        assertEquals(projectDir, "/project");
        assertEquals(options, { projectId: "project-id", contentSourceId: "source-id" });
        assertEquals(reactVersion, "19.1.0");
        return Promise.resolve({ status: "hit", path: "/cache/page.js" });
      },
    });

    assertEquals(cachedPath, "/cache/page.js");
    assertEquals(moduleCache.get("cache-key"), "/cache/page.js");
  });
});
