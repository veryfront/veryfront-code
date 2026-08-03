import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import type { LayoutItem } from "#veryfront/types";
import { LayoutOrchestrator } from "./layout.ts";

describe("rendering/orchestrator/layout", () => {
  it("threads the trusted local-project identity through MDX layout preloading", async () => {
    const originalLoadModuleESM = mdxRenderer.loadModuleESM;
    const mutableRenderer = mdxRenderer as unknown as {
      loadModuleESM: typeof mdxRenderer.loadModuleESM;
    };
    let observedIsLocalProject: unknown;
    mutableRenderer.loadModuleESM = ((...args: unknown[]) => {
      observedIsLocalProject = args[11];
      return Promise.resolve({ default: () => null });
    }) as typeof mdxRenderer.loadModuleESM;

    const orchestrator = new LayoutOrchestrator({
      projectDir: "/project",
      projectId: "local-project",
      projectSlug: "local-project",
      contentSourceId: "local-main",
      adapter: createMockAdapter(),
      config: { react: { version: "19.1.1" } },
      mode: "development",
      layoutCollector: {} as never,
      layoutCompiler: {} as never,
      layoutCache: {} as never,
      componentRegistry: {},
      isLocalProject: true,
    });
    const layouts = [{
      kind: "mdx",
      path: "/project/layout.mdx",
      bundle: { compiledCode: "export default function Layout() { return null; }" },
    }] as LayoutItem[];

    try {
      const result = await orchestrator.preloadLayoutModules(layouts);

      assertEquals(result.mdxSuccess, 1);
      assertEquals(observedIsLocalProject, true);
    } finally {
      mutableRenderer.loadModuleESM = originalLoadModuleESM;
    }
  });
});
