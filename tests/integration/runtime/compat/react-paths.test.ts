import { readProjectDependencyVersions } from "#veryfront/transforms/esm/package-registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearReactPathsCache,
  getLocalReactPaths,
} from "#veryfront/platform/compat/react-paths.ts";
import { isBun, isNode } from "#veryfront/platform/compat/runtime.ts";
import { createRequire } from "node:module";
import Module from "node:module";
import fs, { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveInstalledReactRange } from "#veryfront/platform/compat/react-paths.ts";
import {
  resolveProjectPackageVersions,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import { getLocalReactPath } from "#veryfront/platform/compat/react-paths.ts";

function overrideInstalledVersion(
  packageName: string,
  version: string,
  identity?: string,
): () => void {
  const syncBuiltinESMExports = Reflect.get(Module, "syncBuiltinESMExports") as () => void;
  const original = fs.readFileSync;
  fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    const content = Reflect.apply(original, fs, args);
    if (String(args[0]).endsWith(`/${packageName}/package.json`)) {
      const manifest = JSON.parse(String(content));
      manifest.version = version;
      if (identity !== undefined) manifest.name = identity;
      return JSON.stringify(manifest);
    }
    return content;
  }) as typeof fs.readFileSync;
  syncBuiltinESMExports();
  return () => {
    fs.readFileSync = original;
    syncBuiltinESMExports();
  };
}

