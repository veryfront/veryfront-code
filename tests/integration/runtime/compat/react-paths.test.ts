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
  it("does not accept an inner framework cache after installed peers change", async () => {
    if (!isNode) return;
    const { transformFrameworkCode } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/transform.ts"
    );
    const { frameworkFileCache } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/constants.ts"
    );
    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    frameworkFileCache.clear();
    const context = {
      reactVersion: "19.2.4",
      projectDir: "/framework-runtime-test",
      fs: createFileSystem(),
      importMap: { imports: {} },
      importMapFingerprint: "framework-runtime-test",
    };
    const source = 'import React from "react"; export const value = React.version;';
    await transformFrameworkCode(source, "/framework-runtime-test/source.ts", context);
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      await assertRejects(
        () => transformFrameworkCode(source, "/framework-runtime-test/source.ts", context),
        Error,
        "does not match",
      );
    } finally {
      restoreDom();
      restoreReact();
      frameworkFileCache.clear();
    }
  });

  it("does not accept a specifier framework cache from an older peer scope", async () => {
    if (!isNode) return;
    const { resolveAndTransformVeryfrontImport } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/transform.ts"
    );
    const { resolveVeryfrontSourcePath } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/path-resolver.ts"
    );
    const { buildFrameworkTransformCacheKey, veryfrontTransformCache } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/constants.ts"
    );
    const { getSSRReactRuntimeCacheScope } = await import(
      "#veryfront/transforms/esm/http-cache-helpers.ts"
    );
    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    const { pathToFileURL } = await import("node:url");
    const directory = mkdtempSync(join(tmpdir(), "framework-specifier-peer-"));
    const specifier = "#veryfront/utils";
    const sourcePath = await resolveVeryfrontSourcePath(specifier);
    assertEquals(typeof sourcePath, "string");
    const source = 'import React from "react"; export const value = React.version;';
    const adapterFs = createFileSystem();
    const originalRead = adapterFs.readTextFile.bind(adapterFs);
    adapterFs.readTextFile = (path: string) =>
      path === sourcePath ? Promise.resolve(source) : originalRead(path);
    const context = {
      reactVersion: "19.2.4",
      projectDir: directory,
      fs: adapterFs,
      importMap: { imports: {} },
      importMapFingerprint: "specifier-peer-test",
    };
    const key = buildFrameworkTransformCacheKey(
      `${specifier}:${sourcePath}`,
      "19.2.4",
      directory,
      source,
      context.importMapFingerprint,
      await getSSRReactRuntimeCacheScope(),
    );
    const cachedPath = join(directory, "cached.mjs");
    fs.writeFileSync(cachedPath, "export const cached = 1;");
    veryfrontTransformCache.set(key, pathToFileURL(cachedPath).href);
    assertEquals(
      await resolveAndTransformVeryfrontImport(specifier, context),
      pathToFileURL(cachedPath).href,
    );
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      assertEquals(await resolveAndTransformVeryfrontImport(specifier, context), null);
    } finally {
      restoreDom();
      restoreReact();
      veryfrontTransformCache.delete(key);
      rmSync(directory, { recursive: true });
    }
  });

  it("keeps one effective peer version and scope in a recursive fetch graph", async () => {
    if (!isNode) return;
    const { getSharedModuleFetchKey } = await import(
      "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/shared-module-fetches.ts"
    );
    const { getModuleFetcherReactRuntimeIdentity } = await import(
      "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/react-runtime-identity.ts"
    );
    const context = {
      projectId: "fetch-peer-pair",
      projectDir: "/project",
      esmCacheDir: "/tmp/fetch-peer-pair",
    } as import("#veryfront/transforms/mdx/esm-module-loader/types.ts").ModuleFetcherContext;
    const key = await getSharedModuleFetchKey(context, "entry");
    const first = getModuleFetcherReactRuntimeIdentity(context);
    const firstScope = await first.scope;
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      for (let index = 0; index < 20; index++) {
        assertEquals(await getSharedModuleFetchKey(context, "entry"), key);
        const identity = getModuleFetcherReactRuntimeIdentity(context);
        assertEquals(identity.reactVersion, "19.2.4");
        assertEquals(await identity.scope, firstScope);
      }
      const next = getModuleFetcherReactRuntimeIdentity({
        ...context,
        reactVersion: undefined,
        reactRuntimeScope: undefined,
        reactRuntimeIdentity: undefined,
      });
      assertEquals(next.reactVersion, "19.2.5");
      assertEquals(await next.scope === firstScope, false);
      const fixedNext = {
        ...context,
        reactVersion: "19.2.4",
        reactRuntimeScope: undefined,
        reactRuntimeIdentity: undefined,
      };
      assertEquals(await getSharedModuleFetchKey(fixedNext, "entry") === key, false);
    } finally {
      restoreDom();
      restoreReact();
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
      const selected = await transformModuleCodeWithCache({ ...input, reactVersion: undefined });
      assertEquals(selected.code, "export const page = 1;");
      const { transformResolvedModuleSource } = await import(
        "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/source-transform.ts"
      );
      let recursiveVersion: string | undefined;
      await transformResolvedModuleSource({
        sourceCode: "export const page = 1;",
        actualFilePath: "/node_modules/veryfront/esm/src/react/runtime/core.js",
        projectDir: "/project",
        projectId: "runtime-cache-test",
        normalizedPath: "_veryfront/react/runtime/core.js",
        projectSlug: "runtime-cache-test",
        dev: false,
        adapter: input.adapter,
        log: { debug: () => {}, error: () => {} },
        loadImportMap: () => Promise.resolve({ imports: {} }),
        transformFrameworkSource: (_source, _path, version) => {
          recursiveVersion = version;
          getLocalReactPath("react", version);
          return Promise.resolve("export const page = 1;");
        },
      });
      assertEquals(recursiveVersion, "19.2.5");
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

  it("rejects alternate React DOM sources in project and snapshot peer maps", async () => {
    for (
      const declaration of [
        "file:../react-dom",
        "link:../react-dom",
        "git+https://example.invalid/react-dom.git",
      ]
    ) {
      const directory = mkdtempSync(join(tmpdir(), "dom-source-declaration-"));
      try {
        fs.writeFileSync(
          join(directory, "package.json"),
          JSON.stringify({ dependencies: { react: "19.2.4", "react-dom": declaration } }),
        );
        await assertRejects(() => resolveProjectReactVersion({ projectDir: directory }), TypeError);
        await assertRejects(
          () =>
            resolveProjectReactVersion({
              dependencyPinningCacheKey: "on:fixture",
              dependencyPinningDependencies: { react: "19.2.4", "react-dom": declaration },
            }),
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
