import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SSRService } from "./ssr.service.ts";
import type { RendererProvider, SSRRenderOptions } from "./ssr.service.ts";
import type { HandlerContext } from "../../handlers/types.ts";
import type { RendererAdapter } from "../../shared/renderer-factory.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { VeryfrontError } from "#veryfront/errors/index.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(false),
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null }),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  };
}

function makeRenderOptions(overrides: Partial<SSRRenderOptions> = {}): SSRRenderOptions {
  const url = new URL("http://localhost/test-page");
  return {
    request: new Request(url),
    url,
    slug: "test-page",
    nonce: "test-nonce",
    studioEmbed: false,
    noHmr: false,
    useNoCache: false,
    ...overrides,
  };
}

function createMockRendererAdapter(
  overrides: Partial<RendererAdapter> = {},
): RendererAdapter {
  return {
    renderPage: () =>
      Promise.resolve({ html: "<html>mock</html>", stream: undefined, ssrHash: "abc" }),
    resolvePageData: () => Promise.resolve({} as any),
    getAllPages: () => Promise.resolve([]),
    clearCache: () => {},
    clearAllState: () => {},
    getVirtualModuleSystem: () => ({
      handleRequest: () => null,
      register: async () => "",
      registerModule: async () => "",
      getModule: () => undefined,
      clear: () => {},
    }),
    initializeComponents: () => Promise.resolve(),
    compileMDX: () => Promise.resolve({} as any),
    destroy: () => Promise.resolve(),
    ...overrides,
  } as RendererAdapter;
}

function createMockRendererProvider(
  adapter?: RendererAdapter,
): RendererProvider {
  const mockAdapter = adapter ?? createMockRendererAdapter();
  return {
    getRenderer: () => Promise.resolve(mockAdapter),
  };
}

describe("server/services/rendering/ssr.service", () => {
  describe("SSRService", () => {
    describe("constructor", () => {
      it("creates instance without options", () => {
        const service = new SSRService();
        assertEquals(service instanceof SSRService, true);
      });

      it("creates instance with empty options", () => {
        const service = new SSRService({});
        assertEquals(service instanceof SSRService, true);
      });

      it("creates instance with cacheRepo option", () => {
        const mockRepo = {
          get: () => Promise.resolve(null),
          set: () => Promise.resolve(),
          delete: () => Promise.resolve(),
        };
        const service = new SSRService({ cacheRepo: mockRepo as any });
        assertEquals(service instanceof SSRService, true);
      });

      it("creates instance with custom rendererProvider", () => {
        const provider = createMockRendererProvider();
        const service = new SSRService({ rendererProvider: provider });
        assertEquals(service instanceof SSRService, true);
      });
    });

    describe("checkMemoryPressure", () => {
      it("returns MemoryStatus object", () => {
        const service = new SSRService();
        const status = service.checkMemoryPressure();
        assertEquals(typeof status.shouldReject, "boolean");
        assertEquals(typeof status.heapUsedMB, "number");
        assertEquals(typeof status.heapLimitMB, "number");
        assertEquals(typeof status.heapUsedPercent, "number");
      });

      it("returns non-negative heap values", () => {
        const service = new SSRService();
        const status = service.checkMemoryPressure();
        assertEquals(status.heapUsedMB >= 0, true);
        assertEquals(status.heapLimitMB >= 0, true);
        assertEquals(status.heapUsedPercent >= 0, true);
      });
    });

    describe("createMemoryPressureResult", () => {
      it("returns result with 503 status", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("test-slug");
        assertEquals(result.status, 503);
      });

      it("returns non-streaming result", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("test-slug");
        assertEquals(result.isStreaming, false);
      });

      it("returns no-cache strategy", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("test-slug");
        assertEquals(result.cacheStrategy, "no-cache");
      });

      it("preserves slug in result", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("my-page");
        assertEquals(result.slug, "my-page");
      });

      it("returns HTML content", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("test");
        assertEquals(typeof result.html, "string");
        assertEquals((result.html?.length ?? 0) > 0, true);
      });
    });

    describe("getRenderer (with injected RendererProvider)", () => {
      it("delegates to the injected provider", async () => {
        let called = false;
        const provider: RendererProvider = {
          getRenderer: () => {
            called = true;
            return Promise.resolve(createMockRendererAdapter());
          },
        };
        const service = new SSRService({ rendererProvider: provider });
        await service.getRenderer(makeCtx());
        assertEquals(called, true);
      });

      it("passes handler context to the provider", async () => {
        let receivedCtx: HandlerContext | null = null;
        const provider: RendererProvider = {
          getRenderer: (ctx) => {
            receivedCtx = ctx;
            return Promise.resolve(createMockRendererAdapter());
          },
        };
        const service = new SSRService({ rendererProvider: provider });
        const ctx = makeCtx({ projectSlug: "my-project" });
        await service.getRenderer(ctx);
        assertEquals(receivedCtx?.projectSlug, "my-project");
      });
    });

    describe("renderPage (with mock renderer)", () => {
      it("returns 200 with HTML from renderer", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () =>
            Promise.resolve({
              html: "<html>rendered</html>",
              stream: undefined,
              ssrHash: "hash123",
            }),
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 200);
        assertEquals(result.html, "<html>rendered</html>");
        assertEquals(result.isStreaming, false);
        assertEquals(result.slug, "test-page");
      });

      it("returns streaming result when renderer provides stream only", async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("<html>stream</html>"));
            controller.close();
          },
        });
        const adapter = createMockRendererAdapter({
          renderPage: () => Promise.resolve({ html: undefined, stream, ssrHash: undefined }),
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 200);
        assertEquals(result.isStreaming, true);
        assertEquals(result.stream !== undefined, true);
        assertEquals(result.etag, undefined);
      });

      it("uses short cache strategy when useNoCache is false", async () => {
        const adapter = createMockRendererAdapter();
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(
          makeCtx(),
          makeRenderOptions({ useNoCache: false }),
        );
        assertEquals(result.cacheStrategy, "short");
      });

      it("uses no-cache strategy when useNoCache is true", async () => {
        const adapter = createMockRendererAdapter();
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(
          makeCtx(),
          makeRenderOptions({ useNoCache: true }),
        );
        assertEquals(result.cacheStrategy, "no-cache");
      });

      it("handles file-not-found error as not-found result", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw new VeryfrontError("Not found", {
              slug: "file-not-found",
              category: "not-found",
              status: 404,
              title: "File not found",
            });
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 404);
        assertEquals(result.errorType, "not-found");
        assertEquals(result.isStreaming, false);
        assertEquals(result.cacheStrategy, "no-cache");
      });

      it("handles api-client-error 404 for undeployed project", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw new VeryfrontError("API error", {
              slug: "api-client-error",
              category: "client",
              status: 404,
              title: "API Client Error",
              context: {
                details: { url: "/api/projects/123/environments/prod/files" },
              },
            });
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 404);
        assertEquals(result.errorType, "undeployed");
      });

      it("returns server-error for generic errors in production", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw new Error("Something broke");
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 500);
        assertEquals(result.errorType, "server-error");
        assertEquals(result.showDevOverlay, undefined);
        assertEquals(typeof result.html, "string");
      });

      it("returns runtime error overlay in dev mode", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw new Error("Dev error");
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const ctx = makeCtx({ isLocalProject: true });
        const result = await service.renderPage(ctx, makeRenderOptions());
        assertEquals(result.status, 500);
        assertEquals(result.errorType, "runtime");
        assertEquals(result.showDevOverlay, true);
      });
    });
  });
});
