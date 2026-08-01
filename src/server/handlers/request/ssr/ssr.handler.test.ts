import { RENDER_ERROR } from "#veryfront/errors";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProductionMode, SSRHandler } from "./ssr.handler.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { SSRRenderOptions } from "../../../services/rendering/ssr.service.ts";
import { createMockAdapter, createMockSSRService, makeCtx } from "./ssr.handler.test-helpers.ts";
import {
  type ApplicationErrorContext,
  setApplicationErrorReporter,
} from "#veryfront/observability/application-errors.ts";
import { FSAdapterWrapper, NotSupportedError } from "#veryfront/platform/adapters/fs/wrapper.ts";
import type { FSAdapter } from "#veryfront/platform/adapters/fs/veryfront/types.ts";

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
            failure: { kind: "not-found" } as const,
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

    it("returns redirect responses for redirect error type", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 302,
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            failure: { kind: "redirect", location: "/login", permanent: false } as const,
            slug: "redirect-source",
          }),
      });
      const handler = new SSRHandler(mockService);
      const req = new Request("http://localhost/redirect-source");
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);

      assertEquals(result.continue, false);
      assertEquals(result.response!.status, 302);
      assertEquals(result.response!.headers.get("location"), "/login");
      assertEquals(result.response!.body, null);
    });

    it("returns 500 for server-error type", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 500,
            html: "<html>server error</html>",
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            failure: {
              kind: "server-error",
              exposure: "generic",
              error: new Error("Render failed"),
            } as const,
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

    it("returns app-router error boundary HTML without probing legacy error pages", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 500,
            html: "<html><body>segment boundary</body></html>",
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            failure: {
              kind: "app-router-error-boundary",
              html: "<html><body>segment boundary</body></html>",
              error: new Error("Render failed"),
            } as const,
            slug: "broken",
          }),
      });
      const adapter = createMockAdapter();
      const statted: string[] = [];
      const inner = adapter.fs.stat;
      adapter.fs.stat = (path: string) => {
        statted.push(path);
        return inner(path);
      };
      const handler = new SSRHandler(mockService);

      const result = await handler.handle(
        new Request("http://localhost/broken"),
        makeCtx({ adapter }),
      );

      assertEquals(result.continue, false);
      assertEquals(result.response!.status, 500);
      assertStringIncludes(await result.response!.text(), "segment boundary");
      assertEquals(statted.some((path) => path.endsWith("/pages")), false);
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
    function createContextualAdapter() {
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

    it("continues with later context hints when request-token setup is unsupported", async () => {
      const { fs, calls } = createContextualAdapter();
      fs.setRequestToken = () => {
        throw new NotSupportedError("setRequestToken", "test adapter");
      };
      const adapter = { ...createMockAdapter(), fs } as unknown as RuntimeAdapter;
      let renderCalls = 0;
      const mockService = createMockSSRService({
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            status: 200,
            html: "<html>rendered</html>",
            isStreaming: false,
            cacheStrategy: "short",
            slug: "test",
          });
        },
      });
      const handler = new SSRHandler(mockService);
      const ctx = makeCtx({ adapter, proxyToken: "tok" });

      const result = await handler.handle(new Request("http://localhost/test"), ctx);

      assertEquals(result.response?.status, 200);
      assertEquals(calls.setRequestBranch, [null]);
      assertEquals(calls.setProductionMode, [false, undefined]);
      assertEquals(renderCalls, 1);
    });

    it("continues with production-mode setup when request-branch setup is unsupported", async () => {
      const { fs, calls } = createContextualAdapter();
      fs.setRequestBranch = () => {
        throw new NotSupportedError("setRequestBranch", "test adapter");
      };
      const adapter = { ...createMockAdapter(), fs } as unknown as RuntimeAdapter;
      let renderCalls = 0;
      const mockService = createMockSSRService({
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            status: 200,
            html: "<html>rendered</html>",
            isStreaming: false,
            cacheStrategy: "short",
            slug: "test",
          });
        },
      });
      const handler = new SSRHandler(mockService);

      const result = await handler.handle(
        new Request("http://localhost/test"),
        makeCtx({ adapter, resolvedEnvironment: "production", releaseId: "rel-7" }),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(calls.setProductionMode, [true, "rel-7"]);
      assertEquals(renderCalls, 1);
    });

    for (const operation of ["request token", "request branch"] as const) {
      it(`fails closed when ${operation} setup fails operationally`, async () => {
        const setupFailure = new Error(`private ${operation} adapter detail`);
        const { fs } = createContextualAdapter();
        if (operation === "request token") {
          fs.setRequestToken = () => {
            throw setupFailure;
          };
        } else {
          fs.setRequestBranch = () => {
            throw setupFailure;
          };
        }
        const adapter = { ...createMockAdapter(), fs } as unknown as RuntimeAdapter;
        let renderCalls = 0;
        const mockService = createMockSSRService({
          renderPage: () => {
            renderCalls++;
            throw new Error("render must not run");
          },
        });
        const handler = new SSRHandler(mockService);

        const result = await handler.handle(
          new Request("http://localhost/test"),
          makeCtx({ adapter, proxyToken: "tok" }),
        );

        assertEquals(result.continue, false);
        assertEquals(result.response?.status, 500);
        assertEquals(
          result.response?.headers.get("cache-control"),
          "no-cache, no-store, must-revalidate",
        );
        assertEquals(renderCalls, 0);
        const body = await result.response!.text();
        assertStringIncludes(body, "Internal Server Error");
        assertEquals(body.includes(setupFailure.message), false);
      });
    }

    it("fails closed for NotSupportedError lookalikes without leaking diagnostics", async () => {
      const causeMarker = "private nested adapter cause";
      const pathMarker = "/private/project/path";
      const tokenMarker = "vf_private_token";
      const canonicalMessage = "Operation 'setRequestToken' is not supported by test adapter";
      const namedError = Object.assign(
        new Error(canonicalMessage, { cause: new Error(causeMarker) }),
        {
          name: "NotSupportedError",
          path: pathMarker,
          token: tokenMarker,
        },
      );
      const cases: ReadonlyArray<{
        label: string;
        error: unknown;
        method: "GET" | "HEAD";
      }> = [
        { label: "overwritten Error name", error: namedError, method: "GET" },
        {
          label: "canonical message",
          error: new Error(canonicalMessage),
          method: "GET",
        },
        {
          label: "named DOMException",
          error: new DOMException(canonicalMessage, "NotSupportedError"),
          method: "HEAD",
        },
      ];

      for (const testCase of cases) {
        const { fs } = createContextualAdapter();
        fs.setRequestToken = () => {
          throw testCase.error;
        };
        const adapter = { ...createMockAdapter(), fs } as unknown as RuntimeAdapter;
        let renderCalls = 0;
        const handler = new SSRHandler(createMockSSRService({
          renderPage: () => {
            renderCalls++;
            throw new Error("render must not run");
          },
        }));

        const result = await handler.handle(
          new Request("http://localhost/test", { method: testCase.method }),
          makeCtx({ adapter, proxyToken: "tok" }),
        );

        assertEquals(result.continue, false, testCase.label);
        assertEquals(result.response?.status, 500, testCase.label);
        assertEquals(
          result.response?.headers.get("cache-control"),
          "no-cache, no-store, must-revalidate",
          testCase.label,
        );
        assertEquals(renderCalls, 0, testCase.label);
        if (testCase.method === "HEAD") {
          assertEquals(result.response?.body, null, testCase.label);
          assertEquals(await result.response!.text(), "", testCase.label);
        } else {
          const body = await result.response!.text();
          assertStringIncludes(body, "Internal Server Error", testCase.label);
          for (
            const marker of [
              canonicalMessage,
              causeMarker,
              pathMarker,
              tokenMarker,
            ]
          ) {
            assertEquals(body.includes(marker), false, `${testCase.label}: ${marker}`);
          }
        }
      }
    });

    it("renders when a contextual adapter does not implement production-mode selection", async () => {
      const baseFs = createMockAdapter().fs;
      const underlying = {
        exists: baseFs.exists.bind(baseFs),
        readFile: baseFs.readFile.bind(baseFs),
        readDir: baseFs.readDir.bind(baseFs),
        mkdir: baseFs.mkdir.bind(baseFs),
        remove: baseFs.remove.bind(baseFs),
        stat: baseFs.stat.bind(baseFs),
        writeFile: baseFs.writeFile.bind(baseFs),
        setRequestToken: () => {},
      } as unknown as FSAdapter;
      const adapter = {
        ...createMockAdapter(),
        fs: new FSAdapterWrapper(underlying),
      } as unknown as RuntimeAdapter;
      let renderCalls = 0;
      const mockService = createMockSSRService({
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            status: 200,
            html: "<html>rendered</html>",
            isStreaming: false,
            cacheStrategy: "short",
            slug: "test",
          });
        },
      });
      const handler = new SSRHandler(mockService);

      const result = await handler.handle(
        new Request("http://localhost/test"),
        makeCtx({ adapter, resolvedEnvironment: "production" }),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(renderCalls, 1);
    });

    it("fails closed without rendering when production mode setup fails", async () => {
      const setupFailure = new Error("private production-mode adapter detail");
      const { fs } = createContextualAdapter();
      fs.setProductionMode = () => {
        throw setupFailure;
      };
      const adapter = { ...createMockAdapter(), fs } as unknown as RuntimeAdapter;
      let renderCalls = 0;
      const mockService = createMockSSRService({
        renderPage: () => {
          renderCalls++;
          throw new Error("render must not run");
        },
      });
      const captured: Array<{ error: unknown; context: ApplicationErrorContext }> = [];
      setApplicationErrorReporter({
        capture(error, context) {
          captured.push({ error, context });
          return "event-id";
        },
        flush: () => Promise.resolve(true),
      });
      const handler = new SSRHandler(mockService);
      const ctx = makeCtx({ adapter, resolvedEnvironment: "production" });

      try {
        const result = await handler.handle(new Request("http://localhost/test"), ctx);

        assertEquals(result.continue, false);
        assertEquals(result.response?.status, 500);
        assertEquals(
          result.response?.headers.get("cache-control"),
          "no-cache, no-store, must-revalidate",
        );
        assertEquals(renderCalls, 0);
        const body = await result.response!.text();
        assertStringIncludes(body, "Internal Server Error");
        assertEquals(body.includes(setupFailure.message), false);
        assertEquals(captured, [{
          error: setupFailure,
          context: { boundary: "ssr.context-setup", method: "GET" },
        }]);
      } finally {
        setApplicationErrorReporter(undefined);
      }
    });
  });

  describe("handle - server error with dev overlay", () => {
    function ctxWithRecordedStats(): { ctx: ReturnType<typeof makeCtx>; statted: string[] } {
      const statted: string[] = [];
      const adapter = createMockAdapter();
      const inner = adapter.fs.stat;
      adapter.fs.stat = (path: string) => {
        statted.push(path);
        return inner(path);
      };
      return { ctx: makeCtx({ adapter }), statted };
    }

    const applicationFailures = [
      { kind: "server-error", exposure: "generic", error: new Error("Oops") },
      { kind: "runtime", exposure: "development-overlay", error: new Error("Oops") },
    ] as const;

    for (const failure of applicationFailures) {
      const title = failure.exposure === "development-overlay"
        ? `looks for a custom error page for ${failure.kind} even with the dev overlay`
        : `looks for a custom error page for ${failure.kind}`;
      it(title, async () => {
        const mockService = createMockSSRService({
          renderPage: () =>
            Promise.resolve({
              status: 500,
              html: "<html>dev overlay</html>",
              isStreaming: false,
              cacheStrategy: "no-cache" as const,
              failure,
              slug: "page",
            }),
        });
        const { ctx, statted } = ctxWithRecordedStats();
        const handler = new SSRHandler(mockService);

        const result = await handler.handle(new Request("http://localhost/page"), ctx);

        assertEquals(statted.some((path) => path.endsWith("/pages")), true);
        assertEquals(result.response!.status, 500);
      });
    }

    it("falls back to the dev overlay when no custom error page exists", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 500,
            html: "<html>dev overlay</html>",
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            failure: {
              kind: "server-error",
              exposure: "generic",
              error: new Error("Oops"),
            } as const,
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
            failure: {
              kind: "runtime",
              exposure: "development-overlay" as const,
              error: new Error("Dev error"),
            },
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

    it("keeps HEAD redirect responses bodyless", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 301,
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            failure: { kind: "redirect", location: "/moved", permanent: false } as const,
            slug: "redirect-source",
          }),
      });
      const handler = new SSRHandler(mockService);
      const req = new Request("http://localhost/redirect-source", { method: "HEAD" });
      const result = await handler.handle(req, makeCtx());

      assertEquals(result.continue, false);
      assertEquals(result.response!.status, 301);
      assertEquals(result.response!.headers.get("location"), "/moved");
      assertEquals(result.response!.body, null);
    });

    it("continues for HEAD requests with file extension", async () => {
      const handler = new SSRHandler();
      const req = new Request("http://localhost/style.css", { method: "HEAD" });
      const result = await handler.handle(req, makeCtx());
      assertEquals(result.continue, true);
    });
  });

  describe("handle - context setup error", () => {
    it("fails closed when multi-project context setup throws synchronously", async () => {
      const setupFailure = new Error("private synchronous context setup detail");
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
          throw setupFailure;
        },
      };
      const adapter = { ...createMockAdapter(), fs: throwingFs } as unknown as RuntimeAdapter;
      let renderCalls = 0;
      const mockService = createMockSSRService({
        renderPage: () => {
          renderCalls++;
          throw new Error("render must not run");
        },
      });
      const handler = new SSRHandler(mockService);
      const ctx = makeCtx({ adapter, projectSlug: "test" });

      const result = await handler.handle(new Request("http://localhost/page"), ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 500);
      assertEquals(
        result.response?.headers.get("cache-control"),
        "no-cache, no-store, must-revalidate",
      );
      assertEquals(renderCalls, 0);
      assertEquals((await result.response!.text()).includes(setupFailure.message), false);
    });

    it("fails closed when multi-project context setup rejects asynchronously", async () => {
      const setupFailure = new Error("private asynchronous context setup detail");
      const rejectingFs = {
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
        runWithContext: () => Promise.reject(setupFailure),
      };
      const adapter = { ...createMockAdapter(), fs: rejectingFs } as unknown as RuntimeAdapter;
      let renderCalls = 0;
      const mockService = createMockSSRService({
        renderPage: () => {
          renderCalls++;
          throw new Error("render must not run");
        },
      });
      const handler = new SSRHandler(mockService);

      const result = await handler.handle(
        new Request("http://localhost/page"),
        makeCtx({ adapter, projectSlug: "test" }),
      );

      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 500);
      assertEquals(
        result.response?.headers.get("cache-control"),
        "no-cache, no-store, must-revalidate",
      );
      assertEquals(renderCalls, 0);
      assertEquals((await result.response!.text()).includes(setupFailure.message), false);
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

    it("passes forceProductionScripts when forceProductionScripts=1", async () => {
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
      await handler.handle(
        new Request("http://localhost/page?forceProductionScripts=1"),
        makeCtx(),
      );

      assertEquals(capturedOptions!.forceProductionScripts, true);
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

describe("handle - build errors bypass the custom error page", () => {
  // A compile or import failure is a developer-facing bug, never something a
  // project's 500.tsx should present to a visitor. Masking one behind a
  // friendly page in dev hides the message that says how to fix it.
  function moduleLoadFailureService(buildFailure: boolean) {
    return createMockSSRService({
      renderPage: () =>
        Promise.resolve({
          status: 500,
          html: "<html>dev overlay</html>",
          isStreaming: false,
          cacheStrategy: "no-cache" as const,
          failure: {
            kind: "runtime" as const,
            exposure: "development-overlay" as const,
            error: RENDER_ERROR.create({
              detail: "Critical page module(s) failed to load",
              context: {
                criticalFailures: [{ path: "pages/test/y.tsx", error: "bad import", buildFailure }],
                buildFailure,
              },
            }),
          },
          slug: "page",
        }),
    });
  }

  function buildFailureService() {
    return moduleLoadFailureService(true);
  }

  function ctxRecordingStats(): { ctx: ReturnType<typeof makeCtx>; statted: string[] } {
    const statted: string[] = [];
    const adapter = createMockAdapter();
    const inner = adapter.fs.stat;
    adapter.fs.stat = (path: string) => {
      statted.push(path);
      return inner(path);
    };
    return { ctx: makeCtx({ adapter }), statted };
  }

  it("does not look for a custom error page when the module never compiled", async () => {
    const { ctx, statted } = ctxRecordingStats();
    const handler = new SSRHandler(buildFailureService());

    const result = await handler.handle(new Request("http://localhost/page"), ctx);

    assertEquals(statted.some((path) => path.endsWith("/pages")), false);
    assertEquals(result.response!.status, 500);
  });

  it("still uses the custom error page when the module ran and threw", async () => {
    // A page module that compiled and threw at module scope (a missing
    // environment variable, say) also fails to load, but it is an application
    // error, not a build failure, so pages/500.tsx must still present it.
    const { ctx, statted } = ctxRecordingStats();
    const handler = new SSRHandler(moduleLoadFailureService(false));

    await handler.handle(new Request("http://localhost/page"), ctx);

    assertEquals(statted.some((path) => path.endsWith("/pages")), true);
  });

  it("still uses the custom error page for an ordinary thrown Error", async () => {
    const { ctx, statted } = ctxRecordingStats();
    const handler = new SSRHandler(createMockSSRService({
      renderPage: () =>
        Promise.resolve({
          status: 500,
          html: "<html>dev overlay</html>",
          isStreaming: false,
          cacheStrategy: "no-cache" as const,
          failure: {
            kind: "runtime" as const,
            exposure: "development-overlay" as const,
            error: new Error("intentional test error from getServerData"),
          },
          slug: "page",
        }),
    }));

    await handler.handle(new Request("http://localhost/page"), ctx);

    assertEquals(statted.some((path) => path.endsWith("/pages")), true);
  });
});
