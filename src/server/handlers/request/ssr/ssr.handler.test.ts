import { RENDER_ERROR, VeryfrontError } from "#veryfront/errors";
import "#veryfront/schemas/_test-setup.ts";
import * as React from "react";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SSRHandler } from "./ssr.handler.ts";
import { __setComponentSourceLoaderForTests } from "./error-page-fallback.ts";
import {
  __injectProjectReactForTests,
  __injectReactDOMServerForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import type { HandlerContext, HandlerResult } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { SSRRenderOptions } from "../../../services/rendering/ssr.service.ts";
import { createMockAdapter, createMockSSRService, makeCtx } from "./ssr.handler.test-helpers.ts";
import { preparePreviewDocumentSourceSnapshot } from "../source-snapshot-freshness.ts";
import { getCurrentRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  __resetPerfTimerForTests,
  __trackedRequestIdsForTests,
} from "#veryfront/utils/perf-timer.ts";
import { __injectDepsForTests as injectMemoryPressureDeps } from "#veryfront/server/shared/renderer/memory/pressure.ts";

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
      // An extensionless dot route: the file-extension guard does not catch it,
      // so only the production route-visibility policy can hide it.
      const handler = new SSRHandler(createMockSSRService());
      const req = new Request("http://localhost/.veryfront/secrets");
      const ctx = makeCtx({ resolvedEnvironment: "production" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true, "extensionless dot routes must be hidden in production");
      assertEquals(result.response, undefined);
    });

    it("still renders dot-segment paths outside production", async () => {
      const handler = new SSRHandler(createMockSSRService());
      const req = new Request("http://localhost/.veryfront/secrets");
      const ctx = makeCtx({
        isLocalProject: true,
        projectSlug: "preview-project",
        resolvedEnvironment: "preview",
        requestContext: {
          token: "",
          slug: "preview-project",
          branch: "main",
          mode: "preview",
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 200, "dot routes must still render outside production");
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
    it("awaits the current preview source snapshot before rendering", async () => {
      const events: string[] = [];
      let releaseRefresh!: () => void;
      const refreshPending = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      const adapter = createMockAdapter();
      adapter.fs = { ...adapter.fs, sourceSnapshotFreshnessOptionsVersion: 1 };
      adapter.fs.ensureSourceSnapshotFresh = async () => {
        events.push("refresh-start");
        await refreshPending;
        events.push("refresh-complete");
      };
      const handler = new SSRHandler(createMockSSRService({
        renderPage: () => {
          events.push("render");
          return Promise.resolve({
            status: 200,
            html: "<html>current draft</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "preview",
          });
        },
      }));
      const handling = handler.handle(
        new Request("http://localhost/preview"),
        makeCtx({
          adapter,
          isLocalProject: true,
          projectSlug: "preview-project",
          requestContext: {
            token: "",
            slug: "preview-project",
            branch: "main",
            mode: "preview",
          },
        }),
      );

      await Promise.resolve();
      await Promise.resolve();
      assertEquals(events, ["refresh-start"]);

      releaseRefresh();
      const result = await handling;

      assertEquals(events, ["refresh-start", "refresh-complete", "render"]);
      assertEquals(result.response?.status, 200);
    });

    it("serves source published between two preview renders", async () => {
      // The adapter only observes a newer draft when freshness is established,
      // so a render that skips the freshness boundary keeps serving the older
      // snapshot however many times you reload.
      let publishedSource = "Ready to Create";
      let observedSource = publishedSource;
      const adapter = createMockAdapter();
      adapter.fs = { ...adapter.fs, sourceSnapshotFreshnessOptionsVersion: 1 };
      adapter.fs.ensureSourceSnapshotFresh = () => {
        observedSource = publishedSource;
        return Promise.resolve();
      };
      const handler = new SSRHandler(createMockSSRService({
        renderPage: () =>
          Promise.resolve({
            status: 200,
            html: `<html><h1>${observedSource}</h1></html>`,
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "preview",
          }),
      }));
      const render = () =>
        handler.handle(
          new Request("http://localhost/preview"),
          makeCtx({
            adapter,
            isLocalProject: true,
            projectSlug: "preview-project",
            requestContext: {
              token: "",
              slug: "preview-project",
              branch: "main",
              mode: "preview",
            },
          }),
        );

      const first = await render();
      assertStringIncludes(await first.response!.text(), "<h1>Ready to Create</h1>");

      publishedSource = "Ready to Create222333444555666777888999";

      const second = await render();
      assertStringIncludes(
        await second.response!.text(),
        "<h1>Ready to Create222333444555666777888999</h1>",
      );
    });

    it("requires a strictly current snapshot before rendering a preview document", async () => {
      // A document render is the one request that cannot tolerate a cached
      // freshness lease: whatever it serves is what hydration compares against.
      const strictness: Array<number | undefined> = [];
      const adapter = createMockAdapter();
      adapter.fs = { ...adapter.fs, sourceSnapshotFreshnessOptionsVersion: 1 };
      adapter.fs.ensureSourceSnapshotFresh = (
        _reason?: string,
        options?: { maxAgeMs?: number },
      ) => {
        strictness.push(options?.maxAgeMs);
        return Promise.resolve();
      };
      const handler = new SSRHandler(createMockSSRService());

      const result = await handler.handle(
        new Request("http://localhost/preview"),
        makeCtx({
          adapter,
          isLocalProject: true,
          projectSlug: "preview-project",
          requestContext: {
            token: "",
            slug: "preview-project",
            branch: "main",
            mode: "preview",
          },
        }),
      );

      assertEquals(result.response?.status, 200, "the preview document must still render");
      assertEquals(
        strictness,
        [0],
        "the SSR document render must demand a zero-age snapshot rather than accept the default lease",
      );
    });

    it("reclassifies route ownership before SSR rendering or memory shedding", async () => {
      let version = 1;
      let renderCalls = 0;
      let reclassificationCalls = 0;
      const adapter = createMockAdapter();
      adapter.fs.refreshSourceSnapshot = () => Promise.resolve();
      adapter.fs.getSourceSnapshotIdentity = () => "branch:preview-project:main";
      adapter.fs.getSourceSnapshotVersion = () => version;
      const ctx = makeCtx({
        adapter,
        projectSlug: "preview-project",
        requestContext: {
          token: "",
          slug: "preview-project",
          branch: "main",
          mode: "preview",
        },
      });

      await preparePreviewDocumentSourceSnapshot(ctx, () => {
        reclassificationCalls++;
        return Promise.resolve({
          response: new Response("current route response", { status: 202 }),
          continue: false,
        });
      });
      version++;

      injectMemoryPressureDeps({ getHeapStats: () => ({ heapUsedPercent: 99 }) });
      try {
        const result = await new SSRHandler(createMockSSRService({
          renderPage: () => {
            renderCalls++;
            return Promise.resolve({
              status: 200,
              html: "<html>obsolete page</html>",
              isStreaming: false,
              cacheStrategy: "short" as const,
              slug: "preview",
            });
          },
        })).handle(new Request("http://localhost/review"), ctx);

        assertEquals(result.response?.status, 202);
        assertEquals(await result.response?.text(), "current route response");
        assertEquals(reclassificationCalls, 1);
        assertEquals(
          renderCalls,
          0,
          "SSR must not render or shed after the current generation becomes API-owned",
        );
      } finally {
        injectMemoryPressureDeps(null);
      }
    });

    it("rejects a preview render when its source generation changes during rendering", async () => {
      __resetPerfTimerForTests(true);
      let version = 1;
      const adapter = createMockAdapter();
      adapter.fs.refreshSourceSnapshot = () => Promise.resolve();
      adapter.fs.getSourceSnapshotIdentity = () => "branch:preview-project:main";
      adapter.fs.getSourceSnapshotVersion = () => version;
      const handler = new SSRHandler(createMockSSRService({
        renderPage: () => {
          version++;
          return Promise.resolve({
            status: 200,
            html: "<html>mixed generation</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "preview",
          });
        },
      }));

      try {
        const rejection = await assertRejects(() =>
          handler.handle(
            new Request("http://localhost/preview"),
            makeCtx({
              adapter,
              projectSlug: "preview-project",
              requestContext: {
                token: "",
                slug: "preview-project",
                branch: "main",
                mode: "preview",
              },
            }),
          )
        );

        assertInstanceOf(rejection, VeryfrontError);
        assertEquals(rejection.slug, "source-snapshot-freshness-unavailable");
        assertEquals(
          __trackedRequestIdsForTests(),
          [],
          "a rejected source-generation check must end its performance timing entry",
        );
      } finally {
        __resetPerfTimerForTests(undefined);
      }
    });

    it("rejects a preview render when its source generation changes during a custom fallback", async () => {
      let version = 1;
      const adapter = createMockAdapter();
      adapter.fs.refreshSourceSnapshot = () => Promise.resolve();
      adapter.fs.getSourceSnapshotIdentity = () => "branch:preview-project:main";
      adapter.fs.getSourceSnapshotVersion = () => version;
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
      adapter.fs.readFile = () => {
        version++;
        return Promise.resolve("export default function ErrorPage() {}");
      };
      __setComponentSourceLoaderForTests(() => Promise.resolve(() => null));
      __injectProjectReactForTests(React);
      __injectReactDOMServerForTests({
        renderToString: () => "",
        renderToStaticMarkup: () => "",
      });

      try {
        const handler = new SSRHandler(createMockSSRService({
          renderPage: () =>
            Promise.resolve({
              status: 500,
              html: "<html>old-generation overlay</html>",
              isStreaming: false,
              cacheStrategy: "no-cache" as const,
              failure: {
                kind: "server-error" as const,
                exposure: "generic" as const,
                error: new Error("Oops"),
              },
              slug: "fallback-generation",
            }),
        }));

        const rejection = await assertRejects(() =>
          handler.handle(
            new Request("http://localhost/fallback-generation"),
            makeCtx({
              adapter,
              isLocalProject: true,
              projectId: "fallback-generation-snapshot",
              projectSlug: "preview-project",
              requestContext: {
                token: "",
                slug: "preview-project",
                branch: "main",
                mode: "preview",
              },
            }),
          )
        );

        assertInstanceOf(rejection, VeryfrontError);
        assertEquals(rejection.slug, "source-snapshot-freshness-unavailable");
      } finally {
        __setComponentSourceLoaderForTests(null);
        resetReactCache();
      }
    });

    it("reclassifies an SSR result when its source generation changes during rendering", async () => {
      let version = 1;
      let renderCalls = 0;
      let reclassificationCalls = 0;
      const adapter = createMockAdapter();
      adapter.fs.refreshSourceSnapshot = () => Promise.resolve();
      adapter.fs.getSourceSnapshotIdentity = () => "branch:preview-project:main";
      adapter.fs.getSourceSnapshotVersion = () => version;
      const ctx = makeCtx({
        adapter,
        projectSlug: "preview-project",
        requestContext: {
          token: "",
          slug: "preview-project",
          branch: "main",
          mode: "preview",
        },
      });

      await preparePreviewDocumentSourceSnapshot(ctx, () => {
        reclassificationCalls++;
        return Promise.resolve({
          response: new Response("current API response", { status: 202 }),
          continue: false,
        });
      });

      const result = await new SSRHandler(createMockSSRService({
        renderPage: () => {
          renderCalls++;
          version++;
          return Promise.resolve({
            status: 200,
            html: "<html>mixed-generation page</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "review",
          });
        },
      })).handle(new Request("http://localhost/review"), ctx);

      assertEquals(result.response?.status, 202);
      assertEquals(await result.response?.text(), "current API response");
      assertEquals(renderCalls, 1);
      assertEquals(reclassificationCalls, 1);
    });

    it("rejects a legacy ensure-only adapter for a preview document", async () => {
      let ensureCalls = 0;
      let renderCalls = 0;
      const adapter = createMockAdapter();
      adapter.fs.ensureSourceSnapshotFresh = () => {
        ensureCalls++;
        return Promise.resolve();
      };
      const handler = new SSRHandler(createMockSSRService({
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            status: 200,
            html: "<html>stale</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "preview",
          });
        },
      }));

      const rejection = await assertRejects(() =>
        handler.handle(
          new Request("http://localhost/preview"),
          makeCtx({
            adapter,
            projectSlug: "preview-project",
            requestContext: {
              token: "",
              slug: "preview-project",
              branch: "main",
              mode: "preview",
            },
          }),
        )
      );

      assertInstanceOf(rejection, VeryfrontError);
      assertEquals(rejection.slug, "source-snapshot-freshness-unavailable");
      assertEquals(ensureCalls, 0, "an unversioned lease cannot prove zero-age freshness");
      assertEquals(renderCalls, 0, "stale HTML must not render after freshness is unproven");
    });

    it("unconditionally refreshes a legacy preview adapter for a document render", async () => {
      let legacyEnsureCalls = 0;
      const refreshReasons: string[] = [];
      const adapter = createMockAdapter();
      adapter.fs.ensureSourceSnapshotFresh = (_reason?: string) => {
        legacyEnsureCalls++;
        return Promise.resolve();
      };
      adapter.fs.refreshSourceSnapshot = (reason?: string) => {
        if (reason) refreshReasons.push(reason);
        return Promise.resolve();
      };
      const handler = new SSRHandler(createMockSSRService());

      const result = await handler.handle(
        new Request("http://localhost/preview"),
        makeCtx({
          adapter,
          isLocalProject: true,
          projectSlug: "preview-project",
          requestContext: {
            token: "",
            slug: "preview-project",
            branch: "main",
            mode: "preview",
          },
        }),
      );

      assertEquals(result.response?.status, 200, "the preview document must still render");
      assertEquals(legacyEnsureCalls, 0, "a legacy freshness lease cannot satisfy maxAgeMs: 0");
      assertEquals(refreshReasons, ["preview-document-routing"]);
    });

    it("surfaces preview source refresh failures without rendering stale HTML", async () => {
      let renderCalls = 0;
      const adapter = createMockAdapter();
      adapter.fs = { ...adapter.fs, sourceSnapshotFreshnessOptionsVersion: 1 };
      adapter.fs.ensureSourceSnapshotFresh = () =>
        Promise.reject(new Error("preview snapshot refresh failed"));
      const handler = new SSRHandler(createMockSSRService({
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            status: 200,
            html: "<html>stale</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "preview",
          });
        },
      }));

      await assertRejects(
        () =>
          handler.handle(
            new Request("http://localhost/preview"),
            makeCtx({
              adapter,
              isLocalProject: true,
              projectSlug: "preview-project",
              requestContext: {
                token: "",
                slug: "preview-project",
                branch: "main",
                mode: "preview",
              },
            }),
          ),
        Error,
        "preview snapshot refresh failed",
      );
      assertEquals(renderCalls, 0);
    });

    it("does not refresh immutable production source before rendering", async () => {
      let refreshCalls = 0;
      const adapter = createMockAdapter();
      adapter.fs.ensureSourceSnapshotFresh = () => {
        refreshCalls++;
        return Promise.resolve();
      };
      const handler = new SSRHandler(createMockSSRService());

      const result = await handler.handle(
        new Request("http://localhost/production"),
        makeCtx({
          adapter,
          isLocalProject: true,
          projectSlug: "production-project",
          releaseId: "release-1",
          resolvedEnvironment: "production",
          requestContext: {
            token: "",
            slug: "production-project",
            branch: null,
            mode: "production",
          },
        }),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(refreshCalls, 0);
    });

    it("fails the request when a snapshot source cannot establish freshness", async () => {
      let renderCalls = 0;
      const adapter = createMockAdapter();
      // Declares a source snapshot, but offers no way to bring it up to date.
      adapter.fs.getSourceSnapshotVersion = () => 1;
      const handler = new SSRHandler(createMockSSRService({
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            status: 200,
            html: "<html>stale</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "preview",
          });
        },
      }));

      const rejection = await assertRejects(
        () =>
          handler.handle(
            new Request("http://localhost/preview"),
            makeCtx({
              adapter,
              projectSlug: "preview-project",
              requestContext: {
                token: "",
                slug: "preview-project",
                branch: "main",
                mode: "preview",
              },
            }),
          ),
      );
      assertInstanceOf(rejection, VeryfrontError);
      assertEquals(rejection.slug, "source-snapshot-freshness-unavailable");
      assertEquals(rejection.status, 503);
      assertEquals(renderCalls, 0);
    });

    it("renders a snapshot source that only implements refreshSourceSnapshot", async () => {
      const reasons: Array<string | undefined> = [];
      const adapter = createMockAdapter();
      adapter.fs.refreshSourceSnapshot = (reason?: string) => {
        reasons.push(reason);
        return Promise.resolve();
      };
      const handler = new SSRHandler(createMockSSRService());

      const result = await handler.handle(
        new Request("http://localhost/preview"),
        makeCtx({
          adapter,
          projectSlug: "preview-project",
          requestContext: {
            token: "",
            slug: "preview-project",
            branch: "main",
            mode: "preview",
          },
        }),
      );

      assertEquals(result.response?.status, 200);
      assertEquals(reasons, ["preview-document-routing"]);
    });

    it("renders a live source that declares no snapshot at all", async () => {
      // Local filesystem adapters (deno, node, bun) implement none of the
      // source snapshot methods. Their reads are already current, so the
      // freshness boundary must let them through rather than fail the request.
      const handler = new SSRHandler(createMockSSRService());

      const result = await handler.handle(
        new Request("http://localhost/preview"),
        makeCtx({
          isLocalProject: true,
          projectSlug: "preview-project",
          requestContext: {
            token: "",
            slug: "preview-project",
            branch: "main",
            mode: "preview",
          },
        }),
      );

      assertEquals(result.response?.status, 200);
    });

    it("renders immutable production source that cannot establish freshness", async () => {
      const adapter = createMockAdapter();
      adapter.fs.getSourceSnapshotVersion = () => 1;
      const handler = new SSRHandler(createMockSSRService());

      const result = await handler.handle(
        new Request("http://localhost/production"),
        makeCtx({
          adapter,
          projectSlug: "production-project",
          releaseId: "release-1",
          resolvedEnvironment: "production",
          requestContext: {
            token: "",
            slug: "production-project",
            branch: null,
            mode: "production",
          },
        }),
      );

      assertEquals(result.response?.status, 200);
    });

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
            "X-Auth-Email": "forged-email@example.test",
            "x-auth-subject": "forged-user",
            "x-project-id": "infrastructure-project",
            "x-token": "platform-service-token",
            "x-veryfront-control-plane-jws": "signed-control-plane-request",
          },
        }),
        makeCtx({
          isLocalProject: true,
          applicationIdentityHeaderNames: ["x-auth-subject", "X-Auth-Email"],
        }),
      );

      assertEquals(renderedRequest?.headers.get("authorization"), "Bearer application-token");
      assertEquals(renderedRequest?.headers.get("cookie"), "session=application-cookie");
      assertEquals(renderedRequest?.headers.get("x-auth-email"), null);
      assertEquals(renderedRequest?.headers.get("x-auth-subject"), null);
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

    it("rechecks memory pressure after preview snapshot freshness", async () => {
      let pressureChecks = 0;
      let renderCalls = 0;
      const mockService = createMockSSRService({
        checkMemoryPressure: () => ({
          shouldReject: ++pressureChecks >= 2,
          heapUsedMB: pressureChecks >= 2 ? 460 : 300,
          heapLimitMB: 500,
          heapUsedPercent: pressureChecks >= 2 ? 92 : 60,
        }),
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            status: 200,
            html: "<html>must not render</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "page",
          });
        },
      });

      const result = await new SSRHandler(mockService).handle(
        new Request("http://localhost/page"),
        makeCtx(),
      );

      assertEquals(result.response?.status, 503);
      assertEquals(pressureChecks, 2);
      assertEquals(renderCalls, 0, "rendering must stop when refresh crosses the pressure limit");
    });

    it("releases performance timing state when shedding before the source refresh", async () => {
      __resetPerfTimerForTests(true);
      try {
        const mockService = createMockSSRService({
          checkMemoryPressure: () => ({
            shouldReject: true,
            heapUsedMB: 460,
            heapLimitMB: 500,
            heapUsedPercent: 92,
          }),
        });

        const result = await new SSRHandler(mockService).handle(
          new Request("http://localhost/page"),
          makeCtx(),
        );

        assertEquals(result.response?.status, 503);
        assertEquals(
          __trackedRequestIdsForTests(),
          [],
          "a shed request must end its timing entry instead of staying current",
        );
      } finally {
        __resetPerfTimerForTests(undefined);
      }
    });

    it("releases performance timing state when context setup falls through", async () => {
      __resetPerfTimerForTests(true);
      try {
        const adapter = createMockAdapter();
        adapter.fs = {
          ...adapter.fs,
          getUnderlyingAdapter: () => adapter.fs,
          isVeryfrontAdapter: () => true,
          isMultiProjectMode: () => true,
          runWithContext: () => {
            throw new Error("context setup failed");
          },
        } as unknown as RuntimeAdapter["fs"];

        const result = await new SSRHandler(createMockSSRService()).handle(
          new Request("http://localhost/page"),
          makeCtx({
            adapter,
            allowHostProjectCodeExecution: true,
            projectSlug: "preview-project",
            proxyToken: "token",
          }),
        );

        assertEquals(result.continue, true);
        assertEquals(
          __trackedRequestIdsForTests(),
          [],
          "a context setup fall-through must release its performance timing entry",
        );
      } finally {
        __resetPerfTimerForTests(undefined);
      }
    });

    it("releases performance timing state when post-refresh pressure sheds the request", async () => {
      __resetPerfTimerForTests(true);
      try {
        let pressureChecks = 0;
        const mockService = createMockSSRService({
          checkMemoryPressure: () => ({
            shouldReject: ++pressureChecks >= 2,
            heapUsedMB: pressureChecks >= 2 ? 460 : 300,
            heapLimitMB: 500,
            heapUsedPercent: pressureChecks >= 2 ? 92 : 60,
          }),
        });

        const result = await new SSRHandler(mockService).handle(
          new Request("http://localhost/page"),
          makeCtx(),
        );

        assertEquals(result.response?.status, 503);
        assertEquals(
          __trackedRequestIdsForTests(),
          [],
          "the post-refresh shed path must clean up the abandoned request's timing state",
        );
      } finally {
        __resetPerfTimerForTests(undefined);
      }
    });

    it("releases performance timing state when fallback response construction rejects", async () => {
      __resetPerfTimerForTests(true);
      try {
        const handler = new SSRHandler(createMockSSRService({
          renderPage: () =>
            Promise.resolve({
              status: 302,
              isStreaming: false,
              cacheStrategy: "no-cache" as const,
              failure: {
                kind: "redirect" as const,
                location: "/login\r\nx-forged: value",
                permanent: false,
              },
              slug: "invalid-redirect",
            }),
        }));

        await assertRejects(() =>
          handler.handle(
            new Request("http://localhost/invalid-redirect"),
            makeCtx(),
          )
        );
        assertEquals(
          __trackedRequestIdsForTests(),
          [],
          "a rejected fallback must end its performance timing entry",
        );
      } finally {
        __resetPerfTimerForTests(undefined);
      }
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

    it("refreshes preview source inside the matching project context", async () => {
      const events: string[] = [];
      let inProjectContext = false;
      const mockService = createMockSSRService({
        renderPage: () => {
          events.push(inProjectContext ? "render-in-context" : "render-outside-context");
          return Promise.resolve({
            status: 200,
            html: "<html>current preview</html>",
            isStreaming: false,
            cacheStrategy: "short" as const,
            slug: "page",
          });
        },
      });
      const handler = new SSRHandler(mockService);
      const { ctx } = makeExtendedCtx({}, {
        allowHostProjectCodeExecution: true,
        projectSlug: "preview-project",
        projectId: "project-1",
        releaseId: undefined,
        requestContext: {
          token: "project-token",
          slug: "preview-project",
          branch: "main",
          mode: "preview",
        },
      });
      const fs = ctx.adapter.fs as unknown as {
        runWithContext: (
          slug: string,
          token: string,
          fn: () => Promise<HandlerResult>,
        ) => Promise<HandlerResult>;
        ensureSourceSnapshotFresh: (reason?: string) => Promise<void>;
        sourceSnapshotFreshnessOptionsVersion: 1;
      };
      fs.runWithContext = async (_slug, _token, fn) => {
        inProjectContext = true;
        try {
          return await fn();
        } finally {
          inProjectContext = false;
        }
      };
      fs.sourceSnapshotFreshnessOptionsVersion = 1;
      fs.ensureSourceSnapshotFresh = () => {
        events.push(inProjectContext ? "refresh-in-context" : "refresh-outside-context");
        return Promise.resolve();
      };

      const result = await handler.handle(new Request("http://localhost/page"), ctx);

      assertEquals(result.response?.status, 200);
      assertEquals(events, ["refresh-in-context", "render-in-context"]);
    });

    it("prefers the authenticated request branch for multi-project rendering", async () => {
      let renderedBranch: string | null | undefined;
      const handler = new SSRHandler(createMockSSRService());
      const { ctx } = makeExtendedCtx({}, {
        allowHostProjectCodeExecution: true,
        projectSlug: "preview-project",
        projectId: "project-1",
        requestContext: {
          token: "project-token",
          slug: "preview-project",
          branch: "request-branch",
          mode: "preview",
        },
        parsedDomain: {
          slug: null,
          branch: "domain-branch",
          environment: null,
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        } as never,
      });
      const fs = ctx.adapter.fs as unknown as {
        runWithContext: (
          slug: string,
          token: string,
          fn: () => Promise<HandlerResult>,
          projectId?: string,
          options?: { branch?: string | null },
        ) => Promise<HandlerResult>;
      };
      fs.runWithContext = async (_slug, _token, fn, _projectId, options) => {
        renderedBranch = options?.branch;
        return await fn();
      };

      const result = await handler.handle(new Request("http://localhost/page"), ctx);

      assertEquals(result.response?.status, 200);
      assertEquals(renderedBranch, "request-branch");
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
          branch: "domain-branch",
          environment: null,
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        } as any,
        requestContext: {
          token: "ctx-token",
          slug: "preview-project",
          branch: "request-branch",
          mode: "production",
        },
        resolvedEnvironment: "production",
        releaseId: "rel-5",
      });

      await handler.handle(new Request("http://localhost/test"), ctx);

      assertEquals(calls.setRequestToken![0], "ctx-token");
      assertEquals(calls.setRequestBranch![0], "request-branch");
      assertEquals(calls.setProductionMode![0], true);
      assertEquals(calls.setProductionMode![1], "rel-5");
    });

    it("re-establishes strict freshness after a branch switch on a reused contextual adapter", async () => {
      // The API/page classifier prepares strict freshness before SSR enters
      // its adapter context. When SSR then switches the reused contextual
      // adapter to the requested branch, the prepared snapshot describes the
      // previous branch and must not satisfy the document render.
      const refreshedIdentities: string[] = [];
      const refreshedRequestBranches: Array<string | null | undefined> = [];
      let adapterBranch: string | null = "main"; // left over from the previous request
      const fs = {
        ...createMockAdapter().fs,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        isMultiProjectMode: () => false,
        isContextualMode: () => true,
        setRequestToken: (_t: string) => {},
        setRequestBranch: (b: string | null) => {
          adapterBranch = b;
        },
        setProductionMode: (_p: boolean, _r?: string) => {},
        getSourceSnapshotIdentity: () => `branch:preview-project:${adapterBranch ?? "main"}`,
        getSourceSnapshotVersion: () => 1,
        refreshSourceSnapshot: () => {
          refreshedIdentities.push(`branch:preview-project:${adapterBranch ?? "main"}`);
          refreshedRequestBranches.push(getCurrentRequestContext()?.branch);
          return Promise.resolve();
        },
      };
      const adapter = { ...createMockAdapter(), fs } as unknown as RuntimeAdapter;
      const ctx = makeCtx({
        adapter,
        projectSlug: "preview-project",
        parsedDomain: {
          slug: null,
          branch: "feature",
          environment: null,
          isVeryfrontDomain: false,
          isDraft: false,
          allowIframeEmbed: false,
        } as any,
        requestContext: {
          token: "",
          slug: "preview-project",
          branch: "feature",
          mode: "preview",
        },
      });

      // The classifier's preparation runs before SSR's context setup, so it
      // refreshes whatever branch the reused adapter still points at.
      await preparePreviewDocumentSourceSnapshot(ctx);
      assertEquals(refreshedIdentities, ["branch:preview-project:main"]);
      assertEquals(refreshedRequestBranches, [undefined]);

      const result = await new SSRHandler(createMockSSRService()).handle(
        new Request("http://localhost/page"),
        ctx,
      );

      assertEquals(result.response?.status, 200);
      assertEquals(
        refreshedIdentities,
        ["branch:preview-project:main", "branch:preview-project:feature"],
        "the render must re-establish freshness for the branch it actually reads from",
      );
      assertEquals(refreshedRequestBranches, [undefined, "feature"]);
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
