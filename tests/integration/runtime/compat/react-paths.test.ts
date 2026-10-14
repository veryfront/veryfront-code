import { readProjectDependencyVersions } from "#veryfront/transforms/esm/package-registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  captureLocalReactPeers,
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
  it("refreshes peer URLs in the runtime fingerprint when package paths change at fixed versions", async () => {
    if (!isNode) return;
    const { captureSSRReactRuntimeIdentity } = await import(
      "#veryfront/transforms/esm/http-cache-helpers.ts"
    );
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `peer-path-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      const before = captureSSRReactRuntimeIdentity();
      const beforeScope = await before.scope;
      generation = "new";
      const after = captureSSRReactRuntimeIdentity();
      assertEquals(before.reactVersion, after.reactVersion);
      assertEquals(await after.scope === beforeScope, false);
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      getLocalReactPaths({ fresh: true });
      clearReactPathsCache();
    }
  });

  it("uses one captured peer path for all rewrites after a same-version relocation", async () => {
    if (!isNode) return;
    const { captureSSRReactRuntimeIdentity } = await import(
      "#veryfront/transforms/esm/http-cache-helpers.ts"
    );
    const { rewriteSSRImportsCompat } = await import(
      "#veryfront/transforms/import-rewriter/ssr-adapter.ts"
    );
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `graph-peer-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      const captured = captureSSRReactRuntimeIdentity();
      const options = { reactVersion: captured.reactVersion, reactPeers: captured.peers };
      const source = 'import React from "react"; import { jsx } from "react/jsx-runtime";';
      const first = rewriteSSRImportsCompat(source, options);
      generation = "new";
      assertEquals(rewriteSSRImportsCompat(source, options), first);
      const next = captureSSRReactRuntimeIdentity();
      assertEquals(
        rewriteSSRImportsCompat(source, {
          reactVersion: next.reactVersion,
          reactPeers: next.peers,
        }) === first,
        false,
      );
      assertEquals(await captured.scope === await next.scope, false);
      assertThrows(
        () => rewriteSSRImportsCompat('import x from "react/unavailable";', options),
        TypeError,
      );
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
    }
  });

  it("keeps recursive fetched modules on one peer generation during dependency replacement", async () => {
    if (!isNode) return;
    const { createModuleFetcherContext, fetchAndCacheModule } = await import(
      "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts"
    );
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const directory = mkdtempSync(join(tmpdir(), "recursive-peer-"));
    const adapter = createMockAdapter();
    const sources = new Map([
      [
        "/virtual/parent.ts",
        'import React from "react"; import { child } from "./child.js"; export const value = React.version + child;',
      ],
      ["/virtual/child.ts", 'import React from "react"; export const child = React.version;'],
    ]);
    adapter.fs.resolveFile = (path: string) =>
      Promise.resolve(sources.has(`/virtual/${path}.ts`) ? `/virtual/${path}.ts` : null);
    let generation = "old";
    adapter.fs.readFile = (path: string) => {
      if (path === "/virtual/child.ts") generation = "new";
      const source = sources.get(path);
      if (source === undefined) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
      return Promise.resolve(source);
    };
    const original = Reflect.get(Module, "_resolveFilename");
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `recursive-peer-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      const context = createModuleFetcherContext(directory, adapter, "/virtual", "recursive-peer");
      const result = await fetchAndCacheModule("/_vf_modules/parent.js", context);
      assertEquals(typeof result, "string");
      const emitted: string[] = [];
      const inspect = (folder: string) => {
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
          const path = join(folder, entry.name);
          if (entry.isDirectory()) inspect(path);
          else if (path.endsWith(".mjs") || path.endsWith(".js")) {
            emitted.push(fs.readFileSync(path, "utf8"));
          }
        }
      };
      inspect(directory);
      assertEquals(generation, "new");
      assertEquals(emitted.filter((code) => code.includes("recursive-peer-old")).length >= 2, true);
      assertEquals(emitted.some((code) => code.includes("recursive-peer-new")), false);
      const fresh = createModuleFetcherContext(
        join(directory, "fresh"),
        adapter,
        "/virtual",
        "recursive-peer-new",
      );
      const next = await fetchAndCacheModule("/_vf_modules/child.js", fresh);
      assertEquals(typeof next, "string");
      assertEquals(
        fs.readFileSync(String(next).replace(/^file:\/\//, ""), "utf8").includes(
          "recursive-peer-new",
        ),
        true,
      );
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("scopes MDX JSX artifacts and React imports to their captured peers", async () => {
    if (!isNode) return;
    const { transformJsxImports } = await import(
      "#veryfront/transforms/mdx/esm-module-loader/import-transformer.ts"
    );
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const adapter = createMockAdapter();
    const directory = mkdtempSync(join(tmpdir(), "jsx-peer-snapshot-"));
    const source = join(directory, "component.tsx");
    fs.writeFileSync(
      source,
      "export default function Component() { return <h1>same-source</h1>; }",
    );
    adapter.fs.files.set(source, fs.readFileSync(source, "utf8"));
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `jsx-peer-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    const code = `import Component from "file://${source}";`;
    const artifact = (result: string) => {
      const match = result.match(/file:\/\/([^"']+)/);
      const captured = match?.[1];
      if (!captured) throw new Error("JSX artifact missing");
      return captured;
    };
    try {
      const old = captureLocalReactPeers();
      const first = await transformJsxImports(code, adapter, directory, directory, old);
      assertEquals(fs.readFileSync(artifact(first), "utf8").includes("jsx-peer-old"), true);
      generation = "new";
      assertEquals(await transformJsxImports(code, adapter, directory, directory, old), first);
      const next = await transformJsxImports(
        code,
        adapter,
        directory,
        directory,
        captureLocalReactPeers(),
      );
      assertEquals(next === first, false);
      assertEquals(fs.readFileSync(artifact(next), "utf8").includes("jsx-peer-new"), true);
      assertEquals(fs.readFileSync(artifact(first), "utf8").includes("jsx-peer-old"), true);
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resolves supported exported subpaths from captured peer roots", () => {
    if (!isNode) return;
    const peers = captureLocalReactPeers();
    for (const specifier of ["react/compiler-runtime", "react-dom/static"]) {
      assertEquals(
        getLocalReactPath(specifier, "19.2.4", peers),
        getLocalReactPath(specifier, "19.2.4"),
      );
    }
    assertThrows(() => getLocalReactPath("react/unavailable", "19.2.4", peers), TypeError);
  });

  it("keeps logical reference cache identity independent of host peer availability", async () => {
    if (!isNode) return;
    const { computePipelineConfigIdentity } = await import(
      "#veryfront/transforms/pipeline/cache-identity.ts"
    );
    const original = fs.readFileSync;
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (/\/(?:react|react-dom)\/package.json$/.test(String(args[0]))) {
        throw new Error("Host peers unavailable");
      }
      return Reflect.apply(original, fs, args);
    }) as typeof fs.readFileSync;
    const sync = Reflect.get(Module, "syncBuiltinESMExports") as () => void;
    sync();
    try {
      const input = {
        ssrImports: "references" as const,
        reactVersion: "19.2.4",
        jsxImportSource: "react",
        studioEmbed: false,
        dev: false,
        ssr: true,
        projectDir: "/project",
        customPlugins: [],
      };
      assertEquals(
        (await computePipelineConfigIdentity(input)).length === 64,
        true,
      );
      await assertRejects(
        () => computePipelineConfigIdentity({ ...input, ssrImports: "files" }),
        Error,
        "Host peers unavailable",
      );
    } finally {
      fs.readFileSync = original;
      sync();
    }
  });

  it("keeps framework HTTP dependencies on the parent captured peers", async () => {
    if (!isNode) return;
    const { transformFrameworkCode } = await import(
      "#veryfront/transforms/pipeline/stages/ssr-vf-modules/transform.ts"
    );
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const { withMockFetch } = await import("#veryfront/testing/mock-fetch.ts");
    const { createFileSystem } = await import("#veryfront/platform/compat/fs.ts");
    const directory = mkdtempSync(join(tmpdir(), "http-graph-peer-"));
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `http-graph-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      const peers = captureLocalReactPeers();
      generation = "new";
      await runWithCacheDir(directory, () =>
        withMockFetch(
          () =>
            Promise.resolve(
              new Response(
                'import React from "https://esm.sh/react@19.2.4"; export default React;',
                { headers: { "content-type": "application/javascript" } },
              ),
            ),
          async () => {
            const code = await transformFrameworkCode(
              'import React from "react"; import dep from "https://example.invalid/dependency.mjs"; export { React, dep };',
              join(directory, "framework.ts"),
              {
                reactVersion: "19.2.4",
                reactPeers: peers,
                projectDir: directory,
                fs: createFileSystem(),
              },
            );
            assertEquals(code.includes("http-graph-old"), true);
            const all: string[] = [];
            const scan = (folder: string) => {
              for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
                const path = join(folder, entry.name);
                if (entry.isDirectory()) scan(path);
                else if (/\.(?:js|mjs)$/.test(path)) all.push(fs.readFileSync(path, "utf8"));
              }
            };
            scan(directory);
            assertEquals(all.some((value) => value.includes("http-graph-old")), true);
            assertEquals(all.some((value) => value.includes("http-graph-new")), false);
          },
        ));
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("builds default-version logical references without host peer manifests", async () => {
    if (!isNode) return;
    const { runPipeline } = await import("#veryfront/transforms/pipeline/index.ts");
    const original = fs.readFileSync;
    const sync = Reflect.get(Module, "syncBuiltinESMExports") as () => void;
    fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
      if (/\/(?:react|react-dom)\/package.json$/.test(String(args[0]))) {
        throw new Error("Host peers unavailable");
      }
      return Reflect.apply(original, fs, args);
    }) as typeof fs.readFileSync;
    sync();
    try {
      const result = await runPipeline("export const value = 1;", "/project/page.ts", "/project", {
        projectId: "logical-reference-host-free",
        ssr: true,
        dependencyPinningCacheKey: "off",
        preloadedImportMap: { imports: {} },
      }, { ssrImports: "references" });
      assertEquals(result.code.includes("value"), true);
    } finally {
      fs.readFileSync = original;
      sync();
    }
  });

  it("keeps SSR loader parent and dependency transforms on the graph peers", async () => {
    if (!isNode) return;
    const { SSRModuleLoader } = await import(
      "#veryfront/modules/react-loader/ssr-module-loader/loader.ts"
    );
    const { createDependencyHashCache } = await import("#veryfront/cache/dependency-graph.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const directory = mkdtempSync(join(tmpdir(), "ssr-loader-peer-"));
    const parent = join(directory, "parent.ts");
    const child = join(directory, "child.ts");
    const source =
      'import React from "react"; import { child } from "./child.ts"; export const value = React.version + child;';
    fs.writeFileSync(parent, source);
    fs.writeFileSync(child, 'import React from "react"; export const child = React.version;');
    const adapter = createMockAdapter();
    adapter.fs.files.set(parent, source);
    adapter.fs.files.set(child, fs.readFileSync(child, "utf8"));
    let generation = "old";
    const read = adapter.fs.readFile.bind(adapter.fs);
    adapter.fs.readFile = (path: string) => {
      if (path === child) generation = "new";
      return read(path);
    };
    const original = Reflect.get(Module, "_resolveFilename");
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `ssr-loader-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      await runWithCacheDir(directory, async () => {
        const loader = new SSRModuleLoader({
          projectId: "ssr-loader-peer",
          contentSourceId: "release",
          projectDir: directory,
          adapter,
          dev: false,
          reactVersion: "19.2.4",
        });
        const transform = Reflect.get(loader, "transformWithDependencies");
        await Reflect.apply(transform, loader, [parent, source, 0, createDependencyHashCache()]);
        assertEquals(generation, "new");
        const emitted: string[] = [];
        const scan = (folder: string) => {
          for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isDirectory()) scan(path);
            else if (/\.(?:mjs|js)$/.test(path)) emitted.push(fs.readFileSync(path, "utf8"));
          }
        };
        scan(directory);
        assertEquals(emitted.filter((code) => code.includes("ssr-loader-old")).length >= 2, true);
        assertEquals(emitted.some((code) => code.includes("ssr-loader-new")), false);
      });
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps rendering orchestrator dependency transforms on one captured peer graph", async () => {
    if (!isNode) return;
    const { transformModuleWithDeps } = await import(
      "#veryfront/rendering/orchestrator/module-loader/index.ts"
    );
    const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const directory = mkdtempSync(join(tmpdir(), "orchestrator-peer-"));
    const output = join(directory, "output");
    fs.mkdirSync(output);
    const parent = join(directory, "parent.ts");
    const child = join(directory, "child.ts");
    fs.writeFileSync(
      parent,
      'import React from "react"; import { child } from "./child.ts"; export const value = React.version + child;',
    );
    fs.writeFileSync(child, 'import React from "react"; export const child = React.version;');
    const actual = await runtime.get();
    let generation = "old";
    const scopedFs = Object.create(actual.fs);
    scopedFs.readFile = (path: string) => {
      if (path === child) generation = "new";
      return actual.fs.readFile(path);
    };
    const adapter = { ...actual, fs: scopedFs };
    const original = Reflect.get(Module, "_resolveFilename");
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `orchestrator-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      await runWithCacheDir(directory, async () => {
        await transformModuleWithDeps(parent, output, actual, {
          projectId: "orchestrator-peer",
          projectDir: directory,
          contentSourceId: "release",
          adapter,
          mode: "production",
          moduleCache: new Map(),
          esmCache: new Map(),
          reactVersion: "19.2.4",
        });
        assertEquals(generation, "new");
        const emitted: string[] = [];
        const scan = (folder: string) => {
          for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            const path = join(folder, entry.name);
            if (entry.isDirectory()) scan(path);
            else if (/\.(?:js|mjs)$/.test(path)) emitted.push(fs.readFileSync(path, "utf8"));
          }
        };
        scan(output);
        assertEquals(emitted.filter((code) => code.includes("orchestrator-old")).length >= 2, true);
        assertEquals(emitted.some((code) => code.includes("orchestrator-new")), false);
      });
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refreshes installed-peer selection in reused page, layout and SSR renderers", async () => {
    if (!isNode) return;
    const { PageRenderer } = await import("#veryfront/rendering/page-renderer.ts");
    const { LayoutOrchestrator } = await import("#veryfront/rendering/orchestrator/layout.ts");
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const adapter = createMockAdapter();
    const config = { react: { version: "^19.2.0" } };
    const page = Reflect.construct(PageRenderer, [{
      projectDir: "/memo-peer-project",
      mode: "development",
      environment: "production",
      adapter,
      config,
      componentRegistry: {},
      compileMDX: () => Promise.reject(new Error("Unused compiler")),
    }]);
    const layout = Reflect.construct(LayoutOrchestrator, [{
      projectDir: "/memo-peer-project",
      adapter,
      config,
      layoutCache: { clear: () => {} },
    }]);
    const ssr = new SSRRenderer("development", adapter, "/memo-peer-project", undefined, config);
    const select = (renderer: object) =>
      Reflect.apply(Reflect.get(renderer, "getReactVersion"), renderer, []);
    for (const renderer of [page, layout, ssr]) assertEquals(await select(renderer), "19.2.4");
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      for (const renderer of [page, layout, ssr]) assertEquals(await select(renderer), "19.2.5");
    } finally {
      restoreDom();
      restoreReact();
    }
  });

  it("keeps captured peer selection and browser imports aligned after installed versions change", async () => {
    if (!isNode) return;
    const { resolveProjectReactVersion } = await import(
      "#veryfront/transforms/esm/package-registry.ts"
    );
    const { buildImportMap } = await import("#veryfront/html/utils.ts");
    const peers = captureLocalReactPeers();
    const options = { reactPeers: peers, config: { react: { version: "^19.2.0" } } };
    const { RenderPipeline } = await import("#veryfront/rendering/orchestrator/pipeline.ts");
    const { ComponentRegistry } = await import("#veryfront/rendering/ssr/component-registry.ts");
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const adapter = createMockAdapter();
    const pipeline = Reflect.construct(RenderPipeline, [{
      adapter,
      projectDir: "/request-peer-project",
      config: options.config,
      mode: "development",
      environment: "preview",
    }]);
    const selectLoader = (reactPeers: typeof peers): Promise<
      import("#veryfront/rendering/orchestrator/module-loader/index.ts").ModuleLoaderConfig
    > =>
      Reflect.apply(
        Reflect.get(pipeline, "resolveModuleLoaderConfig"),
        pipeline,
        [{ reactPeers }],
      );
    adapter.fs.files.set(
      "/request-peer-project/components/Button.tsx",
      "export default () => null;",
    );
    const loadedPeers: Array<typeof peers | undefined> = [];
    const { VirtualModuleSystem } = await import("#veryfront/rendering/virtual-module-system.ts");
    const registry = new ComponentRegistry(
      new VirtualModuleSystem(undefined, adapter),
      3001,
      adapter,
      undefined,
      undefined,
      undefined,
      undefined,
      (_source, _path, _root, _adapter, selected) => {
        loadedPeers.push(selected.reactPeers);
        return Promise.resolve(() => null);
      },
    );
    await registry.loadFromDirectory("/request-peer-project/components", true);
    const prepare = (selected: typeof peers) =>
      registry.prepareDependencySnapshot(
        "off",
        undefined,
        undefined,
        undefined,
        undefined,
        "preview",
        undefined,
        selected,
      );
    const oldKey = await prepare(peers);

    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      assertEquals(await resolveProjectReactVersion(options), "19.2.4");
      const oldLoader = await selectLoader(peers);
      assertEquals(oldLoader.reactVersion, "19.2.4");
      assertEquals(oldLoader.reactPeers, peers);
      const freshPeers = captureLocalReactPeers();
      const freshLoader = await selectLoader(freshPeers);
      assertEquals(freshLoader.reactVersion, "19.2.5");
      const freshKey = await prepare(freshPeers);
      assertEquals(freshKey === oldKey, false);
      assertEquals(await prepare(peers), oldKey);
      assertEquals(loadedPeers, [peers, freshPeers]);

      const imports = JSON.parse((await buildImportMap(options)).json).imports;
      assertEquals(imports.react.includes("react@19.2.4"), true);
      assertEquals(imports["react-dom"].includes("react-dom@19.2.4"), true);
      const { createHTMLContext, createHTMLGenerator } = await import(
        "#veryfront/rendering/orchestrator/html.test-helpers.ts"
      );
      const html = await createHTMLGenerator({ mode: "development", isLocalProject: true })
        .generateFullHTML(createHTMLContext({
          html: "<main>Captured peers</main>",
          options: { reactPeers: peers, environment: "preview" },
        }));
      assertEquals(html.includes("react@19.2.4"), true);
      assertEquals(html.includes("react-dom@19.2.4"), true);
      assertEquals(html.includes("react@19.2.5"), false);

      assertEquals(
        await resolveProjectReactVersion({ ...options, reactPeers: captureLocalReactPeers() }),
        "19.2.5",
      );
      await assertRejects(
        () => resolveProjectReactVersion({ ...options, config: { react: { version: "19.2.5" } } }),
        Error,
        "does not match",
      );
    } finally {
      restoreDom();
      restoreReact();
    }
  });

  it("renders page hooks with the same captured physical peers after relocation", async () => {
    if (!isNode) return;
    const { SSRRenderer } = await import("#veryfront/rendering/ssr-renderer.ts");
    const { resetReactCache } = await import(
      "#veryfront/react/compat/ssr-adapter/server-loader.ts"
    );
    const { pathToFileURL } = await import("node:url");
    const { loadComponentFromSource } = await import(
      "#veryfront/modules/react-loader/component-loader.ts"
    );
    const { runtime } = await import("#veryfront/platform/adapters/detect.ts");
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const base = captureLocalReactPeers();
    const directory = mkdtempSync(join(tmpdir(), "request-render-peers-"));
    const snapshots = new Map<string, typeof base>();
    for (const generation of ["old", "new"]) {
      const roots: Record<string, string> = {};
      for (const name of ["react", "react-dom"]) {
        const root = base.roots[name];
        if (!root) throw new Error("Installed peers missing");
        roots[name] = join(directory, generation, "node_modules", name);
        fs.cpSync(root, roots[name], { recursive: true });
      }
      const paths: Record<string, string> = {};
      for (const [specifier, uri] of Object.entries(base.paths)) {
        const name = specifier.startsWith("react-dom") ? "react-dom" : "react";
        paths[specifier] = uri.replace(
          pathToFileURL(base.roots[name]!).href,
          pathToFileURL(roots[name]!).href,
        );
      }
      snapshots.set(generation, { roots, paths, versions: base.versions });
    }
    const old = snapshots.get("old")!;
    const next = snapshots.get("new")!;
    const module = await import(old.paths.react!);
    const React = module.default ?? module;
    const adapter = await runtime.get();
    const pageSource =
      'import React from "react"; export default function Page() { const [value] = React.useState(7); return React.createElement("strong", null, value); }';
    const pagePath = join(directory, "page.tsx");
    fs.writeFileSync(pagePath, pageSource);
    const Component = await runWithCacheDir(
      directory,
      () =>
        loadComponentFromSource(pageSource, pagePath, directory, adapter, {
          projectId: "request-render-peers",
          contentSourceId: "release",
          dev: false,
          ssr: true,
          reactVersion: "19.2.4",
          reactPeers: old,
        }),
    );
    if (!Component) throw new Error("Loaded page component missing");
    const physicalDirectory = fs.realpathSync(directory);
    const original = Reflect.get(Module, "_resolveFilename");
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      const parent = args[0] as { filename?: string } | undefined;
      if (
        parent?.filename?.startsWith(directory) || parent?.filename?.startsWith(physicalDirectory)
      ) return resolved;
      const replacement = next.paths[request];
      return replacement ? new URL(replacement).pathname : resolved;
    });
    resetReactCache();
    try {
      const renderer = new SSRRenderer("development");
      const result = await renderer.renderToHTML(React.createElement(Component), {
        mode: "development",
        wantsStream: false,
        reactPeers: old,
      });
      assertEquals(result.html, "<strong>7</strong>");
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      resetReactCache();
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains original peer paths when stale-cache import retries after relocation", async () => {
    if (!isNode) return;
    const { SSRModuleLoader } = await import(
      "#veryfront/modules/react-loader/ssr-module-loader/loader.ts"
    );
    const { createMockAdapter } = await import("#veryfront/platform/adapters/mock.ts");
    const { runWithCacheDir } = await import("#veryfront/utils/cache-dir.ts");
    const directory = mkdtempSync(join(tmpdir(), "retry-request-peers-"));
    const path = join(directory, "page.ts");
    const source = 'import React from "react"; export const value = React.version;';
    const adapter = createMockAdapter();
    adapter.fs.files.set(path, source);
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `retry-request-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    try {
      await runWithCacheDir(directory, async () => {
        const peers = captureLocalReactPeers();
        const loader = new SSRModuleLoader({
          projectDir: directory,
          projectId: "retry-request-peers",
          contentSourceId: "release",
          adapter,
          dev: false,
          reactVersion: "19.2.4",
          reactPeers: peers,
        });
        const imports: string[] = [];
        Reflect.set(
          loader,
          "importModuleFromCacheEntry",
          (_file: string, _name: string, entry: { tempPath: string }) => {
            imports.push(fs.readFileSync(entry.tempPath, "utf8"));
            if (imports.length === 1) {
              generation = "new";
              throw Object.assign(new Error("Cannot find module '/owned-missing-cache.mjs'"), {
                code: "ERR_MODULE_NOT_FOUND",
              });
            }
            return Promise.resolve({ value: "retry-success" });
          },
        );
        const result = await loader.loadRawModule(path, source);
        assertEquals(result.value, "retry-success");
        assertEquals(imports.length, 2);
        assertEquals(imports.every((code) => code.includes("retry-request-old")), true);
        assertEquals(imports.some((code) => code.includes("retry-request-new")), false);
      });
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reloads React and renderer caches when resolved paths change at fixed versions", async () => {
    if (!isNode) return;
    const { getProjectReact, getReactDOMServer, resetReactCache, __setServerModuleLoaderForTests } =
      await import("#veryfront/react/compat/ssr-adapter/server-loader.ts");
    const actual = await getProjectReact("19.2.4");
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `renderer-path-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    __setServerModuleLoaderForTests((_url, label) =>
      Promise.resolve(
        label === "React" ? { default: { ...actual, marker: generation } } : {
          version: "19.2.4",
          marker: generation,
          renderToString: () => generation,
          renderToStaticMarkup: () => generation,
        },
      )
    );
    resetReactCache();
    try {
      const beforeReact = await getProjectReact("19.2.4");
      const beforeDom = await getReactDOMServer("19.2.4");
      generation = "new";
      assertEquals(await getProjectReact("19.2.4") === beforeReact, false);
      assertEquals(await getReactDOMServer("19.2.4") === beforeDom, false);
    } finally {
      Reflect.set(Module, "_resolveFilename", original);
      getLocalReactPaths({ fresh: true });
      resetReactCache();
      __setServerModuleLoaderForTests(null);
    }
  });

  it("accepts version prefixes on an installed renderer without accepting another release", async () => {
    if (!isNode) return;
    const { getReactDOMServer, resetReactCache } = await import(
      "#veryfront/react/compat/ssr-adapter/server-loader.ts"
    );
    resetReactCache();
    try {
      const bare = await getReactDOMServer("19.2.4");
      for (const prefix of ["v", "^v", "~v"]) {
        assertEquals(await getReactDOMServer(`${prefix}19.2.4`), bare);
      }
      await assertRejects(() => getReactDOMServer("v19.2.4-canary"), Error, "does not match");
    } finally {
      resetReactCache();
    }
  });

  it("refuses a cached Node renderer after an in-place peer version replacement", async () => {
    if (!isNode) return;
    const { getReactDOMServer, resetReactCache, resolveSSRRuntime } = await import(
      "#veryfront/react/compat/ssr-adapter/server-loader.ts"
    );
    resetReactCache();
    await getReactDOMServer("19.2.4");
    const restoreReact = overrideInstalledVersion("react", "19.2.5");
    const restoreDom = overrideInstalledVersion("react-dom", "19.2.5");
    try {
      await assertRejects(
        () => resolveSSRRuntime({ reactVersion: "19.2.5" }),
        Error,
        "does not match",
      );
    } finally {
      restoreDom();
      restoreReact();
      resetReactCache();
    }
  });

  it("separates cached and concurrent layouts after same-version peer relocation", async () => {
    if (!isNode) return;
    const { createLayoutComponentCache, loadTSXComponent } = await import(
      "#veryfront/rendering/layouts/utils/component-loader.ts"
    );
    const adapter = {
      fs: { readFile: () => Promise.resolve("export default function Layout() { return null; }") },
    } as unknown as import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
    const cache = createLayoutComponentCache();
    const original = Reflect.get(Module, "_resolveFilename");
    let generation = "old";
    const entries = new Set([
      "react",
      "react-dom",
      "react-dom/server",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ]);
    Reflect.set(Module, "_resolveFilename", (request: string, ...args: unknown[]) => {
      const resolved = Reflect.apply(original, Module, [request, ...args]) as string;
      return entries.has(request)
        ? join(tmpdir(), `layout-peer-${generation}`, resolved.split("/").pop()!)
        : resolved;
    });
    let loads = 0;
    let enteredOld: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      enteredOld = resolve;
    });
    let releaseOld: (() => void) | undefined;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const load = () =>
      loadTSXComponent(
        "/project/app/layout.tsx",
        "/project",
        cache,
        adapter,
        "project",
        "slug",
        "release",
        { compileMode: "production", environment: "production" },
        "19.2.4",
        {
          loadComponentFromSource: async () => {
            loads++;
            const captured = generation;
            if (captured === "old") {
              enteredOld!();
              await oldGate;
            }
            return function Layout() {
              return captured;
            };
          },
        },
      );
    try {
      const old = load();
      await entered;
      generation = "new";
      const current = load();
      // Release the old flight so a broken shared key fails rather than hangs.
      releaseOld!();
      const [oldLayout, newLayout] = await Promise.all([old, current]);
      assertEquals(oldLayout === newLayout, false);
      assertEquals(loads, 2);
      assertEquals(await load(), newLayout);
      assertEquals(loads, 2);
    } finally {
      releaseOld!();
      Reflect.set(Module, "_resolveFilename", original);
      clearReactPathsCache();
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