describe("react-paths", () => {
  it("resolves Bun peers from the SDK when the working directory has no dependencies", () => {
    if (!isBun) return;
    const originalDirectory = process.cwd();
    const temporaryDirectory = mkdtempSync(join(tmpdir(), "sdk-react-anchor-"));
    try {
      process.chdir(temporaryDirectory);
      clearReactPathsCache();
      assertEquals(getLocalReactPath("react", "19.2.4")?.startsWith("file:"), true);
      assertEquals(getLocalReactPath("react-dom/static", "19.2.4")?.startsWith("file:"), true);
    } finally {
      process.chdir(originalDirectory);
      clearReactPathsCache();
      rmSync(temporaryDirectory, { recursive: true });
    }
  });

  it("resolves installed React subpaths outside the eager peer map and rejects missing exports", () => {
    if (!isNode && !isBun) return;
    for (const specifier of ["react-dom/static", "react/compiler-runtime"]) {
      assertEquals(getLocalReactPaths()[specifier], undefined);
      assertEquals(getLocalReactPath(specifier, "19.2.4")?.startsWith("file:"), true);
    }
    assertThrows(() => getLocalReactPath("react/not-an-export", "19.2.4"));
  });

  it("does not require an optional client export to resolve React and its server", () => {
    if (!isNode) return;
    const original = Reflect.get(Module, "_resolveFilename");
    clearReactPathsCache();
    try {
      Reflect.set(Module, "_resolveFilename", function (request: string, ...args: unknown[]) {
        if (request === "react-dom/client") {
          throw Object.assign(new Error("optional export unavailable"), {
            code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
          });
        }
        return Reflect.apply(original, Module, [request, ...args]);
      });
      assertEquals(getLocalReactPath("react", "19.2.4")?.startsWith("file:"), true);
      assertEquals(getLocalReactPath("react-dom/server", "19.2.4")?.startsWith("file:"), true);
      assertEquals(getLocalReactPaths()["react-dom/client"], undefined);
      assertThrows(() => getLocalReactPath("react-dom/client", "19.2.4"));
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
    }
  });
  it("rejects a selected version absent from Bun's resolved React peers", () => {
    if (!isBun) return;
    assertThrows(() => getLocalReactPath("react", "18.3.1"), TypeError, "does not match");
    assertThrows(
      () => getLocalReactPath("react-dom/server", "18.3.1"),
      TypeError,
      "does not match",
    );
  });
  it("accepts authored ranges satisfied by the installed React singleton", () => {
    if (!isNode) return;
    for (const range of ["^19.2.0", "~19.2.0", "19"]) {
      assertEquals(getLocalReactPath("react", range), getLocalReactPath("react", "19.2.4"));
    }
  });
  it("revalidates a fixed React version after peers change behind the outer transform cache", async () => {
    if (!isNode) return;
    const { transformModuleCodeWithCache } = await import(
      "#veryfront/rendering/orchestrator/module-loader/module-transform-cache.ts"
    );
    const cache = new Map<string, string>();
    const deps:
      import("#veryfront/rendering/orchestrator/module-loader/module-transform-cache.ts").ModuleTransformCacheDeps =
        {
          initializeTransformCache: () => Promise.resolve(false),
          getOrComputeTransform: async (key, compute) => {
            const cached = cache.get(key);
            if (cached !== undefined) return { code: cached, cacheHit: true };
            const code = await compute();
            cache.set(key, code);
            return { code, cacheHit: false };
          },
          transformToESM: (_code, _path, _directory, _adapter, options) => {
            getLocalReactPath("react", options.reactVersion);
            return Promise.resolve("export const page = 1;");
          },
          validateCachedBundlesByManifestOrCode: () =>
            Promise.resolve({ valid: true, failedHashes: [], source: "code" }),
          findMissingFrameworkBundlePaths: () => Promise.resolve([]),
          getHttpBundleCacheDir: () => "/tmp/runtime-cache-test",
          setCachedTransformAsync: () => Promise.resolve(),
          runPipeline: () => Promise.reject(new Error("Unexpected retry")),
        };
    const input = {
      fileContent: "export const page = 1;",
      filePath: "/project/page.tsx",
      projectDir: "/project",
      effectiveProjectId: "runtime-cache-test",
      mode: "production" as const,
      adapter: {} as import("#veryfront/platform/adapters/base.ts").RuntimeAdapter,
      reactVersion: "19.2.4",
      deps,
    };
    await transformModuleCodeWithCache(input);
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      await assertRejects(() => transformModuleCodeWithCache(input), TypeError, "does not match");
    } finally {
      restoreDom();
      restoreReact();
    }
  });

  it("rejects an aliased installed peer package identity", () => {
    if (!isNode) return;
    const restore = overrideInstalledVersion("react", "19.2.4", "preact");
    try {
      assertThrows(() => resolveInstalledReactRange("latest"), TypeError, "identity");
      assertThrows(() => getLocalReactPath("react", "19.2.4"), TypeError, "identity");
    } finally {
      restore();
    }
  });

  it("rejects an authored package alias without swallowing it as unreadable metadata", async () => {
    const directory = mkdtempSync(join(tmpdir(), "react-alias-source-"));
    try {
      fs.writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ dependencies: { react: "npm:preact@^10.0.0" } }),
      );
      await assertRejects(
        () => resolveProjectReactVersion({ projectDir: directory }),
        TypeError,
        "aliases",
      );
    } finally {
      rmSync(directory, { recursive: true });
    }
  });

  it("rejects npm aliases before choosing React CDN versions", () => {
    assertThrows(() => resolveInstalledReactRange("npm:preact@^10.0.0"), TypeError);
  });

  it("rejects alternate-source React declarations before using official CDN versions", async () => {
    const { buildImportMap } = await import("#veryfront/html/utils.ts");
    for (
      const declaration of [
        "workspace:*",
        "file:../react",
        "link:../react",
        "../react",
        "git+https://example.invalid/react.git",
        "https://example.invalid/react.tgz",
        "owner/react",
        "github:owner/react",
        "react-fork.tgz",
        "react-fork.tar.gz",
      ]
    ) {
      assertThrows(() => resolveInstalledReactRange(declaration), TypeError);
      await assertRejects(
        () => buildImportMap({ config: { react: { version: declaration } } }),
        TypeError,
      );
      const directory = mkdtempSync(join(tmpdir(), "react-source-declaration-"));
      try {
        fs.writeFileSync(
          join(directory, "package.json"),
          JSON.stringify({ dependencies: { react: declaration } }),
        );
        await assertRejects(() => resolveProjectReactVersion({ projectDir: directory }), TypeError);
        const adapter = {
          moduleLoader: { importModule: () => Promise.resolve({ default: { version: "19.2.4" } }) },
        } as unknown as import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
        await assertRejects(
          () =>
            resolveProjectReactVersion({ adapter, config: { react: { version: declaration } } }),
          TypeError,
        );
      } finally {
        rmSync(directory, { recursive: true });
      }
    }
  });

  it("selects the installed peer for non-semver declarations without accepting mismatching ranges", async () => {
    if (!isNode) return;
    const restore = overrideInstalledVersion("react", "19.2.5");
    try {
      for (const declaration of ["latest", "next", "canary"]) {
        assertEquals(resolveInstalledReactRange(declaration), "19.2.5");
        assertEquals(
          await resolveProjectReactVersion({ config: { react: { version: declaration } } }),
          "19.2.5",
        );
        assertEquals(
          await resolveProjectReactVersion({
            dependencyPinningCacheKey: "on:tag",
            dependencyPinningDependencies: { react: declaration },
          }),
          "19.2.5",
        );
        assertEquals(getLocalReactPath("react", declaration)?.startsWith("file:"), true);
      }
      assertEquals(resolveInstalledReactRange("^18.3.1"), undefined);
      assertThrows(() => getLocalReactPath("react", "18.3.1"), TypeError, "does not match");
    } finally {
      restore();
    }
  });

  it("keeps captured effective React pins after installed peers change", async () => {
    if (!isNode) return;
    const { createDependencyPinningSource, getDependencyPinningSnapshot } = await import(
      "#veryfront/transforms/esm/package-registry.ts"
    );
    const { getHostEnv, setEnv } = await import("#veryfront/platform/compat/process.ts");
    const { buildImportMap } = await import("#veryfront/html/utils.ts");
    const flag = "VERYFRONT_DEPENDENCY_PINNING";
    const previous = getHostEnv(flag);
    const directory = mkdtempSync(join(tmpdir(), "captured-effective-peer-"));
    let restoreReact: (() => void) | undefined;
    let restoreDom: (() => void) | undefined;
    try {
      setEnv(flag, "1");
      fs.writeFileSync(join(directory, "package.json"), "{}");
      const config = { react: { version: "^19.2.0" } };
      const snapshot = await getDependencyPinningSnapshot(
        createDependencyPinningSource({ projectDir: directory, isLocalProject: true, config }),
      );
      const options = {
        projectDir: directory,
        config,
        dependencyPinningCacheKey: snapshot.cacheKey,
        dependencyPinningDependencies: snapshot.dependencies,
        dependencyPinningConfiguredVersions: snapshot.configuredVersions,
      };
      restoreReact = overrideInstalledVersion("react", "19.2.5");
      restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
      assertEquals(await resolveProjectReactVersion(options), "19.2.4");
      assertEquals((await resolveProjectPackageVersions(options)).react, "19.2.4");
      assertEquals(
        JSON.parse((await buildImportMap(options)).json).imports.react.includes("react@19.2.4"),
        true,
      );
      assertThrows(() => getLocalReactPath("react", "19.2.4"), TypeError);
    } finally {
      restoreDom?.();
      restoreReact?.();
      setEnv(flag, previous ?? "");
      rmSync(directory, { recursive: true });
    }
  });

  it("refreshes a cached project range when only the installed peer changes", async () => {
    if (!isNode) return;
    const dir = mkdtempSync(join(tmpdir(), "sdk-cached-range-"));
    let restore: (() => void) | undefined;
    try {
      fs.writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ dependencies: { react: "^19.2.0" } }),
      );
      assertEquals((await readProjectDependencyVersions(dir)).react, "19.2.4");
      restore = overrideInstalledVersion("react", "19.2.5");
      assertEquals((await readProjectDependencyVersions(dir)).react, "19.2.5");
      assertEquals(await resolveProjectReactVersion({ projectDir: dir }), "19.2.5");
    } finally {
      restore?.();
      rmSync(dir, { recursive: true });
    }
  });

  it("selects a compatible installed patch for both config and captured React ranges", async () => {
    if (!isNode) return;
    createRequire(import.meta.url)("react/package.json"); // Warm Node's JSON cache.
    assertEquals(resolveInstalledReactRange("^19.2.4"), "19.2.4");
    const restore = overrideInstalledVersion("react", "19.2.5");
    try {
      assertEquals(await resolveProjectReactVersion({}), "19.2.5");
      assertEquals((await resolveProjectPackageVersions({})).react, "19.2.5");
      assertEquals(
        (await resolveProjectPackageVersions({
          dependencyPinningCacheKey: "on:empty",
          dependencyPinningDependencies: {},
        })).react,
        await resolveProjectReactVersion({
          dependencyPinningCacheKey: "on:empty",
          dependencyPinningDependencies: {},
        }),
      );
      assertEquals(
        await resolveProjectReactVersion({
          dependencyPinningCacheKey: "on:range",
          dependencyPinningDependencies: { react: "^19.2.4" },
        }),
        "19.2.5",
      );
      assertEquals(
        await resolveProjectReactVersion({ config: { react: { version: "^19.2.4" } } }),
        "19.2.5",
      );
      assertEquals(
        await resolveProjectReactVersion({ config: { react: { version: "19.2.4" } } }),
        "19.2.4",
      );
    } finally {
      restore();
    }
  });

  it("rejects a separately mismatched installed React DOM renderer", () => {
    if (!isNode) return;
    createRequire(import.meta.url)("react-dom/package.json"); // Warm Node's JSON cache.
    getLocalReactPath("react-dom/server", "19.2.4");
    const restore = overrideInstalledVersion("react-dom", "18.3.1");
    try {
      let rejected = false;
      try {
        getLocalReactPath("react-dom/server", "19.2.4");
      } catch (error) {
        rejected = error instanceof TypeError;
      }
      assertEquals(rejected, true);
    } finally {
      restore();
    }
  });

  describe("getLocalReactPaths", () => {
    it("should return runtime-appropriate local React path mappings", () => {
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
      if (isBun || isNode) {
        assertEquals(Object.keys(paths).length > 0, true);
      } else {
        assertEquals(Object.keys(paths).length, 0);
      }
    });

    it("should return empty object outside Node and Bun", () => {
      if (isBun || isNode) return;
      const paths = getLocalReactPaths();
      assertEquals(paths, {});
    });

    it("renders Node JSX from a cache outside node_modules with the framework React singleton", async () => {
      if (!isNode) return;
      const paths = getLocalReactPaths();
      assertEquals(paths["react/jsx-runtime"]?.startsWith("file:"), true);
      const code = `import React from ${JSON.stringify(paths.react)};
        import { jsx } from ${JSON.stringify(paths["react/jsx-runtime"])};
        import { renderToStaticMarkup } from ${JSON.stringify(paths["react-dom/server"])};
        function Page() { const [value] = React.useState("offline-render"); return jsx("main", {children: value}); }
        export const html = renderToStaticMarkup(jsx(Page, {}));
        export { React };`;
      const rendered = await import(`data:text/javascript,${encodeURIComponent(code)}`);
      const frameworkReact = createRequire(import.meta.url)("react");
      assertEquals(rendered.React === frameworkReact, true);
      assertEquals(rendered.html, "<main>offline-render</main>");
    });

    it("should return same result on repeated calls (cache)", () => {
      const paths1 = getLocalReactPaths();
      const paths2 = getLocalReactPaths();
      assertEquals(paths1, paths2);
      assertEquals(Object.isFrozen(paths1), true);
    });
  });

  describe("clearReactPathsCache", () => {
    it("should not throw when clearing cache", () => {
      clearReactPathsCache();
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
    });

    it("should allow fresh resolution after clearing", () => {
      getLocalReactPaths();
      clearReactPathsCache();
      const paths = getLocalReactPaths();
      assertEquals(typeof paths, "object");
    });
  });
});
