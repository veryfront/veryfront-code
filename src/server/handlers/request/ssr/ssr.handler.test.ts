import { RENDER_ERROR } from "#veryfront/errors";
import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SSRHandler } from "./ssr.handler.ts";
import { __setComponentSourceLoaderForTests } from "./error-page-fallback.ts";
import {
  __injectProjectReactForTests,
  __injectReactDOMServerForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { SSRRenderOptions } from "../../../services/rendering/ssr.service.ts";
import { createMockAdapter, createMockSSRService, makeCtx } from "./ssr.handler.test-helpers.ts";

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
    it("passes only application headers into project rendering", async () => {
      let renderedRequest: Request | undefined;
      const mockService = createMockSSRService({
        renderPage: (_ctx, options) => {
          renderedRequest = options.request;
          return Promise.resolve({
            status: 200,
            html: "<html>rendered page</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "headers",
          });
        },
      });
      const handler = new SSRHandler(mockService);
      await handler.handle(
        new Request("http://localhost/headers", {
          headers: {
            authorization: "Bearer application-token",
            cookie: "session=application-cookie",
            "proxy-authorization": "Basic infrastructure-proxy-token",
            "x-forwarded-host": "internal-proxy.example",
            "x-project-id": "infrastructure-project",
            "x-token": "platform-service-token",
            "x-veryfront-control-plane-jws": "signed-control-plane-request",
          },
        }),
        makeCtx({ isLocalProject: true }),
      );

      assertEquals(renderedRequest?.headers.get("authorization"), "Bearer application-token");
      assertEquals(renderedRequest?.headers.get("cookie"), "session=application-cookie");
      assertEquals(renderedRequest?.headers.get("proxy-authorization"), null);
      assertEquals(renderedRequest?.headers.get("x-forwarded-host"), null);
      assertEquals(renderedRequest?.headers.get("x-project-id"), null);
      assertEquals(renderedRequest?.headers.get("x-token"), null);
      assertEquals(renderedRequest?.headers.get("x-veryfront-control-plane-jws"), null);
    });

    it("returns a typed 503 before shared-runtime rendering", async () => {
      let renderCalls = 0;
      const handler = new SSRHandler(createMockSSRService({
        renderPage: () => {
          renderCalls++;
          throw new Error("shared runtime reached the host renderer");
        },
      }));
      const result = await handler.handle(
        new Request("https://tenant.example/private-page"),
        makeCtx({
          isLocalProject: false,
          prepareHostedConfigContext: (() => {
            throw new Error("shared runtime prepared host rendering context");
          }) as HandlerContext["prepareHostedConfigContext"],
        }),
      );

      assertEquals(result.response?.status, 503);
      assertEquals(result.response?.headers.get("cache-control"), "no-store");
      assertEquals(result.response?.headers.get("content-type"), "application/problem+json");
      assertEquals(
        (await result.response?.json() as { type?: string }).type,
        "https://veryfront.com/docs/code/guides/errors#project-execution-unavailable",
      );
      assertEquals(renderCalls, 0);
    });

    it("renders once the host grants execution", async () => {
      // The granted counterpart to the fail-closed test above. veryfront-code
      // #3364 shipped a hardcoded `true` on a sibling surface that survived
      // review because a fail-closed test cannot tell a correct predicate from
      // a literal denial. Only this direction can.
      let renderCalls = 0;
      const handler = new SSRHandler(createMockSSRService({
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            status: 200,
            html: "<html>granted</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "private-page",
          });
        },
      }));
      const result = await handler.handle(
        new Request("https://tenant.example/private-page"),
        makeCtx({
          isLocalProject: false,
          allowHostProjectCodeExecution: true,
          prepareHostedConfigContext: (() => {}) as HandlerContext["prepareHostedConfigContext"],
        } as Partial<HandlerContext>),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(renderCalls, 1);
    });

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
            failure: {
              kind: "not-found",
              headers: { "x-missing-reason": "gone" },
              cookies: [{ name: "visited-missing", value: "1", path: "/" }],
            } as const,
            headers: { "x-missing-reason": "gone" },
            cookies: [{ name: "visited-missing", value: "1", path: "/" }],
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
      assertEquals(result.response!.headers.get("x-missing-reason"), "gone");
      assertEquals(result.response!.headers.getSetCookie(), ["visited-missing=1; Path=/"]);
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

    it("applies response metadata to redirects", async () => {
      const mockService = createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 302,
            isStreaming: false,
            cacheStrategy: "no-cache" as const,
            failure: {
              kind: "redirect",
              location: "/account",
              permanent: false,
            } as const,
            headers: { "x-auth-result": "signed-in" },
            cookies: [{ name: "session", value: "abc", path: "/", httpOnly: true }],
            slug: "sign-in",
          } as any),
      });
      const result = await new SSRHandler(mockService).handle(
        new Request("http://localhost/sign-in"),
        makeCtx(),
      );

      assertEquals(result.response!.status, 302);
      assertEquals(result.response!.headers.get("location"), "/account");
      assertEquals(result.response!.headers.get("x-auth-result"), "signed-in");
      assertEquals(result.response!.headers.getSetCookie(), [
        "session=abc; Path=/; HttpOnly",
      ]);
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

    it("fails closed before entering a multi-project rendering context", async () => {
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
      const result = await handler.handle(req, ctx);

      assertEquals(calls.runWithContext, undefined);
      assertEquals(result.response?.status, 503);
      assertEquals(result.response?.headers.get("content-type"), "application/problem+json");
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

    it("preserves response metadata on a custom server-error page", async () => {
      const adapter = createMockAdapter();
      adapter.fs.stat = (path: string) => {
        if (path.endsWith("/pages")) {
          return Promise.resolve({
            isFile: false,
            isDirectory: true,
            isSymlink: false,
            size: 0,
            mtime: null,
          });
        }
        if (path.endsWith("/pages/500.tsx")) {
          return Promise.resolve({
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            size: 1,
            mtime: null,
          });
        }
        return Promise.reject(new Error("not found"));
      };
      adapter.fs.readFile = () => Promise.resolve("export default function ErrorPage() {}");
      __setComponentSourceLoaderForTests(() => Promise.resolve(() => null));
      __injectProjectReactForTests(React);
      __injectReactDOMServerForTests({
        renderToString: () => "",
        renderToStaticMarkup: () => "",
      });
      try {
        const mockService = createMockSSRService({
          renderPage: () =>
            Promise.resolve({
              status: 500,
              html: "<html>dev overlay</html>",
              isStreaming: false,
              cacheStrategy: "no-cache" as const,
              failure: {
                kind: "server-error" as const,
                exposure: "generic" as const,
                error: new Error("Oops"),
              },
              headers: { "x-error-state": "reported" },
              cookies: [{ name: "error-seen", value: "1", path: "/" }],
              slug: "page",
            }),
        });
        const handler = new SSRHandler(mockService);
        const result = await handler.handle(
          new Request("http://localhost/page"),
          makeCtx({
            adapter,
            isLocalProject: true,
            projectId: "metadata-error-page",
          }),
        );

        assertEquals(result.response!.status, 500);
        assertEquals(result.response!.headers.get("x-error-state"), "reported");
        assertStringIncludes(result.response!.headers.get("set-cookie") ?? "", "error-seen=1");
      } finally {
        __setComponentSourceLoaderForTests(null);
        resetReactCache();
      }
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

  describe("handle - hostile shared context", () => {
    it("returns 503 without invoking a throwing shared context", async () => {
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
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 503);
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
