import "#veryfront/schemas/_test-setup.ts";
import "../../../transforms/mdx/compiler/__tests__/content-processor-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SSRService } from "./ssr.service.ts";
import type { RendererProvider, SSRRenderOptions, SSRRenderResult } from "./ssr.service.ts";
import type { HandlerContext } from "../../handlers/types.ts";
import type { RendererAdapter } from "../../shared/renderer-factory.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { SERVICE_OVERLOADED, VeryfrontError } from "#veryfront/errors/index.ts";
import { notFound, redirect } from "#veryfront/data/helpers.ts";
import {
  attachDataResponseMetadata,
  wrapDataResponseMetadataError,
} from "#veryfront/data/response-metadata.ts";
import {
  type ApplicationErrorContext,
  setApplicationErrorReporter,
} from "#veryfront/observability/application-errors.ts";

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
    isLocalProject: true,
    ...overrides,
  };
}

function makeSharedCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return makeCtx({
    isLocalProject: false,
    prepareHostedConfigContext: () =>
      Promise.reject(new Error("Shared context preparation is not used by this unit test")),
    ...overrides,
  });
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

function createReactReadyStream(rejection: unknown): ReadableStream<Uint8Array> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<main>shell</main>"));
    },
  });

  return Object.assign(stream, {
    allReady: Promise.reject(rejection),
  });
}

