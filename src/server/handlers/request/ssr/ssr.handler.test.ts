import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProductionMode, SSRHandler } from "./ssr.handler.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { SSRRenderOptions, SSRServiceLike } from "../../../services/rendering/ssr.service.ts";

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

  describe("handle - multi-project context", () => {
    function createExtendedFSAdapter(overrides: Record<string, unknown> = {}) {
      const calls: Record<string, unknown[]> = {};
      return {
        fs: {
          exists: () => Promise.resolve(false),
          readFile: () => Promise.resolve(""),
          writeFile: () => Promise.resolve(),
          readDir: () => Promise.resolve([]),
          mkdir: () => Promise.resolve(),
          remove: () => Promise.resolve(),
          stat: () => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null }),
          // Required for isExtendedFSAdapter type guard
          isVeryfrontAdapter: () => true,
          getUnderlyingAdapter: () => ({}),
          isMultiProjectMode: () => overrides.multiProject ?? true,
          isContextualMode: () => overrides.contextualMode ?? false,
          runWithContext: (
            slug: string,
            token: string,
            fn: () => Promise<unknown>,
            projectId?: string,
            opts?: unknown,
          ) => {
            calls.runWithContext = [slug, token, projectId, opts];
            return fn();
          },
          setRequestToken: (t: string) => {
            calls.setRequestToken = [t];
          },
          setRequestBranch: (b: string | null) => {
            calls.setRequestBranch = [b];
          },
          setProductionMode: (p: boolean, r?: string) => {
            calls.setProductionMode = [p, r];
          },
        },
        calls,
      };
    }

    function makeExtendedCtx(
      fsOverrides: Record<string, unknown> = {},
      ctxOverrides: Partial<HandlerContext> = {},
    ): { ctx: HandlerContext; calls: Record<string, unknown[]> } {
      const { fs, calls } = createExtendedFSAdapter(fsOverrides);
      const adapter = {
        ...createMockAdapter(),
        fs,
      } as unknown as RuntimeAdapter;
      return {
        ctx: makeCtx({ adapter, ...ctxOverrides }),
        calls,
      };
    }

    it("calls runWithContext with correct args in multi-project mode", async () => {
      const mockService = createMockSSRService();
      const handler = new SSRHandler(mockService);
      const { ctx, calls } = makeExtendedCtx({}, {
        projectSlug: "my-slug",
        projectId: "proj-42",
        proxyToken: "tok-abc",
        releaseId: "rel-1",
        environmentName: "staging",
        parsedDomain: {
          slug: null,
          branch: "feature-x",
          environment: null,
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        } as any,
      });

      const req = new Request("http://localhost/page");
      await handler.handle(req, ctx);

      assertEquals(calls.runWithContext![0], "my-slug");
      assertEquals(calls.runWithContext![1], "tok-abc");
      assertEquals(calls.runWithContext![2], "proj-42");
      const opts = calls.runWithContext![3] as Record<string, unknown>;
      assertEquals(opts.releaseId, "rel-1");
      assertEquals(opts.branch, "feature-x");
      assertEquals(opts.environmentName, "staging");
    });

    it("skips runWithContext when projectSlug is missing", async () => {
      const mockService = createMockSSRService();
      const handler = new SSRHandler(mockService);
      const { ctx, calls } = makeExtendedCtx({}, {
        projectSlug: undefined,
      });

      const req = new Request("http://localhost/page");
      const result = await handler.handle(req, ctx);

      assertEquals(calls.runWithContext, undefined);
      assertEquals(result.response instanceof Response, true);
    });

    it("skips runWithContext when not multi-project mode", async () => {
      const mockService = createMockSSRService();
      const handler = new SSRHandler(mockService);
      const { ctx, calls } = makeExtendedCtx({ multiProject: false }, {
        projectSlug: "my-slug",
      });

      const req = new Request("http://localhost/page");
      await handler.handle(req, ctx);

      assertEquals(calls.runWithContext, undefined);
    });
  });

  describe("handle - contextual mode setup", () => {
    function createContextualAdapter(shouldThrow = false) {
      const calls: Record<string, unknown[]> = {};
      const fs = {
        exists: () => Promise.resolve(false),
        readFile: () => Promise.resolve(""),
        writeFile: () => Promise.resolve(),
        readDir: () => Promise.resolve([]),
        mkdir: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        stat: () => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null }),
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => false,
        isContextualMode: () => true,
        setRequestToken: (t: string) => {
          if (shouldThrow) throw new Error("not supported");
          calls.setRequestToken = [t];
        },
        setRequestBranch: (b: string | null) => {
          calls.setRequestBranch = [b];
        },
        setProductionMode: (p: boolean, r?: string) => {
          calls.setProductionMode = [p, r];
        },
      };
      return { fs, calls };
    }

    it("sets token, branch, and production mode in contextual mode", async () => {
      const { fs, calls } = createContextualAdapter();
      const adapter = { ...createMockAdapter(), fs } as unknown as RuntimeAdapter;
      const mockService = createMockSSRService();
      const handler = new SSRHandler(mockService);
      const ctx = makeCtx({
        adapter,
        proxyToken: "ctx-token",
        parsedDomain: {
          slug: null,
          branch: "dev",
          environment: null,
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        } as any,
        resolvedEnvironment: "production",
        releaseId: "rel-5",
      });

      await handler.handle(new Request("http://localhost/test"), ctx);

      assertEquals(calls.setRequestToken![0], "ctx-token");
      assertEquals(calls.setRequestBranch![0], "dev");
      assertEquals(calls.setProductionMode![0], true);
      assertEquals(calls.setProductionMode![1], "rel-5");
    });

    it("silently catches errors from contextual setup", async () => {
      const { fs } = createContextualAdapter(true);
      const adapter = { ...createMockAdapter(), fs } as unknown as RuntimeAdapter;
      const mockService = createMockSSRService();
      const handler = new SSRHandler(mockService);
      const ctx = makeCtx({ adapter, proxyToken: "tok" });

      const result = await handler.handle(new Request("http://localhost/test"), ctx);
      // Should not throw — continues to render
      assertEquals(result.response instanceof Response, true);
    });
  });

  describe("handle - server error with dev overlay", () => {
    it("skips custom error fallback when showDevOverlay is true", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 500,
            html: "<html>dev overlay</html>",
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            errorType: "server-error" as const,
            showDevOverlay: true,
            error: new Error("Oops"),
            slug: "page",
          }),
      });
      const handler = new SSRHandler(mockService);
      const result = await handler.handle(new Request("http://localhost/page"), makeCtx());

      assertEquals(result.continue, false);
      assertEquals(result.response!.status, 500);
    });

    it("returns runtime error type with dev overlay content", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 500,
            html: "<html>runtime error overlay</html>",
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            errorType: "runtime" as const,
            showDevOverlay: true,
            slug: "broken",
          }),
      });
      const handler = new SSRHandler(mockService);
      const result = await handler.handle(new Request("http://localhost/broken"), makeCtx());

      assertEquals(result.continue, false);
      assertEquals(result.response!.status, 500);
    });
  });

  describe("handle - HEAD requests", () => {
    it("routes HEAD requests through SSR", async () => {
      const mockService = createMockSSRService();
      const handler = new SSRHandler(mockService);
      const req = new Request("http://localhost/about", { method: "HEAD" });
      const result = await handler.handle(req, makeCtx());

      assertEquals(result.continue, false);
      assertEquals(result.response instanceof Response, true);
    });

    it("continues for HEAD requests with file extension", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/style.css", { method: "HEAD" });
      const result = await handler.handle(req, makeCtx());
      assertEquals(result.continue, true);
    });
  });

  describe("handle - context setup error", () => {
    it("falls through to 404 when context setup throws", async () => {
      const throwingFs = {
        exists: () => Promise.resolve(false),
        readFile: () => Promise.resolve(""),
        writeFile: () => Promise.resolve(),
        readDir: () => Promise.resolve([]),
        mkdir: () => Promise.resolve(),
        remove: () => Promise.resolve(),
        stat: () => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null }),
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => true,
        runWithContext: () => {
          throw new Error("context setup failed");
        },
      };
      const adapter = { ...createMockAdapter(), fs: throwingFs } as unknown as RuntimeAdapter;
      const mockService = createMockSSRService();
      const handler = new SSRHandler(mockService);
      const ctx = makeCtx({ adapter, projectSlug: "test" });

      const result = await handler.handle(new Request("http://localhost/page"), ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("handle - query parameters", () => {
    it("passes studioEmbed when studio_embed=true", async () => {
      let capturedOptions: SSRRenderOptions | null = null;
      const mockService = createMockSSRService({
        renderPage: (_ctx: HandlerContext, options: SSRRenderOptions) => {
          capturedOptions = options;
          return Promise.resolve({
            status: 200,
            html: "<html>ok</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "page",
          });
        },
      });
      const handler = new SSRHandler(mockService);
      await handler.handle(new Request("http://localhost/page?studio_embed=true"), makeCtx());

      assertEquals(capturedOptions!.studioEmbed, true);
    });

    it("passes noHmr when noHmr=1", async () => {
      let capturedOptions: SSRRenderOptions | null = null;
      const mockService = createMockSSRService({
        renderPage: (_ctx: HandlerContext, options: SSRRenderOptions) => {
          capturedOptions = options;
          return Promise.resolve({
            status: 200,
            html: "<html>ok</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "page",
          });
        },
      });
      const handler = new SSRHandler(mockService);
      await handler.handle(new Request("http://localhost/page?noHmr=1"), makeCtx());

      assertEquals(capturedOptions!.noHmr, true);
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
