import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { LayoutOrchestrator } from "./layout.ts";
import { createLayoutComponentCache } from "#veryfront/rendering/layouts/utils/component-loader.ts";
import type { LayoutComponentCache } from "#veryfront/rendering/layouts/utils/component-loader.ts";
import type { LayoutCollector, LayoutCompiler } from "#veryfront/rendering/layouts/index.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import {
  clearImportMapCache,
  getCachedImportMap,
} from "#veryfront/modules/import-map/preloader.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, LayoutItem, MdxBundle } from "#veryfront/types";
import type { RenderEnvironment } from "#veryfront/rendering/context/render-context.ts";

const LAYOUT_SOURCE = "export default function Layout() { return null; }";

function StubLayout(): null {
  return null;
}

/**
 * A layout cache that records the keys it is asked for and always answers with
 * a stub. `loadTSXComponent` stamps the compile mode and the request
 * environment into the key before the lookup, so the recorded key is a faithful
 * readout of the mode pair the apply phase supplied.
 */
function recordingCache(): { cache: LayoutComponentCache; keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    cache: {
      get(key: string) {
        keys.push(key);
        return StubLayout as React.ComponentType;
      },
      set() {},
      delete() {},
      clear() {},
    },
  };
}

function markersOf(key: string): { dev: boolean; preview: boolean } {
  return { dev: key.includes(":dev"), preview: key.includes(":preview") };
}

/**
 * Serves the one layout the apply case wraps with and nothing else, so the
 * reserved-component scan finds no other file to compile.
 */