function redirectLocationOf(result: SSRRenderResult): string {
  const failure = result.failure;
  if (failure?.kind !== "redirect") {
    throw new Error(`expected a redirect outcome, got ${failure?.kind ?? "none"}`);
  }
  return failure.location;
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
        let receivedProjectSlug = "";
        const provider: RendererProvider = {
          getRenderer: (ctx) => {
            receivedProjectSlug = ctx.projectSlug ?? "";
            return Promise.resolve(createMockRendererAdapter());
          },
        };
        const service = new SSRService({ rendererProvider: provider });
        const ctx = makeCtx({ projectSlug: "my-project" });
        await service.getRenderer(ctx);
        assertEquals(receivedProjectSlug, "my-project");
      });

      it("rejects direct shared renderer access before invoking the provider", async () => {
        let called = false;
        const service = new SSRService({
          rendererProvider: {
            getRenderer: () => {
              called = true;
              return Promise.resolve(createMockRendererAdapter());
            },
          },
        });

        await assertRejects(
          () => service.getRenderer(makeSharedCtx()),
          Error,
          "generation-owned isolated renderer admission",
        );
        assertEquals(called, false);
      });

      it("allows a dedicated non-local runtime to use its renderer", async () => {
        let called = false;
        const service = new SSRService({
          rendererProvider: {
            getRenderer: () => {
              called = true;
              return Promise.resolve(createMockRendererAdapter());
            },
          },
        });

        await service.getRenderer(makeCtx({
          isLocalProject: false,
          allowHostProjectCodeExecution: true,
        }));
        assertEquals(called, true);
      });
    });

    describe("renderPage (with mock renderer)", () => {
      it("fails closed before resolving a renderer in a shared runtime", async () => {
        let rendererRequests = 0;
        const service = new SSRService({
          rendererProvider: {
            getRenderer: () => {
              rendererRequests++;
              return Promise.resolve(createMockRendererAdapter());
            },
          },
        });

        const result = await service.renderPage(
          makeSharedCtx(),
          makeRenderOptions(),
        );

        assertEquals(result.status, 503);
        assertEquals(result.cacheStrategy, "no-cache");
        assertEquals(result.htmlProvenance, "framework");
        assertEquals(rendererRequests, 0);
      });

      it("returns 200 with HTML from renderer", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () =>
            Promise.resolve({
              html: "<html>rendered</html>",
              stream: undefined,
              ssrHash: "hash123",
              frontmatter: {},
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
          renderPage: () =>
            Promise.resolve({
              html: "",
              stream,
              ssrHash: undefined,
              frontmatter: {},
            }),
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

      it("forces no-cache and suppresses etags when a render sets cookies", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () =>
            Promise.resolve({
              html: "<html>rendered</html>",
              stream: undefined,
              ssrHash: "hash123",
              frontmatter: {},
              headers: { "x-page-state": "fresh" },
              cookies: [{ name: "session", value: "abc", path: "/" }],
            } as any),
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(
          makeCtx(),
          makeRenderOptions({ useNoCache: false }),
        );

        assertEquals(result.headers, { "x-page-state": "fresh" });
        assertEquals(result.cookies, [{ name: "session", value: "abc", path: "/" }]);
        assertEquals(result.cacheStrategy, "no-cache");
        assertEquals(result.etag, undefined);
      });

      it("requests buffered delivery when the response is cacheable", async () => {
        let delivery: unknown;
        const adapter = createMockRendererAdapter({
          renderPage: (_slug, options) => {
            delivery = options?.delivery;
            return Promise.resolve({
              html: "<html>rendered</html>",
              stream: undefined,
              ssrHash: "hash123",
              frontmatter: {},
            });
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        await service.renderPage(makeCtx(), makeRenderOptions({ useNoCache: false }));

        assertEquals(delivery, "string");
      });

      it("forwards the exact dependency snapshot to the renderer", async () => {
        let observedCacheKey: string | undefined;
        let observedDependencies: Readonly<Record<string, string>> | undefined;
        const adapter = createMockRendererAdapter({
          renderPage: (_slug, options) => {
            observedCacheKey = options?.dependencyPinningCacheKey;
            observedDependencies = options?.dependencyPinningDependencies;
            return Promise.resolve({
              html: "<html>snapshot A</html>",
              stream: undefined,
              ssrHash: "snapshot-a",
              frontmatter: {},
            });
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });
        const dependencies = Object.freeze({ react: "18.3.1" });

        const result = await service.renderPage(
          makeCtx(),
          makeRenderOptions({
            dependencyPinningCacheKey: "on:snapshot-a",
            dependencyPinningDependencies: dependencies,
          }),
        );

        assertEquals(observedCacheKey, "on:snapshot-a");
        assertEquals(observedDependencies, dependencies);
        assertEquals(result.dependencyPinningCacheKey, "on:snapshot-a");
      });

      it("keeps streaming delivery for no-cache responses", async () => {
        let delivery: unknown;
        const adapter = createMockRendererAdapter({
          renderPage: (_slug, options) => {
            delivery = options?.delivery;
            return Promise.resolve({
              html: "",
              stream: new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode("<html>stream</html>"));
                  controller.close();
                },
              }),
              ssrHash: undefined,
              frontmatter: {},
            });
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        await service.renderPage(makeCtx(), makeRenderOptions({ useNoCache: true }));

        assertEquals(delivery, "stream");
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
            throw attachDataResponseMetadata(
              new VeryfrontError("Not found", {
                slug: "file-not-found",
                category: "ROUTE",
                status: 404,
                title: "File not found",
              }),
              {
                headers: { "x-missing-reason": "gone" },
                cookies: [{ name: "visited-missing", value: "1", path: "/" }],
              },
            );
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 404);
        assertEquals(result.failure?.kind, "not-found");
        assertEquals(result.isStreaming, false);
        assertEquals(result.cacheStrategy, "no-cache");
        assertEquals(result.headers, { "x-missing-reason": "gone" });
        assertEquals(result.cookies, [{ name: "visited-missing", value: "1", path: "/" }]);
      });

      it("handles api-client-error 404 for undeployed project", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw new VeryfrontError("API error", {
              slug: "api-client-error",
              category: "SERVER",
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
        assertEquals(result.failure?.kind, "undeployed");
      });

      it("maps render redirects to redirect results", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw wrapDataResponseMetadataError(
              new VeryfrontError("Redirect to /login", {
                slug: "render-error",
                category: "RUNTIME",
                status: 500,
                title: "Component render failed",
                context: {
                  redirect: {
                    destination: "/login",
                    permanent: false,
                  },
                },
              }),
              {
                headers: { "x-auth-result": "required" },
                cookies: [{ name: "return-to", value: "/private", path: "/" }],
              },
            );
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 302);
        assertEquals(result.failure?.kind, "redirect");
        assertEquals(redirectLocationOf(result), "/login");
        assertEquals(result.cacheStrategy, "no-cache");
        assertEquals(result.headers, { "x-auth-result": "required" });
        assertEquals(result.cookies, [{
          name: "return-to",
          value: "/private",
          path: "/",
        }]);
      });

      it("maps a thrown notFound() control result to a 404", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw notFound();
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 404);
        assertEquals(result.failure?.kind, "not-found");
        assertEquals(result.cacheStrategy, "no-cache");
      });

      it("maps a thrown redirect() control result to a redirect", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw redirect("/login");
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 302);
        assertEquals(result.failure?.kind, "redirect");
        assertEquals(redirectLocationOf(result), "/login");
        assertEquals(result.cacheStrategy, "no-cache");
      });

      it("preserves external redirects when redirect validation is not configured", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw redirect("https://accounts.example.com/login");
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());

        assertEquals(result.status, 302);
        assertEquals(redirectLocationOf(result), "https://accounts.example.com/login");
      });

      it("allows relative, same-origin, and allowlisted redirect destinations", async () => {
        for (
          const destination of [
            "/login",
            "http://localhost/account",
            "https://accounts.example.com/login",
          ]
        ) {
          const adapter = createMockRendererAdapter({
            renderPage: () => {
              throw redirect(destination);
            },
          });
          const service = new SSRService({
            rendererProvider: createMockRendererProvider(adapter),
          });

          const result = await service.renderPage(
            makeCtx({
              securityConfig: {
                redirects: { allowedOrigins: ["https://accounts.example.com"] },
              },
            }),
            makeRenderOptions(),
          );

          assertEquals(result.status, 302);
          assertEquals(redirectLocationOf(result), destination);
        }
      });

      it("blocks an off-origin thrown redirect when same-origin validation is configured", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw redirect("https://untrusted.example/login", false, {
              headers: { "x-redirect-state": "blocked" },
              cookies: [{ name: "redirect-state", value: "blocked", path: "/" }],
            });
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(
          makeCtx({ securityConfig: { redirects: { allowedOrigins: [] } } }),
          makeRenderOptions(),
        );

        assertEquals(result.status, 500);
        assertEquals(result.failure?.kind, "runtime");
        if (result.failure?.kind !== "runtime") throw new Error("expected runtime failure");
        assertEquals(
          (result.failure.error as VeryfrontError).slug,
          "redirect-destination-not-allowed",
        );
        assertEquals(result.headers, undefined);
        assertEquals(result.cookies, undefined);
      });

      it("blocks an off-origin returned redirect when validation is configured", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw new VeryfrontError("Redirect", {
              slug: "render-error",
              category: "RUNTIME",
              status: 500,
              title: "Component render failed",
              context: {
                redirect: {
                  destination: "https://untrusted.example/login",
                  permanent: false,
                },
              },
            });
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(
          makeCtx({ securityConfig: { redirects: { allowedOrigins: [] } } }),
          makeRenderOptions(),
        );

        assertEquals(result.status, 500);
        assertEquals(result.failure?.kind, "runtime");
      });

      it("blocks unsafe redirect schemes when validation is configured", async () => {
        for (const destination of ["javascript:alert(1)", "data:text/html,blocked"]) {
          const adapter = createMockRendererAdapter({
            renderPage: () => {
              throw redirect(destination);
            },
          });
          const service = new SSRService({
            rendererProvider: createMockRendererProvider(adapter),
          });

          const result = await service.renderPage(
            makeCtx({ securityConfig: { redirects: { allowedOrigins: [] } } }),
            makeRenderOptions(),
          );

          assertEquals(result.status, 500);
          assertEquals(result.failure?.kind, "runtime");
        }
      });

      it("applies buffered control metadata after loader metadata", async () => {
        for (
          const [control, expectedStatus, expectedKind] of [
            [
              notFound({
                headers: { "x-state": "control" },
                cookies: [{ name: "control-seen", value: "1", path: "/" }],
              }),
              404,
              "not-found",
            ],
            [
              redirect("/login", false, {
                headers: { "x-state": "control" },
                cookies: [{ name: "control-seen", value: "1", path: "/" }],
              }),
              302,
              "redirect",
            ],
          ] as const
        ) {
          const adapter = createMockRendererAdapter({
            renderPage: () => {
              throw wrapDataResponseMetadataError(control, {
                headers: { "x-state": "loader" },
                cookies: [{ name: "loader-seen", value: "1", path: "/" }],
              });
            },
          });
          const service = new SSRService({
            rendererProvider: createMockRendererProvider(adapter),
          });

          const result = await service.renderPage(makeCtx(), makeRenderOptions());

          assertEquals(result.status, expectedStatus);
          assertEquals(result.failure?.kind, expectedKind);
          assertEquals(result.headers, { "x-state": "control" });
          assertEquals(result.cookies, [
            { name: "loader-seen", value: "1", path: "/" },
            { name: "control-seen", value: "1", path: "/" },
          ]);
        }
      });

      it("maps a notFound() reported after the streaming shell to a 404 before responding", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () =>
            Promise.resolve({
              html: "",
              stream: createReactReadyStream(notFound()),
              ssrHash: undefined,
              frontmatter: {},
              headers: { "x-data-state": "missing" },
              cookies: [{ name: "missing-seen", value: "1", path: "/" }],
            }),
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(
          makeCtx(),
          makeRenderOptions({ useNoCache: true }),
        );

        assertEquals(result.status, 404);
        assertEquals(result.failure?.kind, "not-found");
        assertEquals(result.isStreaming, false);
        assertEquals(result.cacheStrategy, "no-cache");
        assertEquals(result.headers, { "x-data-state": "missing" });
        assertEquals(result.cookies, [{ name: "missing-seen", value: "1", path: "/" }]);
      });

      it("maps a redirect() reported after the streaming shell to a redirect before responding", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () =>
            Promise.resolve({
              html: "",
              stream: createReactReadyStream(
                redirect("/login", false, {
                  headers: { "x-data-state": "redirect-control" },
                  cookies: [{ name: "control-seen", value: "1", path: "/" }],
                }),
              ),
              ssrHash: undefined,
              frontmatter: {},
              headers: { "x-data-state": "redirected" },
              cookies: [{ name: "redirect-seen", value: "1", path: "/" }],
            }),
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(
          makeCtx(),
          makeRenderOptions({ useNoCache: true }),
        );

        assertEquals(result.status, 302);
        assertEquals(result.failure?.kind, "redirect");
        assertEquals(redirectLocationOf(result), "/login");
        assertEquals(result.isStreaming, false);
        assertEquals(result.cacheStrategy, "no-cache");
        assertEquals(result.headers, { "x-data-state": "redirect-control" });
        assertEquals(result.cookies, [
          { name: "redirect-seen", value: "1", path: "/" },
          { name: "control-seen", value: "1", path: "/" },
        ]);
      });

      it("maps a permanent thrown redirect() to a 301", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw redirect("/moved", true);
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 301);
        assertEquals(redirectLocationOf(result), "/moved");
      });

      it("finds a control result wrapped in an error's cause chain", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw new Error("render failed", { cause: notFound() });
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 404);
        assertEquals(result.failure?.kind, "not-found");
      });

      it("finds a control result wrapped in an AggregateError", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw new AggregateError([new Error("boom"), redirect("/login")]);
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 302);
        assertEquals(redirectLocationOf(result), "/login");
      });

      it("treats an unbranded notFound-shaped throw as a local runtime error", async () => {
        // A loader doing `throw await response.json()` against an upstream
        // answering `{ notFound: true }` is reporting a failure, not requesting a
        // 404. Only the brand, never the shape, routes to not-found.
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw { notFound: true, message: "record locked" };
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(makeCtx(), makeRenderOptions());
        assertEquals(result.status, 500);
        assertEquals(result.failure?.kind, "runtime");
      });

      it("captures generic local runtime errors", async () => {
        const captured: Array<{ error: unknown; context: ApplicationErrorContext }> = [];
        setApplicationErrorReporter({
          capture(error, context) {
            captured.push({ error, context });
            return "event-id";
          },
          flush: () => Promise.resolve(true),
        });
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw new Error("Something broke");
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        try {
          const result = await service.renderPage(makeCtx(), makeRenderOptions());
          assertEquals(result.status, 500);
          assertEquals(result.failure?.kind, "runtime");
          assertEquals(typeof result.html, "string");
          assertEquals(captured.length, 1);
          assertEquals((captured[0]?.error as Error).message, "Something broke");
          assertEquals(captured[0]?.context, {
            boundary: "ssr.render",
            method: "GET",
          });
        } finally {
          setApplicationErrorReporter(undefined);
        }
      });

      it("preserves attached response metadata on non-control render failures", async () => {
        for (
          const [ctx, expectedKind] of [
            [makeCtx(), "runtime"],
            [
              makeCtx({
                isLocalProject: false,
                allowHostProjectCodeExecution: true,
              }),
              "server-error",
            ],
          ] as const
        ) {
          const adapter = createMockRendererAdapter({
            renderPage: () => {
              throw attachDataResponseMetadata(new Error("Render failed after data"), {
                headers: { "x-error-state": "reported" },
                cookies: [{ name: "error-seen", value: "1", path: "/" }],
              });
            },
          });
          const service = new SSRService({
            rendererProvider: createMockRendererProvider(adapter),
          });

          const result = await service.renderPage(ctx, makeRenderOptions());

          assertEquals(result.failure?.kind, expectedKind);
          assertEquals(result.headers, { "x-error-state": "reported" });
          assertEquals(result.cookies, [{ name: "error-seen", value: "1", path: "/" }]);
        }
      });

      it("captures app-router error-boundary failures before returning boundary HTML", async () => {
        const captured: Array<{ error: unknown; context: ApplicationErrorContext }> = [];
        setApplicationErrorReporter({
          capture(error, context) {
            captured.push({ error, context });
            return "event-id";
          },
          flush: () => Promise.resolve(true),
        });
        const boundaryError = Object.assign(new Error("App router render failed"), {
          errorBoundaryHtml: "<!doctype html><html><body>Error boundary</body></html>",
        });
        const renderError = wrapDataResponseMetadataError(
          boundaryError,
          {
            headers: { "x-error-state": "reported" },
            cookies: [{ name: "error-seen", value: "1", path: "/" }],
          },
        );
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw renderError;
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        try {
          const result = await service.renderPage(makeCtx(), makeRenderOptions());
          assertEquals(result.status, 500);
          assertEquals(result.failure?.kind, "app-router-error-boundary");
          assertEquals(result.html, boundaryError.errorBoundaryHtml);
          assertEquals(result.headers, { "x-error-state": "reported" });
          assertEquals(result.cookies, [{ name: "error-seen", value: "1", path: "/" }]);
          assertEquals(captured.length, 1);
          assertEquals((captured[0]?.error as Error).message, "App router render failed");
          assertEquals(captured[0]?.context, {
            boundary: "ssr.app-router-error-boundary",
            method: "GET",
          });
        } finally {
          setApplicationErrorReporter(undefined);
        }
      });

      it("returns 503 for service-overloaded errors", async () => {
        const adapter = createMockRendererAdapter({
          renderPage: () => {
            throw SERVICE_OVERLOADED.create({
              detail: "Per-project render queue is full",
            });
          },
        });
        const service = new SSRService({
          rendererProvider: createMockRendererProvider(adapter),
        });

        const result = await service.renderPage(
          makeCtx({ isLocalProject: true }),
          makeRenderOptions(),
        );
        assertEquals(result.status, 503);
        // Overload used to reach the handler re-encoded as a generic
        // server-error; the outcome union keeps it distinguishable.
        assertEquals(result.failure?.kind, "overloaded");
        assertEquals(result.cacheStrategy, "no-cache");
        assertEquals(result.isStreaming, false);
        assertEquals(typeof result.html, "string");
        assertEquals(result.html?.includes("503"), true);
        assertEquals(result.html?.includes("Service Temporarily Unavailable"), true);
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
        assertEquals(result.failure?.kind, "runtime");
        assertEquals(result.html?.includes('nonce="test-nonce"'), true);
      });
    });
  });
});
