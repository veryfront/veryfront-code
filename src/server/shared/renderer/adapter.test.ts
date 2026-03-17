/**
 * Tests for the RendererAdapter layer, exercising lifecycle, error handling,
 * and concurrent-initialization deduplication through the RendererInitializer
 * seam without pulling in the real rendering subsystem.
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { Renderer, RendererOptions } from "#veryfront/rendering/renderer.ts";
import type { RenderContext } from "#veryfront/rendering/renderer.ts";
import {
  destroyRendererAdapter,
  getRendererForProject,
  type RendererInitializer,
  setRendererInitializer,
} from "./adapter.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal mock Renderer that records calls. */
function createMockRenderer(): Renderer & { calls: Record<string, number> } {
  const calls: Record<string, number> = {
    renderPage: 0,
    resolvePageData: 0,
    getAllPages: 0,
    clearCache: 0,
    destroy: 0,
  };

  return {
    calls,
    // deno-lint-ignore no-explicit-any
    async renderPage(_slug: string, _ctx: any, _opts?: any) {
      calls.renderPage++;
      return { html: "<h1>mock</h1>", frontmatter: {} } as any; // deno-lint-ignore no-explicit-any
    },
    // deno-lint-ignore no-explicit-any
    async resolvePageData(_slug: string, _ctx: any, _opts?: any) {
      calls.resolvePageData++;
      return { data: {} } as any; // deno-lint-ignore no-explicit-any
    },
    // deno-lint-ignore no-explicit-any
    async getAllPages(_ctx: any) {
      calls.getAllPages++;
      return ["/"];
    },
    // deno-lint-ignore no-explicit-any
    async clearCache(_ctx: any, _slug?: string) {
      calls.clearCache++;
    },
    async destroy() {
      calls.destroy++;
    },
    // deno-lint-ignore no-explicit-any
    async initialize(_opts?: any) {},
  } as unknown as Renderer & { calls: Record<string, number> };
}

/**
 * Creates a RendererInitializer backed by the supplied mock renderer.
 * Tracks how many times `initialize` / `destroy` were called.
 */
function createMockInitializer(
  mockRenderer: Renderer,
): RendererInitializer & { initCount: number; destroyCount: number } {
  let initialized = false;

  const init: RendererInitializer & { initCount: number; destroyCount: number } = {
    initCount: 0,
    destroyCount: 0,
    async initialize(_options: RendererOptions): Promise<Renderer> {
      init.initCount++;
      initialized = true;
      return mockRenderer;
    },
    isInitialized() {
      return initialized;
    },
    get() {
      return mockRenderer;
    },
    async destroy() {
      init.destroyCount++;
      initialized = false;
    },
  };

  return init;
}

/**
 * Minimal HandlerContext stub sufficient for `getRendererForProject`.
 * Uses an enriched context shortcut so we skip config loading.
 */