function createLayoutSourceAdapter(layoutPath: string): RuntimeAdapter {
  return {
    fs: {
      readFile: (path: string) => {
        if (path === layoutPath) return Promise.resolve(LAYOUT_SOURCE);
        const error = new Error("not found") as Error & { code: string };
        error.code = "ENOENT";
        return Promise.reject(error);
      },
      exists: () => Promise.resolve(false),
      readDir: async function* () {},
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

function createMissingFileAdapter(): RuntimeAdapter {
  return {
    fs: {
      readFile: () => {
        const error = new Error("not found") as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      },
      exists: () => false,
    },
    env: { get: () => undefined },
  } as unknown as RuntimeAdapter;
}

/** Drain promise continuations without advancing timer-backed work. */
async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 25; index += 1) {
    await Promise.resolve();
  }
}

describe("rendering/orchestrator/layout", () => {
  it("cancels MDX preloading while its shared import map remains pending", async () => {
    clearImportMapCache();
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    mutableRenderer.loadModuleESM = () => Promise.resolve({ default: () => null });

    let resolveImportMapRead!: (source: string) => void;
    const importMapRead = new Promise<string>((resolve) => {
      resolveImportMapRead = resolve;
    });
    let markImportMapReadStarted!: () => void;
    const importMapReadStarted = new Promise<void>((resolve) => {
      markImportMapReadStarted = resolve;
    });
    const adapter = createMockAdapter();
    adapter.fs.readFile = () => {
      markImportMapReadStarted();
      return importMapRead;
    };
    const orchestrator = new LayoutOrchestrator({
      projectDir: "/pending-import-map-project",
      projectId: "pending-import-map-project-id",
      projectSlug: "pending-import-map-project",
      contentSourceId: "pending-import-map-release",
      adapter,
      config: validateVeryfrontConfig({ react: { version: "19.1.1" } }),
      mode: "production",
      environment: "production",
      layoutCollector: {} as LayoutCollector,
      layoutCompiler: {} as LayoutCompiler,
      layoutCache: createLayoutComponentCache(),
      componentRegistry: {},
    });
    const controller = new AbortController();
    const cancellation = new Error("render canceled during import-map preload");
    const preloadResult = orchestrator.preloadLayoutModules(
      [{
        kind: "mdx",
        path: "/pending-import-map-project/layout.mdx",
        bundle: { compiledCode: "export default function Layout() { return null; }" },
      } as LayoutItem],
      undefined,
      undefined,
      undefined,
      undefined,
      controller.signal,
    );

    try {
      await importMapReadStarted;
      controller.abort(cancellation);

      const outcome = await Promise.race([
        preloadResult.then((): unknown => "resolved", (error: unknown) => error),
        flushMicrotasks().then((): unknown => "still pending"),
      ]);

      assertStrictEquals(
        outcome,
        cancellation,
        "request cancellation must settle preloading without waiting for import-map I/O",
      );
    } finally {
      resolveImportMapRead("{}");
      await preloadResult.catch(() => undefined);
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      clearImportMapCache();
    }
  });

  it("preloads the MDX import map under the exact request context", async () => {
    clearImportMapCache();
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    let observedOptions: Record<string, unknown> | undefined;
    mutableRenderer.loadModuleESM = ((
      _compiledProgramCode: string,
      options: Record<string, unknown> | undefined,
    ) => {
      observedOptions = { ...options };
      return Promise.resolve({ default: () => null });
    }) as typeof mdxRenderer.loadModuleESM;

    const config = validateVeryfrontConfig({
      resolve: {
        importMap: {
          imports: {
            "orchestrator-package": "https://example.com/orchestrator-package.ts",
          },
        },
      },
    });
    const orchestrator = new LayoutOrchestrator({
      projectDir: "/orchestrator-project",
      projectId: "orchestrator-project-id",
      projectSlug: "orchestrator-slug",
      contentSourceId: "release-1",
      adapter: createMissingFileAdapter(),
      config,
      mode: "production",
      environment: "production",
      layoutCollector: {} as LayoutCollector,
      layoutCompiler: {} as LayoutCompiler,
      layoutCache: createLayoutComponentCache(),
      componentRegistry: {},
    });
    const mdxLayout: LayoutItem = {
      kind: "mdx",
      path: "/orchestrator-project/layout.mdx",
      bundle: {
        compiledCode: "export default function Layout() { return null; }",
      } as MdxBundle,
    };

    try {
      const summary = await orchestrator.preloadLayoutModules(
        [mdxLayout],
        undefined,
        { react: "19.1.0" },
      );

      assertEquals(summary.importMapSuccess, true);
      assertEquals(
        observedOptions?.reactVersion,
        "19.1.0",
        "a pinned request must use its own React version, not the memoized one",
      );
      assertEquals(
        orchestrator.getPreloadedImportMap()?.imports?.["orchestrator-package"],
        "https://example.com/orchestrator-package.ts",
      );

      // The orchestrator call site must register the preloaded map under the
      // exact release/config variant, not the ambient projectId-only variant.
      const exactVariant = await getCachedImportMap("orchestrator-project-id", {
        projectDir: "/orchestrator-project",
        contentSourceId: "release-1",
        config,
      });
      assertEquals(
        exactVariant?.imports?.["orchestrator-package"],
        "https://example.com/orchestrator-package.ts",
      );

      const otherContentSource = await getCachedImportMap("orchestrator-project-id", {
        projectDir: "/orchestrator-project",
        contentSourceId: "release-2",
        config,
      });
      assertEquals(otherContentSource, undefined);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      clearImportMapCache();
    }
  });

  it("threads the trusted local-project identity through MDX layout preloading", async () => {
    clearImportMapCache();
    const projectDir = "/<PROJECT_DIR>";
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    let observedIsLocalProject: unknown;
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      observedIsLocalProject = (options as { isLocalProject?: unknown } | undefined)
        ?.isLocalProject;
      return Promise.resolve({ default: () => null });
    };

    const orchestrator = new LayoutOrchestrator({
      projectDir,
      projectId: "local-project",
      projectSlug: "local-project",
      contentSourceId: "local-main",
      adapter: createMockAdapter(),
      config: validateVeryfrontConfig({ react: { version: "19.1.1" } }),
      mode: "development",
      environment: "preview",
      layoutCollector: {} as LayoutCollector,
      layoutCompiler: {} as LayoutCompiler,
      layoutCache: createLayoutComponentCache(),
      componentRegistry: {},
      isLocalProject: true,
    });
    const layouts = [{
      kind: "mdx",
      path: `${projectDir}/layout.mdx`,
      bundle: { compiledCode: "export default function Layout() { return null; }" },
    }] as LayoutItem[];

    try {
      const result = await orchestrator.preloadLayoutModules(layouts);

      assertEquals(result.mdxSuccess, 1);
      assertEquals(observedIsLocalProject, true);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      clearImportMapCache();
    }
  });

  it("gives each pinned preload its own React version on a reused orchestrator", async () => {
    clearImportMapCache();
    const projectDir = "/pinned-project";
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    const observed: Array<Record<string, unknown>> = [];
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      observed.push({ ...(options as Record<string, unknown> | undefined) });
      return Promise.resolve({ default: () => null });
    };

    // One orchestrator serves both requests: a per-instance memo would hand
    // the first request's React version to the second.
    const orchestrator = new LayoutOrchestrator({
      projectDir,
      projectId: "pinned-project",
      projectSlug: "pinned-project",
      contentSourceId: "pinned-main",
      adapter: createMockAdapter(),
      config: validateVeryfrontConfig({ react: { version: "19.1.1" } }),
      mode: "production",
      environment: "preview",
      layoutCollector: {} as LayoutCollector,
      layoutCompiler: {} as LayoutCompiler,
      layoutCache: createLayoutComponentCache(),
      componentRegistry: {},
      isLocalProject: true,
    });
    const layouts = [{
      kind: "mdx",
      path: `${projectDir}/layout.mdx`,
      bundle: { compiledCode: "export default function Layout() { return null; }" },
    }] as LayoutItem[];

    try {
      await orchestrator.preloadLayoutModules(layouts, undefined, { react: "19.1.0" });
      await orchestrator.preloadLayoutModules(layouts, undefined, { react: "18.3.1" });

      assertEquals(
        observed.map((options) => options.reactVersion),
        ["19.1.0", "18.3.1"],
        "each pinned preload must resolve its own React version",
      );
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      clearImportMapCache();
    }
  });

  it("denies the trusted local-project identity to layouts whose orchestrator never claimed it", async () => {
    clearImportMapCache();
    const projectDir = "/untrusted-project";
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    const observed: unknown[] = [];
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      observed.push((options as { isLocalProject?: unknown } | undefined)?.isLocalProject);
      return Promise.resolve({ default: () => null });
    };

    // layout.ts:283 is the covered seam; the apply path repeats the same
    // coercion, so both call sites must keep it a strict `=== true`.
    const preloadWith = (isLocalProject?: boolean) => {
      const orchestrator = new LayoutOrchestrator({
        projectDir,
        projectId: "untrusted-project",
        projectSlug: "untrusted-project",
        contentSourceId: "untrusted-main",
        adapter: createMockAdapter(),
        config: validateVeryfrontConfig({ react: { version: "19.1.1" } }),
        mode: "production",
        environment: "preview",
        layoutCollector: {} as LayoutCollector,
        layoutCompiler: {} as LayoutCompiler,
        layoutCache: createLayoutComponentCache(),
        componentRegistry: {},
        ...(isLocalProject === undefined ? {} : { isLocalProject }),
      });
      const layouts = [{
        kind: "mdx",
        path: `${projectDir}/layout.mdx`,
        bundle: { compiledCode: "export default function Layout() { return null; }" },
      }] as LayoutItem[];
      return orchestrator.preloadLayoutModules(layouts);
    };

    try {
      assertEquals((await preloadWith(false)).mdxSuccess, 1);
      assertEquals((await preloadWith(undefined)).mdxSuccess, 1);

      assertEquals(
        observed,
        [false, false],
        "an unset isLocalProject must coerce to false, never to trusted",
      );
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      clearImportMapCache();
    }
  });

  it("applies layouts under the request environment, not the orchestrator's", async () => {
    const { cache, keys } = recordingCache();
    const orchestrator = new LayoutOrchestrator({
      projectDir: "/project",
      projectId: "apply-project",
      projectSlug: "apply-project",
      contentSourceId: "release-1",
      adapter: createLayoutSourceAdapter("/project/app/layout.tsx"),
      config: validateVeryfrontConfig({ react: { version: "19.1.1" } }),
      mode: "production",
      environment: "production",
      layoutCollector: {} as LayoutCollector,
      layoutCompiler: {} as LayoutCompiler,
      layoutCache: cache,
      componentRegistry: {},
    });

    try {
      await orchestrator.applyLayoutsAndWrappers(
        React.createElement("div") as React.ReactElement,
        { entity: { path: "/project/app/page.tsx", slug: "" } } as EntityInfo,
        undefined,
        [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
        undefined, // layoutDataMap
        undefined, // requestUrl
        undefined, // params
        undefined, // frontmatter
        undefined, // headings
        undefined, // projectSlug
        undefined, // clientPageIsland
        undefined, // pageProps
        undefined, // dependencyPinningCacheKey
        undefined, // dependencyPinningDependencies
        undefined, // dependencyPinningSource
        undefined, // signal
        "preview",
      );

      assertEquals(keys.length > 0, true, "expected the apply phase to consult the layout cache");
      assertEquals(
        markersOf(keys[0]!),
        { dev: false, preview: true },
        "a preview render must not read or write the production layout artifact",
      );
    } finally {
      // The apply phase bundles the framework providers, so release the
      // bundler service the render started.
      const esbuild = await import("veryfront/extensions/bundler");
      await esbuild.stop();
    }
  });

  it("threads the compile mode through MDX layout preloading", async () => {
    clearImportMapCache();
    const projectDir = "/<PROJECT_DIR>";
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    const observed: Array<Record<string, unknown>> = [];
    mutableRenderer.loadModuleESM = (_compiledProgramCode, options) => {
      observed.push({ ...(options as Record<string, unknown> | undefined) });
      return Promise.resolve({ default: () => null });
    };

    const preloadWithModes = (
      mode: "development" | "production",
      environment: RenderEnvironment,
    ) => {
      const orchestrator = new LayoutOrchestrator({
        projectDir,
        projectId: "mode-project",
        projectSlug: "mode-project",
        contentSourceId: "mode-main",
        adapter: createMockAdapter(),
        config: validateVeryfrontConfig({ react: { version: "19.1.1" } }),
        mode,
        environment,
        layoutCollector: {} as LayoutCollector,
        layoutCompiler: {} as LayoutCompiler,
        layoutCache: createLayoutComponentCache(),
        componentRegistry: {},
        isLocalProject: true,
      });
      const layouts = [{
        kind: "mdx",
        path: `${projectDir}/layout.mdx`,
        bundle: { compiledCode: "export default function Layout() { return null; }" },
      }] as LayoutItem[];
      return orchestrator.preloadLayoutModules(layouts);
    };

    try {
      assertEquals((await preloadWithModes("development", "preview")).mdxSuccess, 1);
      // Hosted preview compiles for production, so this case fails if the
      // request vocabulary reaches the loader in place of the compile one.
      assertEquals((await preloadWithModes("production", "preview")).mdxSuccess, 1);
      assertEquals((await preloadWithModes("production", "production")).mdxSuccess, 1);

      // Preloading warms the module cache the apply phase reads back, so a
      // preload that drops the compile mode compiles the layout's modules for
      // production and a development render then serves those artifacts.
      assertEquals(observed.map((options) => options.mode), [
        "development",
        "production",
        "production",
      ]);
      // The compile mode travels a long positional chain: pin the neighbouring
      // arguments so a value landing in the wrong slot fails here too.
      assertEquals(observed.map((options) => options.isLocalProject), [true, true, true]);
      assertEquals(observed.map((options) => options.projectSlug), [
        "mode-project",
        "mode-project",
        "mode-project",
      ]);
      assertEquals(observed.map((options) => options.reactVersion), [
        "19.1.1",
        "19.1.1",
        "19.1.1",
      ]);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
      clearImportMapCache();
    }
  });
});
