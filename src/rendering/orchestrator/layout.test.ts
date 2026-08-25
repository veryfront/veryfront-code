import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { LayoutOrchestrator } from "./layout.ts";
import { createLayoutComponentCache } from "#veryfront/rendering/layouts/utils/component-loader.ts";
import type { LayoutCollector, LayoutCompiler } from "#veryfront/rendering/layouts/index.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import {
  clearImportMapCache,
  getCachedImportMap,
} from "#veryfront/modules/import-map/preloader.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";
import type { RenderEnvironment } from "#veryfront/rendering/context/render-context.ts";

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
    mutableRenderer.loadModuleESM =
      (() => Promise.resolve({ default: () => null })) as typeof mdxRenderer.loadModuleESM;

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
