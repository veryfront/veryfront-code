import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path/index.ts";
import {
  buildModuleTransformCacheVariant,
  getModuleCacheKey,
  resolveCachedModulePath,
} from "./module-cache-lookup.ts";
import { MDX_MODULE_DEV_COMPILE_VARIANT } from "#veryfront/transforms/mdx/esm-module-loader/cache-format.ts";

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
      getModuleCacheKey(
        "/project/app/page.tsx",
        "project-id",
        "/project",
        "source-id",
        "19.0.0",
        "production",
      ),
      '["project-id","source-id","19.0.0","production","/project/app/page.tsx"]',
    );
  });

  it("uses projectDir and default source when IDs are unavailable", () => {
    assertEquals(
      getModuleCacheKey("/project/app/page.tsx", undefined, "/project", undefined),
      '["/project","default","19.2.4","default","/project/app/page.tsx"]',
    );
  });

  it("isolates in-memory module paths by React version and runtime mode", () => {
    const base = ["/project/app/page.tsx", "project-id", "/project", "source-id"] as const;
    const react18 = getModuleCacheKey(...base, "18.3.1", "production");
    const react19 = getModuleCacheKey(...base, "19.0.0", "production");
    const development = getModuleCacheKey(...base, "19.0.0", "development");

    assertEquals(new Set([react18, react19, development]).size, 3);
  });

  it("isolates in-memory module paths by dependency-pin state", () => {
    const base = [
      "/project/app/page.tsx",
      "project-id",
      "/project",
      "source-id",
      "19.0.0",
      "production",
    ] as const;
    const flagOff = getModuleCacheKey(...base, "off");
    const unkeyed = getModuleCacheKey(...base);
    const firstPins = getModuleCacheKey(...base, "on:first");
    const changedPins = getModuleCacheKey(...base, "on:second");

    assertEquals(new Set([flagOff, firstPins, changedPins]).size, 3);
    assertEquals(flagOff, unkeyed);
  });

  it("isolates pin-on module paths by origin while preserving flag-off identity", () => {
    const base = [
      "/project/app/page.tsx",
      "project-id",
      "/project",
      "source-id",
      "19.0.0",
      "production",
    ] as const;
    const originA = getModuleCacheKey(...base, "on:snapshot", "https://a.example");
    const originB = getModuleCacheKey(...base, "on:snapshot", "https://b.example");
    const flagOff = getModuleCacheKey(...base, "off");
    const flagOffWithOrigin = getModuleCacheKey(...base, "off", "https://a.example");

    assertEquals(originA === originB, false);
    assertEquals(flagOffWithOrigin, flagOff);
  });

  it("isolates module paths by the configured server external package set", () => {
    const base = [
      "/project/app/page.tsx",
      "project-id",
      "/project",
      "source-id",
      "19.0.0",
      "production",
      "off",
      undefined,
    ] as const;
    const baseline = getModuleCacheKey(...base);
    const knex = getModuleCacheKey(...base, ["knex"]);
    const combined = getModuleCacheKey(...base, ["knex", "@prisma/client"]);
    const reordered = getModuleCacheKey(...base, ["@prisma/client", "knex"]);

    assertEquals(knex === baseline, false);
    assertEquals(combined === knex, false);
    assertEquals(reordered, combined);
    assertEquals(
      buildModuleTransformCacheVariant("off", undefined, ["knex"])?.startsWith(
        "on:server-externals-",
      ),
      true,
    );
  });

  it("carries the compile mode into the artifact cache variant", () => {
    const base = [
      "/project/app/page.tsx",
      "project-id",
      "/project",
      "source-id",
      "19.0.0",
    ] as const;

    // The in-memory key and the on-disk artifact variant have to agree on the
    // compile mode, or a lookup promotes an artifact compiled the other way.
    assertEquals(
      getModuleCacheKey(...base, "development").includes(MDX_MODULE_DEV_COMPILE_VARIANT),
      true,
    );
    assertEquals(
      getModuleCacheKey(...base, "production").includes(MDX_MODULE_DEV_COMPILE_VARIANT),
      false,
    );
    assertEquals(
      buildModuleTransformCacheVariant(undefined, undefined, undefined, true),
      MDX_MODULE_DEV_COMPILE_VARIANT,
    );
    assertEquals(
      buildModuleTransformCacheVariant(undefined, undefined, undefined, false),
      undefined,
    );
  });

  it("looks up MDX-ESM artifacts under the compile mode it may reuse", async () => {
    const observedVariants: Array<string | undefined> = [];
    const lookupWithDev = async (dev: boolean) => {
      await resolveCachedModulePath({
        cacheKey: `cache-key-${dev}`,
        filePath: "/project/app/page.tsx",
        projectDir: "/project",
        projectId: "project-id",
        contentSourceId: "source-id",
        reactVersion: "19.1.0",
        dev,
        moduleCache: new Map<string, string>(),
        lookupMdxCache: (
          _path,
          _cacheDir,
          _projectDir,
          _unused,
          _options,
          _react,
          cacheVariant,
        ) => {
          observedVariants.push(cacheVariant);
          return Promise.resolve({ status: "miss" });
        },
      });
    };

    await lookupWithDev(true);
    await lookupWithDev(false);

    assertEquals(observedVariants, [MDX_MODULE_DEV_COMPILE_VARIANT, undefined]);
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

  it("keeps the fallback filesystem reader bound to its receiver", async () => {
    const moduleCache = new Map([["cache-key", "module.js"]]);

    const fileSystem = {
      prefix: "export",
      readTextFile(path: string): Promise<string> {
        return Promise.resolve(`${this.prefix} const path = ${JSON.stringify(path)};`);
      },
    };

    assertEquals(
      await resolveCachedModulePath({
        cacheKey: "cache-key",
        filePath: "/project/app/page.tsx",
        projectDir: "/project",
        moduleCache,
        fileSystem,
      }),
      "module.js",
    );
    assertEquals(moduleCache.get("cache-key"), "module.js");
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

  it("evicts in-memory entries whose cached file no longer exists", async () => {
    const moduleCache = new Map([["cache-key", "/tmp/gone.js"]]);

    assertEquals(
      await resolveCachedModulePath({
        cacheKey: "cache-key",
        filePath: "/project/app/page.tsx",
        projectDir: "/project",
        moduleCache,
        readTextFile: () => Promise.reject(new Deno.errors.NotFound("gone")),
      }),
      undefined,
      "a cached artifact that no longer exists on disk must not be reused",
    );
    assertEquals(
      moduleCache.has("cache-key"),
      false,
      "the stale in-memory pointer must be evicted so the next load rebuilds",
    );
  });

  it("does not consult the MDX-ESM artifact cache without both project and content-source ids", async () => {
    let lookups = 0;
    const lookupMdxCache = () => {
      lookups += 1;
      return Promise.resolve({ status: "miss" } as const);
    };

    assertEquals(
      await resolveCachedModulePath({
        cacheKey: "cache-key",
        filePath: "/project/app/page.tsx",
        projectDir: "/project",
        projectId: "project-id",
        moduleCache: new Map<string, string>(),
        lookupMdxCache,
      }),
      undefined,
      "a project without a content source has no artifact directory to read",
    );
    assertEquals(
      await resolveCachedModulePath({
        cacheKey: "cache-key",
        filePath: "/project/app/page.tsx",
        projectDir: "/project",
        contentSourceId: "source-id",
        moduleCache: new Map<string, string>(),
        lookupMdxCache,
      }),
      undefined,
      "a content source without a project has no artifact directory to read",
    );
    assertEquals(
      lookups,
      0,
      "artifact lookup must stay scoped to a project and content source",
    );
  });

  it("percent-encodes the content-source id in the artifact cache directory", async () => {
    let observedCacheDir = "";

    await resolveCachedModulePath({
      cacheKey: "cache-key",
      filePath: "/project/app/page.tsx",
      projectDir: "/project",
      projectId: "project-id",
      contentSourceId: "a/../b",
      moduleCache: new Map<string, string>(),
      lookupMdxCache: (_path, cacheDir) => {
        observedCacheDir = cacheDir;
        return Promise.resolve({ status: "miss" });
      },
    });

    assertEquals(
      observedCacheDir.endsWith("/project-id/a%2F..%2Fb"),
      true,
      "content-source id must not escape its project cache directory",
    );
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
