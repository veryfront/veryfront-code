import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProductionMode, SSRHandler } from "./ssr.handler.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type {
  MemoryStatus,
  SSRRenderOptions,
  SSRRenderResult,
  SSRServiceLike,
} from "../../../services/rendering/ssr.service.ts";

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

/**
 * Create a mock SSRService for handler tests.
 * Allows controlling renderPage results without real rendering.
 */
function createMockSSRService(
  overrides: Partial<SSRServiceLike> = {},
): SSRServiceLike {
  return {
    checkMemoryPressure: () => ({
      shouldReject: false,
      heapUsedMB: 50,
      heapLimitMB: 500,
      heapUsedPercent: 10,
    }),
    renderPage: () =>
      Promise.resolve({
        status: 200,
        html: "<html>mock render</html>",
        isStreaming: false,
        cacheStrategy: "short" as const,
        slug: "test",
      }),
    createMemoryPressureResult: (slug: string) => ({
      status: 503,
      html: "<html>memory pressure</html>",
      isStreaming: false,
      cacheStrategy: "no-cache" as const,
      slug,
    }),
    ...overrides,
  };
}

describe("server/handlers/request/ssr/ssr.handler", () => {
  describe("SSRHandler metadata", () => {
    it("has correct name", () => {
      const handler = new SSRHandler();
      assertEquals(handler.metadata.name, "SSRHandler");
    });

    it("has pattern for GET and HEAD methods", () => {
      const handler = new SSRHandler();
      const methods = handler.metadata.patterns?.[0]?.method;
      assertEquals(Array.isArray(methods), true);
      assertEquals((methods as string[]).includes("GET"), true);
      assertEquals((methods as string[]).includes("HEAD"), true);
    });
  });

  describe("constructor (dependency injection)", () => {
    it("accepts custom SSRService", () => {
      const mockService = createMockSSRService();
      const handler = new SSRHandler(mockService);
      assertEquals(handler.metadata.name, "SSRHandler");
    });

    it("defaults to real SSRService when none provided", () => {
      const handler = new SSRHandler();
      assertEquals(handler.metadata.name, "SSRHandler");
    });
  });

  describe("handle - path filtering", () => {
    it("continues for /_veryfront/ paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/_veryfront/rsc/probe");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for file extension paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/styles.css");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for .js file paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/app.js");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for .json file paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/data.json");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for .ico file paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/favicon.ico");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for dot-segment paths in production", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/.env");
      const ctx = makeCtx({ resolvedEnvironment: "production" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("continues for /_veryfront/ deeply nested paths", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/_veryfront/modules/test");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("handle - with mock SSRService", () => {
    it("returns response from renderPage result", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 200,
            html: "<html>rendered page</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "about",
          }),
      });
      const handler = new SSRHandler(mockService);
      const req = new Request("http://localhost/about");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, false);
      assertEquals(result.response instanceof Response, true);
      assertEquals(result.response!.status, 200);
    });

    it("returns 503 when memory pressure rejects", async () => {
      const mockService = createMockSSRService({
        checkMemoryPressure: () => ({
          shouldReject: true,
          heapUsedMB: 450,
          heapLimitMB: 500,
          heapUsedPercent: 90,
        }),
      });
      const handler = new SSRHandler(mockService);
      const req = new Request("http://localhost/page");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, false);
      assertEquals(result.response!.status, 503);
    });

    it("returns 404 for not-found error type", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 404,
            html: "<html>not found</html>",
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            errorType: "not-found" as const,
            slug: "missing-page",
          }),
      });
      const handler = new SSRHandler(mockService);
      const req = new Request("http://localhost/missing-page");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, false);
      // The handler's handleNotFound tries fallback pages, but they won't exist in mock;
      // it eventually builds a 404 response.
      assertEquals(result.response!.status, 404);
    });

    it("returns 500 for server-error type", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 500,
            html: "<html>server error</html>",
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            errorType: "server-error" as const,
            error: new Error("Render failed"),
            slug: "broken",
          }),
      });
      const handler = new SSRHandler(mockService);
      const req = new Request("http://localhost/broken");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, false);
      assertEquals(result.response!.status, 500);
    });

    it("passes slug correctly from URL to service", async () => {
      let capturedOptions: SSRRenderOptions | null = null;
      const mockService = createMockSSRService({
        renderPage: (_ctx: HandlerContext, options: SSRRenderOptions) => {
          capturedOptions = options;
          return Promise.resolve({
            status: 200,
            html: "<html>ok</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "my/nested/page",
          });
        },
      });
      const handler = new SSRHandler(mockService);
      const req = new Request("http://localhost/my/nested/page");
      const ctx = makeCtx();
      await handler.handle(req, ctx);

      assertEquals(capturedOptions!.slug, "my/nested/page");
    });

    it("passes root slug as empty string", async () => {
      let capturedOptions: SSRRenderOptions | null = null;
      const mockService = createMockSSRService({
        renderPage: (_ctx: HandlerContext, options: SSRRenderOptions) => {
          capturedOptions = options;
          return Promise.resolve({
            status: 200,
            html: "<html>ok</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "",
          });
        },
      });
      const handler = new SSRHandler(mockService);
      const req = new Request("http://localhost/");
      const ctx = makeCtx();
      await handler.handle(req, ctx);

      assertEquals(capturedOptions!.slug, "");
    });
  });

  describe("isProductionMode", () => {
    it("returns true when config has productionMode = true", () => {
      const ctx = makeCtx({
        config: { fs: { veryfront: { productionMode: true } } } as any,
      });
      assertEquals(isProductionMode(ctx), true);
    });

    it("returns true when resolvedEnvironment is production", () => {
      const ctx = makeCtx({ resolvedEnvironment: "production" });
      assertEquals(isProductionMode(ctx), true);
    });

    it("returns false when resolvedEnvironment is preview", () => {
      const ctx = makeCtx({ resolvedEnvironment: "preview" });
      assertEquals(isProductionMode(ctx), false);
    });

    it("falls back to requestContext.mode when resolvedEnvironment is not set", () => {
      const ctx = makeCtx({
        requestContext: { mode: "production" } as any,
      });
      assertEquals(isProductionMode(ctx), true);
    });

    it("returns false when neither resolvedEnvironment nor mode is set", () => {
      const ctx = makeCtx();
      assertEquals(isProductionMode(ctx), false);
    });

    it("config productionMode overrides resolvedEnvironment", () => {
      const ctx = makeCtx({
        config: { fs: { veryfront: { productionMode: true } } } as any,
        resolvedEnvironment: "preview",
      });
      assertEquals(isProductionMode(ctx), true);
    });
  });
});