// deno-lint-ignore no-explicit-any
function stubHandlerContext(): any {
  return {
    projectSlug: "test-project",
    projectId: "proj-123",
    projectDir: "/tmp/test-project",
    isLocalProject: true,
    enriched: {
      projectId: "proj-123",
      projectSlug: "test-project",
      projectDir: "/tmp/test-project",
      token: "",
      environment: "preview" as const,
      branch: null,
      isLocalProject: true,
      contentSourceId: "local-main",
      parsedDomain: {
        slug: null,
        branch: null,
        environment: null,
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      },
      adapter: {
        readFile: async () => "",
        readDir: async () => [],
        exists: async () => false,
        resolveModule: async () => ({ url: "", source: "" }),
        getProjectDir: () => "/tmp/test-project",
      },
      config: {
        pages: { include: ["**/*.mdx"] },
      },
      releaseId: undefined,
      environmentName: undefined,
      moduleServerUrl: undefined,
      debug: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RendererAdapter with RendererInitializer", () => {
  let mockRenderer: Renderer & { calls: Record<string, number> };
  let mockInit: RendererInitializer & { initCount: number; destroyCount: number };

  beforeEach(() => {
    mockRenderer = createMockRenderer();
    mockInit = createMockInitializer(mockRenderer);
    setRendererInitializer(mockInit);
  });

  afterEach(async () => {
    // Tear down and restore the default initializer
    await destroyRendererAdapter();
    setRendererInitializer(undefined);
  });

  // -- Lifecycle ------------------------------------------------------------

  describe("lifecycle", () => {
    it("initializes the renderer on first getRendererForProject call", async () => {
      assertEquals(mockInit.initCount, 0);

      const adapter = await getRendererForProject(stubHandlerContext());
      assertEquals(mockInit.initCount, 1);

      // Adapter should be usable
      const pages = await adapter.getAllPages();
      assertEquals(pages, ["/"]);
    });

    it("reuses an already-initialized renderer on subsequent calls", async () => {
      await getRendererForProject(stubHandlerContext());
      assertEquals(mockInit.initCount, 1);

      await getRendererForProject(stubHandlerContext());
      // initialize() should not be called again because isInitialized() returns true
      assertEquals(mockInit.initCount, 1);
    });

    it("delegates render calls to the underlying renderer", async () => {
      const adapter = await getRendererForProject(stubHandlerContext());

      await adapter.renderPage("/index");
      assertEquals(mockRenderer.calls.renderPage, 1);

      await adapter.resolvePageData("/about");
      assertEquals(mockRenderer.calls.resolvePageData, 1);

      await adapter.getAllPages();
      assertEquals(mockRenderer.calls.getAllPages, 1);
    });

    it("destroyRendererAdapter delegates to the active initializer", async () => {
      await getRendererForProject(stubHandlerContext());
      assertEquals(mockInit.destroyCount, 0);

      await destroyRendererAdapter();
      assertEquals(mockInit.destroyCount, 1);
    });
  });

  // -- Error handling -------------------------------------------------------

  describe("error handling", () => {
    it("propagates initialization errors", async () => {
      const failingInit: RendererInitializer = {
        async initialize(_options: RendererOptions): Promise<Renderer> {
          throw new Error("renderer init failed");
        },
        isInitialized: () => false,
        get: () => {
          throw new Error("not initialized");
        },
        destroy: async () => {},
      };
      setRendererInitializer(failingInit);

      await assertRejects(
        () => getRendererForProject(stubHandlerContext()),
        Error,
        "renderer init failed",
      );
    });

    it("allows retry after initialization failure", async () => {
      let attempt = 0;
      const retryInit: RendererInitializer = {
        async initialize(_options: RendererOptions): Promise<Renderer> {
          attempt++;
          if (attempt === 1) throw new Error("transient failure");
          return mockRenderer;
        },
        isInitialized: () => attempt >= 2,
        get: () => mockRenderer,
        destroy: async () => {},
      };
      setRendererInitializer(retryInit);

      // First call fails
      await assertRejects(
        () => getRendererForProject(stubHandlerContext()),
        Error,
        "transient failure",
      );

      // Second call should succeed because the promise was cleared in `finally`
      const adapter = await getRendererForProject(stubHandlerContext());
      const pages = await adapter.getAllPages();
      assertEquals(pages, ["/"]);
    });
  });

  // -- Concurrent initialization dedup --------------------------------------

  describe("concurrent initialization dedup", () => {
    it("deduplicates concurrent initialize calls into a single invocation", async () => {
      let resolveInit!: (r: Renderer) => void;
      const slowInit: RendererInitializer = {
        async initialize(_options: RendererOptions): Promise<Renderer> {
          mockInit.initCount++;
          return new Promise<Renderer>((resolve) => {
            resolveInit = resolve;
          });
        },
        isInitialized: () => false,
        get: () => mockRenderer,
        destroy: async () => {},
      };
      setRendererInitializer(slowInit);

      // Fire two concurrent requests
      const p1 = getRendererForProject(stubHandlerContext());
      const p2 = getRendererForProject(stubHandlerContext());

      // Resolve the single init
      resolveInit(mockRenderer);

      const [a1, a2] = await Promise.all([p1, p2]);

      // Only one initialize call despite two concurrent requests
      assertEquals(mockInit.initCount, 1);

      // Both adapters should work
      assertEquals(await a1.getAllPages(), ["/"]);
      assertEquals(await a2.getAllPages(), ["/"]);
    });
  });

  // -- setRendererInitializer -----------------------------------------------

  describe("setRendererInitializer", () => {
    it("restores default initializer when called with undefined", () => {
      // Calling with undefined should not throw
      setRendererInitializer(undefined);

      // We can't easily verify the default is restored without
      // actually calling initializeRenderer (which we don't want in tests),
      // but we can verify the function doesn't throw.
    });

    it("replaces the active initializer", async () => {
      const secondRenderer = createMockRenderer();
      const secondInit = createMockInitializer(secondRenderer);

      // First init
      await getRendererForProject(stubHandlerContext());
      assertEquals(mockInit.initCount, 1);

      // Swap initializer - destroys state so next call re-initializes
      await destroyRendererAdapter();
      setRendererInitializer(secondInit);

      await getRendererForProject(stubHandlerContext());
      assertEquals(secondInit.initCount, 1);
      // Original initializer should not have been called again
      assertEquals(mockInit.initCount, 1);

      // Cleanup the second initializer
      await destroyRendererAdapter();
    });
  });
});
