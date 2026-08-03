import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { LayoutOrchestrator } from "./layout.ts";
import { createLayoutComponentCache } from "../layouts/utils/component-loader.ts";
import type { LayoutCollector, LayoutCompiler } from "../layouts/index.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import {
  clearImportMapCache,
  getCachedImportMap,
} from "#veryfront/modules/import-map/preloader.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle } from "#veryfront/types";

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

describe("rendering/orchestrator/layout", () => {
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
});
