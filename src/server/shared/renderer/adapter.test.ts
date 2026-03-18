/**
 * Tests for the RendererAdapter layer, exercising lifecycle, error handling,
 * and concurrent-initialization deduplication through the RendererInitializer
 * seam without pulling in the real rendering subsystem.
 */

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { Renderer, RendererOptions } from "#veryfront/rendering/renderer.ts";
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

function waitForMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

  // -- RendererAdapterImpl methods ------------------------------------------

  describe("RendererAdapterImpl methods", () => {
    it("clearCache delegates to renderer.clearCache", async () => {
      const adapter = await getRendererForProject(stubHandlerContext());
      adapter.clearCache("some-slug");
      // clearCache fires async — give it a tick to resolve
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(mockRenderer.calls.clearCache, 1);
    });

    it("clearCache without slug also calls renderer", async () => {
      const adapter = await getRendererForProject(stubHandlerContext());
      adapter.clearCache();
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(mockRenderer.calls.clearCache, 1);
    });

    it("clearAllState delegates to clearCache", async () => {
      const adapter = await getRendererForProject(stubHandlerContext());
      adapter.clearAllState();
      await new Promise((r) => setTimeout(r, 10));
      assertEquals(mockRenderer.calls.clearCache, 1);
    });

    it("getVirtualModuleSystem returns stub methods", async () => {
      const adapter = await getRendererForProject(stubHandlerContext());
      const vms = adapter.getVirtualModuleSystem();

      assertEquals(vms.handleRequest(new Request("http://localhost/test")), null);
      assertEquals(await vms.register("id", "source", "/dir"), "");
      assertEquals(await vms.registerModule("id", "source", "/dir"), "");
      assertEquals(vms.getModule("id"), undefined);
      // clear should not throw
      vms.clear();
    });

    it("initializeComponents resolves without error", async () => {
      const adapter = await getRendererForProject(stubHandlerContext());
      await adapter.initializeComponents();
      // No error thrown = success
    });

    it("destroy resolves without error", async () => {
      const adapter = await getRendererForProject(stubHandlerContext());
      await adapter.destroy();
    });

    it("resolvePageData delegates to renderer", async () => {
      const adapter = await getRendererForProject(stubHandlerContext());
      await adapter.resolvePageData("/about");
      assertEquals(mockRenderer.calls.resolvePageData, 1);
    });
  });

  // -- createContextFromHandler paths ---------------------------------------

  describe("createContextFromHandler", () => {
    it("takes pre-built enriched context fast path", async () => {
      const ctx = stubHandlerContext();
      // enriched is already set — should skip config loading
      const adapter = await getRendererForProject(ctx);
      assertEquals(mockInit.initCount, 1);
      // Adapter should work
      const pages = await adapter.getAllPages();
      assertEquals(pages, ["/"]);
    });

    it("builds enriched context when not pre-populated", async () => {
      const ctx = stubHandlerContext();
      ctx.enriched = undefined;
      ctx.config = { pages: { include: ["**/*.mdx"] } };
      ctx.projectDir = "/tmp/test-project";
      ctx.adapter = {
        fs: {
          exists: () => Promise.resolve(false),
          readFile: () => Promise.resolve(""),
          readDir: async function* () {},
          stat: () => Promise.resolve({ isFile: false, isDirectory: false }),
        },
        env: { get: () => undefined, set: () => {}, delete: () => {}, toObject: () => ({}) },
      } as unknown as any;

      const adapter = await getRendererForProject(ctx);
      // Should have built enriched context and stored it
      assertEquals(ctx.enriched !== undefined, true);
      const pages = await adapter.getAllPages();
      assertEquals(pages, ["/"]);
    });

    it("resolves production environment from resolvedEnvironment", async () => {
      const ctx = stubHandlerContext();
      ctx.enriched = undefined;
      ctx.resolvedEnvironment = "production";
      ctx.config = { pages: { include: ["**/*.mdx"] } };
      ctx.adapter = {
        fs: {
          exists: () => Promise.resolve(false),
          readFile: () => Promise.resolve(""),
          readDir: async function* () {},
          stat: () => Promise.resolve({ isFile: false, isDirectory: false }),
        },
        env: { get: () => undefined, set: () => {}, delete: () => {}, toObject: () => ({}) },
      } as unknown as any;

      await getRendererForProject(ctx);
      assertEquals(ctx.enriched !== undefined, true);
      assertEquals(ctx.enriched.environment, "production");
    });

    it("resolves preview environment from domain staging", async () => {
      const ctx = stubHandlerContext();
      ctx.enriched = undefined;
      ctx.resolvedEnvironment = undefined;
      ctx.parsedDomain = {
        slug: null,
        branch: null,
        environment: "staging",
        isVeryfrontDomain: false,
        isDraft: false,
        allowIframeEmbed: false,
      } as any;
      ctx.config = { pages: { include: ["**/*.mdx"] } };
      ctx.adapter = {
        fs: {
          exists: () => Promise.resolve(false),
          readFile: () => Promise.resolve(""),
          readDir: async function* () {},
          stat: () => Promise.resolve({ isFile: false, isDirectory: false }),
        },
        env: { get: () => undefined, set: () => {}, delete: () => {}, toObject: () => ({}) },
      } as unknown as any;

      await getRendererForProject(ctx);
      assertEquals(ctx.enriched !== undefined, true);
      assertEquals(ctx.enriched.environment, "preview");
    });

    it("loads config when not provided and enriched is absent", async () => {
      const ctx = stubHandlerContext();
      ctx.enriched = undefined;
      ctx.config = undefined;
      ctx.projectDir = "/tmp/test-project";
      ctx.adapter = {
        fs: {
          exists: () => Promise.resolve(false),
          readFile: () => Promise.resolve(""),
          readDir: async function* () {},
          stat: () => Promise.resolve({ isFile: false, isDirectory: false }),
        },
        env: { get: () => undefined, set: () => {}, delete: () => {}, toObject: () => ({}) },
      } as unknown as any;

      const adapter = await getRendererForProject(ctx);
      // Config was loaded (or defaulted) and enriched context was built
      assertEquals(ctx.enriched !== undefined, true);
      const pages = await adapter.getAllPages();
      assertEquals(pages, ["/"]);
    });

    it("derives projectId from projectDir when no explicit id", async () => {
      const ctx = stubHandlerContext();
      ctx.enriched = undefined;
      ctx.projectId = undefined;
      ctx.projectSlug = undefined;
      ctx.projectDir = "/tmp/my-special-project";
      ctx.config = { pages: { include: ["**/*.mdx"] } };
      ctx.adapter = {
        fs: {
          exists: () => Promise.resolve(false),
          readFile: () => Promise.resolve(""),
          readDir: async function* () {},
          stat: () => Promise.resolve({ isFile: false, isDirectory: false }),
        },
        env: { get: () => undefined, set: () => {}, delete: () => {}, toObject: () => ({}) },
      } as unknown as any;

      await getRendererForProject(ctx);
      assertEquals(ctx.enriched !== undefined, true);
      // Should derive from last path segment
      assertEquals(ctx.enriched.projectId, "my-special-project");
    });

    it("clearCache handles renderer.clearCache rejection silently", async () => {
      // Create a renderer whose clearCache rejects
      const failingRenderer = createMockRenderer();
      (failingRenderer as any).clearCache = async () => {
        throw new Error("cache clear fail");
      };
      const failingInit = createMockInitializer(failingRenderer);
      setRendererInitializer(failingInit);

      const adapter = await getRendererForProject(stubHandlerContext());
      // Should not throw
      adapter.clearCache("test-slug");
      await new Promise((r) => setTimeout(r, 20));
      // Just verify it didn't crash
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

      // Swap initializer - next call should re-initialize through the new seam
      setRendererInitializer(secondInit);

      await getRendererForProject(stubHandlerContext());
      assertEquals(secondInit.initCount, 1);
      // Original initializer should not have been called again
      assertEquals(mockInit.initCount, 1);
    });

    it("destroys the replaced initializer when swapping to a new one", async () => {
      await getRendererForProject(stubHandlerContext());
      assertEquals(mockInit.destroyCount, 0);

      const secondInit = createMockInitializer(createMockRenderer());
      setRendererInitializer(secondInit);
      await waitForMicrotasks();

      assertEquals(mockInit.destroyCount, 1);
    });

    it("destroys a replaced initializer after its in-flight init settles", async () => {
      let resolveInit!: (renderer: Renderer) => void;
      const slowRenderer = createMockRenderer();
      const slowInit = createMockInitializer(slowRenderer);
      slowInit.initialize = (_options: RendererOptions) => {
        slowInit.initCount++;
        return new Promise<Renderer>((resolve) => {
          resolveInit = resolve;
        });
      };
      slowInit.isInitialized = () => false;

      setRendererInitializer(slowInit);
      const pendingAdapter = getRendererForProject(stubHandlerContext());

      const replacement = createMockInitializer(createMockRenderer());
      setRendererInitializer(replacement);

      resolveInit(slowRenderer);
      await pendingAdapter;
      await waitForMicrotasks();

      assertEquals(slowInit.destroyCount, 1);
    });
  });
});
