import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import type { LayoutItem } from "#veryfront/types";
import type { LayoutComponentCache } from "#veryfront/rendering/layouts/utils/component-loader.ts";
import { LayoutApplicator } from "#veryfront/rendering/layouts/layout-applicator.ts";
import { LayoutOrchestrator } from "#veryfront/rendering/orchestrator/layout.ts";
import type { LayoutCollector, LayoutCompiler } from "#veryfront/rendering/layouts/index.ts";
import {
  createComponentRegistry,
  createPageRenderer,
} from "#veryfront/rendering/factories/service-factories.ts";
import { VirtualModuleSystem } from "./virtual-module-system.ts";
import type { ComponentRegistry } from "#veryfront/rendering/ssr/component-registry.ts";
import type { PageRenderer } from "./page-renderer.ts";
import type { RenderContext, RenderModes } from "#veryfront/rendering/context/render-context.ts";
import { HTMLGenerator } from "#veryfront/rendering/orchestrator/html.ts";
import { RendererLifecycle } from "#veryfront/rendering/orchestrator/lifecycle.ts";
import { ConfigurationManager } from "#veryfront/rendering/orchestrator/config.ts";
import { VeryfrontRenderer } from "#veryfront/rendering/orchestrator/ssr.ts";

/**
 * The mode pair is only useful if every link between the render context and the
 * component loader keeps carrying it. A verifier's mutation run on #3841 showed
 * the middle links were guarded by nothing: reverting layout-applicator,
 * layouts/utils/applicator, orchestrator/layout, factories/service-factories
 * and orchestrator/lifecycle reproduced the bug with an identical suite result.
 *
 * These cases read the mode pair back out of each link, so dropping it from any
 * one of them fails here rather than only in production.
 */

const LAYOUT_SOURCE = "export default function Layout() { return null; }";

const HOSTED_PREVIEW: RenderModes = { compileMode: "production", environment: "preview" };
const HOSTED_PRODUCTION: RenderModes = { compileMode: "production", environment: "production" };
const LOCAL_DEV: RenderModes = { compileMode: "development", environment: "preview" };

function StubLayout(): null {
  return null;
}

/**
 * A layout cache that records the keys it is asked for and always answers with
 * a stub. `loadTSXComponent` stamps the compile mode and the request
 * environment into the key before the lookup, so the recorded key is a faithful
 * readout of the mode pair the caller supplied, and the always-hit keeps the
 * case off the real esbuild transform.
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

function sourceAdapter(): RuntimeAdapter {
  return {
    fs: { readFile: () => Promise.resolve(LAYOUT_SOURCE) },
  } as unknown as RuntimeAdapter;
}

function markersOf(key: string): { dev: boolean; preview: boolean } {
  return { dev: key.includes(":dev"), preview: key.includes(":preview") };
}

function renderContext(modes: RenderModes): RenderContext {
  return {
    projectId: "project-id",
    projectSlug: "project-slug",
    projectDir: "/project",
    config: validateVeryfrontConfig({}),
    mode: modes.compileMode,
    environment: modes.environment,
    adapter: createMockAdapter() as unknown as RuntimeAdapter,
    cachePrefix: "prefix",
    contentSourceId: "release-1",
  } as RenderContext;
}

function readRenderModes(registry: ComponentRegistry): RenderModes {
  return (registry as unknown as { renderModes: RenderModes }).renderModes;
}

function readEnvironment(pageRenderer: PageRenderer): string {
  return (pageRenderer as unknown as { environment: string }).environment;
}

describe("render mode threading", () => {
  describe("layouts/layout-applicator.ts and layouts/utils/applicator.ts", () => {
    // applyLayoutsFunctionBody is the default path: esmLayouts is off unless
    // the project opts in.
    for (
      const scenario of [
        { name: "hosted production", modes: HOSTED_PRODUCTION, dev: false, preview: false },
        { name: "hosted preview", modes: HOSTED_PREVIEW, dev: false, preview: true },
        { name: "local development", modes: LOCAL_DEV, dev: true, preview: true },
      ]
    ) {
      it(`carries the ${scenario.name} mode pair into the layout loader`, async () => {
        const { cache, keys } = recordingCache();
        const applicator = new LayoutApplicator({
          projectDir: "/project",
          projectId: "project",
          projectSlug: "project",
          contentSourceId: "release-1",
          adapter: sourceAdapter(),
          config: validateVeryfrontConfig({ react: { version: "19.1.1" } }),
          layoutCache: cache,
          mergedComponents: {},
          mode: scenario.modes.compileMode,
          environment: scenario.modes.environment,
          reactVersion: "19.1.1",
        });

        const nestedLayouts: LayoutItem[] = [
          { kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem,
        ];

        await (applicator as unknown as {
          applyLayoutsOnly(
            pageElement: React.ReactElement,
            layoutBundle: undefined,
            nestedLayouts: LayoutItem[],
          ): Promise<React.ReactElement>;
        }).applyLayoutsOnly(
          React.createElement("div") as React.ReactElement,
          undefined,
          nestedLayouts,
        );

        assertEquals(keys.length > 0, true, "expected the layout loader to consult the cache");
        assertEquals(markersOf(keys[0]!), { dev: scenario.dev, preview: scenario.preview });
      });
    }

    it("carries the mode pair through the ESM layout path too", async () => {
      const { cache, keys } = recordingCache();
      const applicator = new LayoutApplicator({
        projectDir: "/project",
        projectId: "project",
        projectSlug: "project",
        contentSourceId: "release-1",
        adapter: sourceAdapter(),
        config: validateVeryfrontConfig({
          react: { version: "19.1.1" },
          experimental: { esmLayouts: true },
        }),
        layoutCache: cache,
        mergedComponents: {},
        mode: HOSTED_PREVIEW.compileMode,
        environment: HOSTED_PREVIEW.environment,
        reactVersion: "19.1.1",
      });

      await (applicator as unknown as {
        applyLayoutsOnly(
          pageElement: React.ReactElement,
          layoutBundle: undefined,
          nestedLayouts: LayoutItem[],
        ): Promise<React.ReactElement>;
      }).applyLayoutsOnly(
        React.createElement("div") as React.ReactElement,
        undefined,
        [{ kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem],
      );

      assertEquals(keys.length > 0, true, "expected the ESM layout path to consult the cache");
      assertEquals(markersOf(keys[0]!), { dev: false, preview: true });
    });
  });

  describe("orchestrator/layout.ts", () => {
    it("primes the layout preload cache under the request environment", async () => {
      const { cache, keys } = recordingCache();
      const orchestrator = new LayoutOrchestrator({
        projectDir: "/project",
        projectId: "project",
        projectSlug: "project",
        contentSourceId: "release-1",
        adapter: sourceAdapter(),
        config: validateVeryfrontConfig({ react: { version: "19.1.1" } }),
        mode: HOSTED_PREVIEW.compileMode,
        environment: "production",
        layoutCollector: {} as LayoutCollector,
        layoutCompiler: {} as LayoutCompiler,
        layoutCache: cache,
        componentRegistry: {},
      });

      await orchestrator.preloadLayoutModules(
        [
          { kind: "tsx", componentPath: "/project/app/layout.tsx" } as LayoutItem,
        ],
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        "preview",
      );

      assertEquals(keys.length > 0, true, "expected the preload to consult the cache");
      // A preload keyed as production would leave the apply phase to recompile,
      // silently doubling the cold-start cost of every hosted preview render.
      assertEquals(markersOf(keys[0]!), { dev: false, preview: true });
    });

    it("hands the request environment to the layout applicator it builds", () => {
      const orchestrator = new LayoutOrchestrator({
        projectDir: "/project",
        projectId: "project",
        projectSlug: "project",
        contentSourceId: "release-1",
        adapter: sourceAdapter(),
        config: validateVeryfrontConfig({}),
        mode: HOSTED_PREVIEW.compileMode,
        environment: HOSTED_PREVIEW.environment,
        layoutCollector: {} as LayoutCollector,
        layoutCompiler: {} as LayoutCompiler,
        layoutCache: recordingCache().cache,
        componentRegistry: {},
      });

      const modes = (orchestrator as unknown as { renderModes: RenderModes }).renderModes;
      assertEquals(modes, HOSTED_PREVIEW);
    });
  });

  describe("orchestrator/ssr.ts", () => {
    it("inherits configured preview without synthesizing production", () => {
      const previewRenderer = new VeryfrontRenderer({
        projectDir: "/project",
        mode: "production",
        environment: "preview",
        adapter: createMockAdapter(),
      });
      const productionRenderer = new VeryfrontRenderer({
        projectDir: "/project",
        mode: "production",
        environment: "production",
        adapter: createMockAdapter(),
      });
      const mergePreviewOptions = (previewRenderer as unknown as {
        mergeRenderOptions(options?: { environment?: "preview" | "production" }): {
          environment?: "preview" | "production";
        };
      }).mergeRenderOptions.bind(previewRenderer);
      const mergeProductionOptions = (productionRenderer as unknown as {
        mergeRenderOptions(options?: { environment?: "preview" | "production" }): {
          environment?: "preview" | "production";
        };
      }).mergeRenderOptions.bind(productionRenderer);

      assertEquals(mergePreviewOptions().environment, "preview");
      assertEquals(mergePreviewOptions({ environment: "production" }).environment, "production");
      assertEquals(mergeProductionOptions().environment, undefined);
      assertEquals(mergeProductionOptions({ environment: "preview" }).environment, "preview");
    });
  });

  describe("factories/service-factories.ts", () => {
    it("gives the component registry the render context mode pair", () => {
      const ctx = renderContext(HOSTED_PREVIEW);
      const registry = createComponentRegistry(
        ctx,
        new VirtualModuleSystem("/_veryfront/modules", ctx.adapter),
      );

      assertEquals(readRenderModes(registry), HOSTED_PREVIEW);
    });

    it("gives the page renderer the render context environment", () => {
      const ctx = renderContext(HOSTED_PREVIEW);
      const registry = createComponentRegistry(
        ctx,
        new VirtualModuleSystem("/_veryfront/modules", ctx.adapter),
      );
      const pageRenderer = createPageRenderer(ctx, {
        componentRegistry: registry,
        compileMDX: () => Promise.reject(new Error("not used")),
      });

      assertEquals(readEnvironment(pageRenderer), "preview");
    });

    it("keeps production renders out of preview instrumentation", () => {
      const ctx = renderContext(HOSTED_PRODUCTION);
      const registry = createComponentRegistry(
        ctx,
        new VirtualModuleSystem("/_veryfront/modules", ctx.adapter),
      );
      const pageRenderer = createPageRenderer(ctx, {
        componentRegistry: registry,
        compileMDX: () => Promise.reject(new Error("not used")),
      });

      assertEquals(readRenderModes(registry), HOSTED_PRODUCTION);
      assertEquals(readEnvironment(pageRenderer), "production");
    });
  });

  describe("orchestrator/html.ts", () => {
    it("defaults the reserved error component to production when nothing resolves", () => {
      const generator = new HTMLGenerator({
        projectDir: "/project",
        adapter: sourceAdapter(),
        config: validateVeryfrontConfig({}),
        mode: "production",
        environment: "production",
      });

      assertEquals(
        (generator as unknown as { config: { environment?: string } }).config.environment,
        "production",
      );
    });
  });

  describe("orchestrator/lifecycle.ts", () => {
    async function lifecycleFor(
      modes: RenderModes | undefined,
      compileMode: "development" | "production",
    ): Promise<RendererLifecycle> {
      const configManager = new ConfigurationManager({
        projectDir: "/project",
        mode: compileMode,
        adapter: createMockAdapter() as unknown as RuntimeAdapter,
        config: validateVeryfrontConfig({}),
      });
      await configManager.initialize();

      return new RendererLifecycle({
        configManager,
        port: 3000,
        projectId: "project-id",
        contentSourceId: "release-1",
        ...(modes ? { environment: modes.environment } : {}),
      });
    }

    it("builds services under the request environment it was given", async () => {
      const services = await (await lifecycleFor(HOSTED_PREVIEW, "production")).initialize();

      assertEquals(readRenderModes(services.componentRegistry), HOSTED_PREVIEW);
      assertEquals(readEnvironment(services.pageRenderer), "preview");
    });

    it("defaults to production when no environment is supplied", async () => {
      const services = await (await lifecycleFor(undefined, "production")).initialize();

      assertEquals(readRenderModes(services.componentRegistry), HOSTED_PRODUCTION);
      assertEquals(readEnvironment(services.pageRenderer), "production");
    });
  });
});
