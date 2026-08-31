import "#veryfront/schemas/_test-setup.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HandlerContext } from "#veryfront/types";
import type { ApplicationIdentity } from "#veryfront/security/application-auth/types.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env";
import {
  getActiveSourceIntegrationPolicy,
  runWithExactSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  ProjectMiddlewareRuntime,
  type ProjectMiddlewareRuntimeContext,
} from "./project-middleware.ts";
import {
  finishPreviewDocumentSourceSnapshot,
  preparePreviewDocumentSourceSnapshot,
  seedPreviewDocumentSourceSnapshot,
} from "../handlers/request/source-snapshot-freshness.ts";

interface ActiveFsContext {
  projectSlug: string;
  projectId?: string;
  releaseId?: string | null;
  branch?: string | null;
}

function createAdapter(
  storage = new AsyncLocalStorage<ActiveFsContext>(),
  middlewareSource?: string,
  options: {
    requireContextForFileAccess?: boolean;
    onFileAccess?: () => void;
    onFileRead?: () => void;
  } = {},
): RuntimeAdapter {
  const assertContext = () => {
    options.onFileAccess?.();
    if (options.requireContextForFileAccess && !storage.getStore()) {
      throw new Error("[test] No request context available");
    }
  };
  const fs = {
    getUnderlyingAdapter: () => fs,
    getAdapterType: () => "MultiProjectFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
    isContextualMode: () => true,
    exists: (path: string) => {
      assertContext();
      return Promise.resolve(middlewareSource !== undefined && path.endsWith("/middleware.ts"));
    },
    readFile: () => {
      assertContext();
      options.onFileRead?.();
      return Promise.resolve(middlewareSource ?? "");
    },
    runWithContext: <T>(
      projectSlug: string,
      _token: string,
      fn: () => Promise<T>,
      projectId?: string,
      options?: {
        releaseId?: string | null;
        branch?: string | null;
      },
    ) =>
      storage.run(
        {
          projectSlug,
          projectId,
          releaseId: options?.releaseId,
          branch: options?.branch,
        },
        fn,
      ),
  } as unknown as RuntimeAdapter["fs"];

  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs,
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({ HOST_SECRET: "must-not-leak" }),
    },
    server: {} as RuntimeAdapter["server"],
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

function createContext(
  adapter: RuntimeAdapter,
  overrides: Partial<HandlerContext> = {},
): HandlerContext {
  return {
    projectDir: "/app",
    adapter,
    securityConfig: null,
    projectSlug: "trusted-project",
    projectId: "project-a",
    releaseId: "release-a",
    proxyToken: "trusted-token",
    environmentName: "Production",
    resolvedEnvironment: "production",
    requestContext: {
      token: "trusted-token",
      slug: "trusted-project",
      branch: null,
      mode: "production",
    },
    isLocalProject: false,
    ...overrides,
  };
}

function createIdentity(): ApplicationIdentity {
  return Object.freeze({
    issuer: "veryfront:trusted-proxy",
    subject: "user-123",
    email: "user@example.test",
    groups: Object.freeze(["admin"]),
    roles: Object.freeze([]),
    groupsComplete: true,
    claims: Object.freeze({
      sub: "user-123",
      email: "user@example.test",
      groups: Object.freeze(["admin"]),
    }),
  });
}

function execute(
  runtime: ProjectMiddlewareRuntime,
  context: HandlerContext,
  request = new Request("https://example.com/resource"),
  next = () => Promise.resolve(new Response("route")),
): Promise<Response | undefined> {
  const runtimeContext: ProjectMiddlewareRuntimeContext = {
    request,
    handlerContext: context,
    isSharedProxy: true,
    next,
  };
  return runtime.execute(runtimeContext);
}

describe("ProjectMiddlewareRuntime", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("loads production middleware in trusted filesystem context and caches by release", async () => {
    const storage = new AsyncLocalStorage<ActiveFsContext>();
    const adapter = createAdapter(storage);
    const loadedContexts: ActiveFsContext[] = [];
    let loadCount = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCount++;
        loadedContexts.push(storage.getStore()!);
        return Promise.resolve([
          async (_c, next) => {
            const response = await next();
            response?.headers.set("x-project-middleware", "applied");
            return response;
          },
        ]);
      },
    });
    const context = createContext(adapter);
    const spoofedRequest = new Request("https://example.com/resource", {
      headers: { "x-project-slug": "spoofed-project" },
    });

    const first = await execute(runtime, context, spoofedRequest);
    const second = await execute(runtime, context, spoofedRequest);

    assertEquals(loadCount, 1);
    assertEquals(first?.headers.get("x-project-middleware"), "applied");
    assertEquals(second?.headers.get("x-project-middleware"), "applied");
    assertEquals(loadedContexts, [{
      projectSlug: "trusted-project",
      projectId: "project-a",
      releaseId: "release-a",
      branch: null,
    }]);
  });

  it("reloads middleware when the production release changes", async () => {
    const adapter = createAdapter();
    let loadCount = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        const version = ++loadCount;
        return Promise.resolve([() => new Response(`middleware-${version}`)]);
      },
    });

    const first = await execute(runtime, createContext(adapter));
    const second = await execute(
      runtime,
      createContext(adapter, { releaseId: "release-b" }),
    );

    assertEquals(await first?.text(), "middleware-1");
    assertEquals(await second?.text(), "middleware-2");
    assertEquals(loadCount, 2);
  });

  it("does not cache mutable preview middleware by branch name", async () => {
    const adapter = createAdapter();
    let loadCount = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCount++;
        return Promise.resolve([]);
      },
    });
    const previewContext = (branch: string): HandlerContext =>
      createContext(adapter, {
        releaseId: undefined,
        resolvedEnvironment: "preview",
        requestContext: {
          token: "trusted-token",
          slug: "trusted-project",
          branch,
          mode: "preview",
        },
      });

    await execute(runtime, previewContext("feature-a"));
    await execute(runtime, previewContext("feature-a"));
    await execute(runtime, previewContext("feature-b"));
    assertEquals(loadCount, 3);
    assertEquals(runtime.size, 0);

    assertEquals(runtime.invalidateProject("project-a"), 0);
    await execute(runtime, previewContext("feature-b"));
    assertEquals(loadCount, 4);
  });

  it("rejects a preview middleware response from a newer source generation", async () => {
    let sourceVersion = 1;
    const adapter = createAdapter();
    adapter.fs.getSourceSnapshotIdentity = () => "branch:trusted-project:main";
    adapter.fs.getSourceSnapshotVersion = () => sourceVersion;
    const context = createContext(adapter, {
      releaseId: undefined,
      environmentName: "Preview",
      resolvedEnvironment: "preview",
      requestContext: {
        token: "trusted-token",
        slug: "trusted-project",
        branch: "main",
        mode: "preview",
      },
    });
    seedPreviewDocumentSourceSnapshot(context, {
      identity: "branch:trusted-project:main",
      version: sourceVersion,
    });
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          () => {
            sourceVersion++;
            return new Response("new-generation middleware");
          },
        ]),
    });

    const rejection = await assertRejects(() => execute(runtime, context));

    assertInstanceOf(rejection, Error);
    assertEquals(
      rejection.message.includes("changed after request configuration was derived"),
      true,
    );
  });

  it("rejects a source change before loading preview middleware", async () => {
    let sourceVersion = 1;
    let loadCount = 0;
    const adapter = createAdapter();
    adapter.fs.getSourceSnapshotIdentity = () => "branch:trusted-project:main";
    adapter.fs.getSourceSnapshotVersion = () => sourceVersion;
    const context = createContext(adapter, {
      releaseId: undefined,
      environmentName: "Preview",
      resolvedEnvironment: "preview",
      requestContext: {
        token: "trusted-token",
        slug: "trusted-project",
        branch: "main",
        mode: "preview",
      },
    });
    seedPreviewDocumentSourceSnapshot(context, {
      identity: "branch:trusted-project:main",
      version: sourceVersion,
    });
    sourceVersion++;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCount++;
        return Promise.resolve([]);
      },
    });

    await assertRejects(
      () => execute(runtime, context),
      Error,
      "changed after request configuration was derived",
    );
    assertEquals(loadCount, 0);
  });

  it("retains the config marker after a downstream document handler releases it", async () => {
    let sourceVersion = 1;
    const adapter = createAdapter();
    adapter.fs.getSourceSnapshotIdentity = () => "branch:trusted-project:main";
    adapter.fs.getSourceSnapshotVersion = () => sourceVersion;
    const context = createContext(adapter, {
      releaseId: undefined,
      environmentName: "Preview",
      resolvedEnvironment: "preview",
      requestContext: {
        token: "trusted-token",
        slug: "trusted-project",
        branch: "main",
        mode: "preview",
      },
    });
    seedPreviewDocumentSourceSnapshot(context, {
      identity: "branch:trusted-project:main",
      version: sourceVersion,
    });
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => Promise.resolve([]),
    });

    await assertRejects(
      () =>
        execute(runtime, context, undefined, async () => {
          await finishPreviewDocumentSourceSnapshot(context);
          sourceVersion++;
          return new Response("stale route response");
        }),
      Error,
      "changed after request configuration was derived",
    );
  });

  it("validates framework-owned OPTIONS dispatch against the retained snapshot", async () => {
    let sourceVersion = 1;
    const adapter = createAdapter();
    adapter.fs.getSourceSnapshotIdentity = () => "branch:trusted-project:main";
    adapter.fs.getSourceSnapshotVersion = () => sourceVersion;
    const context = createContext(adapter, {
      releaseId: undefined,
      environmentName: "Preview",
      resolvedEnvironment: "preview",
      requestContext: {
        token: "trusted-token",
        slug: "trusted-project",
        branch: "main",
        mode: "preview",
      },
    });
    seedPreviewDocumentSourceSnapshot(context, {
      identity: "branch:trusted-project:main",
      version: sourceVersion,
    });
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => Promise.resolve([]),
    });

    await assertRejects(
      () =>
        runtime.execute({
          request: new Request("https://example.com/api/automatic", { method: "OPTIONS" }),
          handlerContext: context,
          isSharedProxy: false,
          isFrameworkOwnedPreflight: true,
          next: async () => {
            sourceVersion++;
            return new Response(null, { status: 204 });
          },
        }),
      Error,
      "changed after request configuration was derived",
    );
  });

  it("validates the config marker before forwarding a streamed response chunk", async () => {
    let sourceVersion = 1;
    let releaseBody!: () => void;
    const bodyGate = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    const adapter = createAdapter();
    adapter.fs.getSourceSnapshotIdentity = () => "branch:trusted-project:main";
    adapter.fs.getSourceSnapshotVersion = () => sourceVersion;
    const context = createContext(adapter, {
      releaseId: undefined,
      environmentName: "Preview",
      resolvedEnvironment: "preview",
      requestContext: {
        token: "trusted-token",
        slug: "trusted-project",
        branch: "main",
        mode: "preview",
      },
    });
    seedPreviewDocumentSourceSnapshot(context, {
      identity: "branch:trusted-project:main",
      version: sourceVersion,
    });
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => Promise.resolve([]),
    });

    const response = await execute(
      runtime,
      context,
      undefined,
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              async pull(controller) {
                await bodyGate;
                sourceVersion++;
                controller.enqueue(new TextEncoder().encode("new-generation body"));
                controller.close();
              },
            }),
          ),
        ),
    );

    const reader = response!.body!.getReader();
    releaseBody();
    const rejection = await assertRejects(() => reader.read());
    assertInstanceOf(rejection, Error);
    assertEquals(
      rejection.message.includes("changed after request configuration was derived"),
      true,
    );
  });

  it("validates the config marker when a streamed response body is canceled", async () => {
    let sourceVersion = 1;
    const adapter = createAdapter();
    adapter.fs.getSourceSnapshotIdentity = () => "branch:trusted-project:main";
    adapter.fs.getSourceSnapshotVersion = () => sourceVersion;
    const context = createContext(adapter, {
      releaseId: undefined,
      environmentName: "Preview",
      resolvedEnvironment: "preview",
      requestContext: {
        token: "trusted-token",
        slug: "trusted-project",
        branch: "main",
        mode: "preview",
      },
    });
    seedPreviewDocumentSourceSnapshot(context, {
      identity: "branch:trusted-project:main",
      version: sourceVersion,
    });
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => Promise.resolve([]),
    });

    const response = await execute(
      runtime,
      context,
      undefined,
      () =>
        Promise.resolve(
          new Response(
            new ReadableStream({
              pull() {
                return new Promise<void>(() => {});
              },
            }),
          ),
        ),
    );

    sourceVersion++;
    const rejection = await assertRejects(() => response!.body!.cancel());
    assertInstanceOf(rejection, Error);
    assertEquals(
      rejection.message.includes("changed after request configuration was derived"),
      true,
    );
  });

  it("validates deferred host-token streams inside the effective tenant context", async () => {
    const adapter = createAdapter();
    let activeContextDepth = 0;
    const contextualFs = adapter.fs as typeof adapter.fs & {
      runWithContext<T>(
        projectSlug: string,
        token: string,
        fn: () => Promise<T>,
      ): Promise<T>;
    };
    contextualFs.runWithContext = async <T>(
      _projectSlug: string,
      _token: string,
      fn: () => Promise<T>,
    ): Promise<T> => {
      activeContextDepth++;
      try {
        return await fn();
      } finally {
        activeContextDepth--;
      }
    };
    const requireContext = () => {
      if (activeContextDepth === 0) throw new Error("[test] No request context available");
    };
    adapter.fs.getSourceSnapshotIdentity = () => {
      requireContext();
      return "branch:trusted-project:main";
    };
    adapter.fs.getSourceSnapshotVersion = () => {
      requireContext();
      return 1;
    };
    const context = createContext(adapter, {
      proxyToken: undefined,
      releaseId: undefined,
      resolvedEnvironment: "preview",
      requestContext: {
        token: "host-authorized-token",
        slug: "trusted-project",
        branch: "main",
        mode: "preview",
      },
    });
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => Promise.resolve([]),
    });

    let chunk = 0;
    const response = await execute(runtime, context, undefined, () => {
      seedPreviewDocumentSourceSnapshot(context, {
        identity: "branch:trusted-project:main",
        version: 1,
      });
      return Promise.resolve(
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new TextEncoder().encode(chunk++ === 0 ? "route-" : "body"));
              if (chunk === 2) controller.close();
            },
          }),
        ),
      );
    });

    assertEquals(await response?.text(), "route-body");
    assertEquals(activeContextDepth, 0);
  });

  it("rejects a route response when snapshot finalization requests reclassification", async () => {
    let sourceVersion = 1;
    const adapter = createAdapter();
    adapter.fs.refreshSourceSnapshot = () => Promise.resolve();
    adapter.fs.getSourceSnapshotIdentity = () => "branch:trusted-project:main";
    adapter.fs.getSourceSnapshotVersion = () => sourceVersion;
    const context = createContext(adapter, {
      releaseId: undefined,
      resolvedEnvironment: "preview",
      requestContext: {
        token: "trusted-token",
        slug: "trusted-project",
        branch: "main",
        mode: "preview",
      },
    });
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => Promise.resolve([]),
    });

    const rejection = await assertRejects(async () => {
      const response = await execute(runtime, context, undefined, async () => {
        await preparePreviewDocumentSourceSnapshot(
          context,
          () => Promise.resolve({ response: new Response("reclassified") }),
        );
        sourceVersion++;
        return new Response("stale");
      });
      await response!.text();
    });

    assertInstanceOf(rejection, Error);
    assertEquals(rejection.message.includes("changed during handler dispatch"), true);
  });

  it("evicts cached production middleware for the invalidated project", async () => {
    const adapter = createAdapter();
    let loadCount = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCount++;
        return Promise.resolve([]);
      },
    });

    await execute(runtime, createContext(adapter));
    assertEquals(loadCount, 1);
    assertEquals(runtime.size, 1);

    assertEquals(runtime.invalidateProject("nope"), 0, "a non-matching identity must not evict");
    assertEquals(runtime.size, 1, "a non-matching identity must leave the cache intact");

    assertEquals(
      runtime.invalidateProject("project-a"),
      1,
      "invalidation must evict the compiled middleware entry",
    );
    assertEquals(runtime.size, 0, "the invalidated project must have no cached middleware");

    await execute(runtime, createContext(adapter));
    assertEquals(loadCount, 2, "a request after invalidation must reload the middleware");
  });

  it("does not cache shared middleware without a canonical project ID", async () => {
    const adapter = createAdapter();
    let loadCount = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCount++;
        return Promise.resolve([]);
      },
    });
    const context = createContext(adapter, { projectId: undefined });

    await execute(runtime, context);
    await execute(runtime, context);

    assertEquals(loadCount, 2);
    assertEquals(runtime.size, 0);
  });

  it("separates identical releases for distinct canonical projects", async () => {
    const adapter = createAdapter();
    let loadCount = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        const version = ++loadCount;
        return Promise.resolve([() => new Response(`middleware-${version}`)]);
      },
    });

    const projectA = await execute(runtime, createContext(adapter));
    const projectB = await execute(
      runtime,
      createContext(adapter, {
        projectSlug: "trusted-project-b",
        projectId: "project-b",
        releaseId: "release-a",
      }),
    );

    assertEquals(await projectA?.text(), "middleware-1");
    assertEquals(await projectB?.text(), "middleware-2");
    assertEquals(loadCount, 2);
  });

  it("passes through when the project has no root middleware", async () => {
    const adapter = createAdapter();
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => Promise.resolve([]),
    });
    let routeCalls = 0;

    const response = await execute(
      runtime,
      createContext(adapter),
      undefined,
      () => {
        routeCalls++;
        return Promise.resolve(new Response("route"));
      },
    );

    assertEquals(routeCalls, 1);
    assertEquals(await response?.text(), "route");
  });

  it("preserves short-circuit and pass-through middleware ordering", async () => {
    const adapter = createAdapter();
    const calls: string[] = [];
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          async (c, next) => {
            calls.push("first:before");
            if (c.req.headers.get("x-block") === "1") {
              return new Response("blocked", { status: 401 });
            }
            const response = await next();
            calls.push("first:after");
            return response;
          },
          async (_c, next) => {
            calls.push("second:before");
            const response = await next();
            calls.push("second:after");
            return response;
          },
        ]),
    });
    let routeCalls = 0;
    const next = () => {
      routeCalls++;
      calls.push("route");
      return Promise.resolve(new Response("route"));
    };

    const blocked = await execute(
      runtime,
      createContext(adapter),
      new Request("https://example.com/resource", { headers: { "x-block": "1" } }),
      next,
    );
    assertEquals(blocked?.status, 401);
    assertEquals(routeCalls, 0);
    assertEquals(calls, ["first:before"]);

    calls.length = 0;
    const allowed = await execute(runtime, createContext(adapter), undefined, next);
    assertEquals(await allowed?.text(), "route");
    assertEquals(routeCalls, 1);
    assertEquals(calls, [
      "first:before",
      "second:before",
      "route",
      "second:after",
      "first:after",
    ]);
  });

  it("exposes application auth while withholding infrastructure headers", async () => {
    const adapter = createAdapter();
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          (c) =>
            Response.json({
              authorization: c.req.headers.get("authorization"),
              cookie: c.req.headers.get("cookie"),
              proxyAuthorization: c.req.headers.get("proxy-authorization"),
              forwardedHost: c.req.headers.get("x-forwarded-host"),
              projectId: c.req.headers.get("x-project-id"),
              platformToken: c.req.headers.get("x-token"),
              dispatchSignature: c.req.headers.get("x-veryfront-dispatch-jws"),
            }),
        ]),
    });
    const response = await execute(
      runtime,
      createContext(adapter),
      new Request("https://example.com/resource", {
        headers: {
          authorization: "Bearer application-token",
          cookie: "session=application-cookie",
          "proxy-authorization": "Basic infrastructure-proxy-token",
          "x-forwarded-host": "internal-proxy.example",
          "x-project-id": "infrastructure-project",
          "x-token": "platform-service-token",
          "x-veryfront-dispatch-jws": "signed-dispatch-request",
        },
      }),
    );

    assertEquals(await response?.json(), {
      authorization: "Bearer application-token",
      cookie: "session=application-cookie",
      proxyAuthorization: null,
      forwardedHost: null,
      projectId: null,
      platformToken: null,
      dispatchSignature: null,
    });
  });

  it("exposes admitted application identity on the typed middleware context", async () => {
    const adapter = createAdapter();
    const identity = createIdentity();
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          (c) => {
            assertEquals(c.identity, identity);
            assertEquals(Object.isFrozen(c.identity), true);
            assertEquals(Object.isFrozen(c.identity?.claims), true);
            c.set("identity", null);
            return Response.json({
              middlewareIdentity: c.identity,
              userWritableVar: c.get("identity"),
            });
          },
        ]),
    });

    const response = await execute(
      runtime,
      createContext(adapter, {
        applicationIdentity: identity,
        applicationIdentityHeaderNames: ["x-auth-subject"],
      }),
    );

    assertEquals(await response?.json(), {
      middlewareIdentity: identity,
      userWritableVar: null,
    });
  });

  it("exposes null middleware identity when no application auth admission ran", async () => {
    const adapter = createAdapter();
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          (c) =>
            Response.json({
              identity: c.identity,
            }),
        ]),
    });

    const response = await execute(runtime, createContext(adapter));

    assertEquals(await response?.json(), { identity: null });
  });

  it("strips configured application identity headers before middleware executes", async () => {
    const adapter = createAdapter();
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          (c) =>
            Response.json({
              subjectLower: c.req.headers.get("x-auth-subject"),
              subjectMixed: c.req.headers.get("X-Auth-Subject"),
              email: c.req.headers.get("x-auth-email"),
              authorization: c.req.headers.get("authorization"),
            }),
        ]),
    });

    const response = await execute(
      runtime,
      createContext(adapter, {
        applicationIdentity: createIdentity(),
        applicationIdentityHeaderNames: ["x-auth-subject", "x-auth-email"],
      }),
      new Request("https://example.com/resource", {
        headers: {
          "X-Auth-Subject": "forged-user",
          "x-auth-email": "forged@example.test",
          authorization: "Bearer application-token",
        },
      }),
    );

    assertEquals(await response?.json(), {
      subjectLower: null,
      subjectMixed: null,
      email: null,
      authorization: "Bearer application-token",
    });
  });

  it("detaches the project request while preserving WebSocket and response behavior", async () => {
    const adapter = createAdapter();
    const request = new Request("https://example.com/socket", {
      headers: { upgrade: "websocket" },
    });
    const routeResponse = new Response("upgrade handoff");
    let middlewareSawRequest = false;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          async (c, next) => {
            assertEquals(c.req === request, false);
            assertEquals(c.req.headers.get("upgrade"), "websocket");
            middlewareSawRequest = true;
            return await next();
          },
        ]),
    });

    const response = await execute(
      runtime,
      createContext(adapter),
      request,
      () => Promise.resolve(routeResponse),
    );

    assertEquals(middlewareSawRequest, true);
    assertEquals(response === routeResponse, true);
  });

  it("isolates concurrent projects and ignores project selectors on the request", async () => {
    const storage = new AsyncLocalStorage<ActiveFsContext>();
    const adapter = createAdapter(storage);
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: async () => {
        const before = storage.getStore()?.projectSlug;
        await new Promise((resolve) => setTimeout(resolve, 5));
        const after = storage.getStore()?.projectSlug;
        assertEquals(after, before);
        return [() => new Response(before)];
      },
    });
    const request = new Request("https://example.com/resource", {
      headers: { "x-project-slug": "untrusted-project" },
    });

    const [projectA, projectB] = await Promise.all([
      execute(runtime, createContext(adapter), request),
      execute(
        runtime,
        createContext(adapter, {
          projectSlug: "trusted-project-b",
          projectId: "project-b",
          releaseId: "release-b",
          requestContext: {
            token: "trusted-token",
            slug: "trusted-project-b",
            branch: null,
            mode: "production",
          },
        }),
        request,
      ),
    ]);

    assertEquals(await projectA?.text(), "trusted-project");
    assertEquals(await projectB?.text(), "trusted-project-b");
  });

  it("evicts rejected loads so the affected project can recover", async () => {
    const adapter = createAdapter();
    let attempts = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error("compile failed"));
        return Promise.resolve([() => new Response("recovered")]);
      },
    });

    await assertRejects(
      () => execute(runtime, createContext(adapter)),
      Error,
      "compile failed",
    );
    const response = await execute(runtime, createContext(adapter));

    assertEquals(attempts, 2);
    assertEquals(await response?.text(), "recovered");
  });

  it("returns an unavailable response before reading or evaluating shared middleware", async () => {
    const marker = `__vf_project_middleware_${crypto.randomUUID().replaceAll("-", "")}`;
    const host = globalThis as unknown as Record<string, unknown>;
    let sourceReads = 0;
    const adapter = createAdapter(
      undefined,
      `globalThis.${marker} = Deno.env.get("HOST_SECRET"); export default [];`,
      { onFileRead: () => sourceReads++ },
    );
    const runtime = new ProjectMiddlewareRuntime();
    let routeCalls = 0;

    try {
      const response = await execute(
        runtime,
        createContext(adapter),
        undefined,
        () => {
          routeCalls++;
          return Promise.resolve(new Response("route"));
        },
      );

      assertEquals(response?.status, 503);
      assertEquals(response?.headers.get("cache-control"), "no-store");
      assertEquals(response?.headers.get("content-type"), "application/problem+json");
      const problem = await response?.json();
      assertEquals(problem?.title, "Project execution unavailable");

      const headResponse = await execute(
        runtime,
        createContext(adapter),
        new Request("https://example.com/resource", { method: "HEAD" }),
      );
      assertEquals(headResponse?.status, 503);
      assertEquals(headResponse?.headers.get("cache-control"), "no-store");
      assertEquals(await headResponse?.text(), "");
      assertEquals(sourceReads, 0);
      assertEquals(host[marker], undefined);
      assertEquals(routeCalls, 0);
    } finally {
      delete host[marker];
    }
  });

  it("honors an explicit host-execution denial outside proxy mode", async () => {
    const marker = `__vf_denied_project_middleware_${crypto.randomUUID().replaceAll("-", "")}`;
    const host = globalThis as unknown as Record<string, unknown>;
    let sourceReads = 0;
    const adapter = createAdapter(
      undefined,
      `globalThis.${marker} = Deno.env.get("HOST_SECRET"); export default [];`,
      { onFileRead: () => sourceReads++ },
    );
    const runtime = new ProjectMiddlewareRuntime();
    let routeCalls = 0;

    try {
      const response = await runtime.execute({
        request: new Request("https://example.com/resource"),
        handlerContext: createContext(adapter, {
          allowHostProjectCodeExecution: false,
        }),
        isSharedProxy: false,
        next: () => {
          routeCalls++;
          return Promise.resolve(new Response("route"));
        },
      });

      assertEquals(response?.status, 503);
      assertEquals(response?.headers.get("cache-control"), "no-store");
      assertEquals(sourceReads, 0);
      assertEquals(host[marker], undefined);
      assertEquals(routeCalls, 0);
    } finally {
      delete host[marker];
    }
  });

  it("passes through shared requests when no root middleware exists", async () => {
    const runtime = new ProjectMiddlewareRuntime();
    let routeCalls = 0;

    const response = await execute(
      runtime,
      createContext(createAdapter()),
      undefined,
      () => {
        routeCalls++;
        return Promise.resolve(new Response("route"));
      },
    );

    assertEquals(routeCalls, 1);
    assertEquals(await response?.text(), "route");
  });

  it("keeps the compiled middleware cache bounded", async () => {
    const adapter = createAdapter();
    let loads = 0;
    const runtime = new ProjectMiddlewareRuntime({
      maxEntries: 1,
      loadMiddleware: () => {
        loads++;
        return Promise.resolve([]);
      },
    });

    await execute(runtime, createContext(adapter));
    await execute(
      runtime,
      createContext(adapter, {
        projectSlug: "trusted-project-b",
        projectId: "project-b",
        releaseId: "release-b",
      }),
    );
    await execute(runtime, createContext(adapter));

    assertEquals(runtime.size, 1);
    assertEquals(loads, 3);
  });

  it("exposes only the active project environment to middleware", async () => {
    const adapter = createAdapter();
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          (c) => Response.json(c.env),
        ]),
    });

    const response = await runWithProjectEnv(
      { TENANT_VALUE: "project-only" },
      () => execute(runtime, createContext(adapter)),
    );

    assertEquals(await response?.json(), { TENANT_VALUE: "project-only" });
  });

  it("bypasses project middleware for config-optional control-plane run routes", async () => {
    const adapter = createAdapter();
    let loads = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loads++;
        return Promise.resolve([
          () => new Response("project-middleware", { status: 418 }),
        ]);
      },
    });
    const context = createContext(adapter, { releaseId: undefined });
    let routeCalls = 0;
    const next = () => {
      routeCalls++;
      return Promise.resolve(new Response("route"));
    };
    const requests = [
      new Request("https://example.com/api/control-plane/runs/run_1/stream", {
        method: "POST",
      }),
      new Request("https://example.com/api/control-plane/runs/run_1/resume", {
        method: "POST",
      }),
      new Request("https://example.com/api/control-plane/runs/run_1", {
        method: "DELETE",
      }),
    ];

    for (const request of requests) {
      const response = await execute(runtime, context, request, next);
      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "route");
    }

    assertEquals(loads, 0);
    assertEquals(routeCalls, 3);
  });

  it("bypasses project middleware for proxy HMR websockets without request context", async () => {
    const adapter = createAdapter(
      undefined,
      undefined,
      { requireContextForFileAccess: true },
    );
    const runtime = new ProjectMiddlewareRuntime();
    const context = createContext(adapter, {
      proxyToken: undefined,
      releaseId: undefined,
      resolvedEnvironment: "preview",
      requestContext: {
        token: "",
        slug: "trusted-project",
        branch: "main",
        mode: "preview",
      },
    });
    let routeCalls = 0;

    const response = await execute(
      runtime,
      context,
      new Request("https://example.com/_ws?x-environment=preview&x-project-slug=trusted-project", {
        headers: { upgrade: "websocket" },
      }),
      () => {
        routeCalls++;
        return Promise.resolve(new Response("hmr"));
      },
    );

    assertEquals(await response?.text(), "hmr");
    assertEquals(routeCalls, 1);
  });

  it("bypasses project middleware for signed control-plane dispatches", async () => {
    // The control plane builds a release asset manifest by POSTing a signed
    // operation envelope to the project's own runtime. That dispatch is not the
    // project's traffic: it addresses a platform handler, and
    // `createApplicationRequest` strips every `x-veryfront-*` header before
    // project code sees the request, so middleware cannot even observe the
    // credential it would have to trust. A project whose middleware gates
    // requests would answer its own deploy with a rejection.
    const adapter = createAdapter();
    let loads = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loads++;
        return Promise.resolve([
          () => new Response("project-middleware", { status: 403 }),
        ]);
      },
    });
    let routeCalls = 0;
    const next = () => {
      routeCalls++;
      return Promise.resolve(new Response("route"));
    };
    const dispatches: Array<[string, string]> = [
      ["POST", "/api/control-plane/runs/run_1/execute"],
      ["POST", "/api/control-plane/runs/run_1/stream"],
      ["POST", "/api/control-plane/runs/run_1/resume"],
      ["POST", "/api/control-plane/agents/list"],
      ["DELETE", "/api/control-plane/runs/run_1"],
    ];

    for (const [method, path] of dispatches) {
      const response = await execute(
        runtime,
        createContext(adapter),
        new Request(`https://example.com${path}`, {
          method,
          headers: { "x-veryfront-control-plane-jws": "header.payload.signature" },
        }),
        next,
      );
      assertEquals(
        response?.status,
        200,
        `${method} ${path} was answered by project middleware`,
      );
      assertEquals(await response?.text(), "route");
    }

    assertEquals(loads, 0);
    assertEquals(routeCalls, dispatches.length);
  });

  it("keeps project middleware in front of look-alike control-plane paths", async () => {
    // The `/api/control-plane/` namespace is reserved but not exclusively
    // routed: paths the platform does not own fall through to project code, so
    // a signature header alone must never lift project middleware off a route
    // the project itself serves.
    const adapter = createAdapter();
    let loads = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loads++;
        return Promise.resolve([
          () => new Response("project-middleware", { status: 403 }),
        ]);
      },
    });
    let routeCalls = 0;
    const next = () => {
      routeCalls++;
      return Promise.resolve(new Response("route"));
    };
    const impostors: Array<[string, string]> = [
      // A project API route that merely sits inside the reserved namespace.
      ["POST", "/api/control-plane/checkout"],
      // A path that only starts alike.
      ["POST", "/api/control-plane-mirror/runs/run_1/execute"],
      // A registered surface addressed with a method no handler owns.
      ["PUT", "/api/control-plane/runs/run_1/execute"],
      // A deeper path under a registered surface.
      ["POST", "/api/control-plane/runs/run_1/execute/../../../checkout"],
    ];

    for (const [method, path] of impostors) {
      const response = await execute(
        runtime,
        createContext(adapter),
        new Request(`https://example.com${path}`, {
          method,
          headers: { "x-veryfront-control-plane-jws": "header.payload.signature" },
        }),
        next,
      );
      assertEquals(
        response?.status,
        403,
        `${method} ${path} skipped project middleware`,
      );
      assertEquals(await response?.text(), "project-middleware");
    }

    assertEquals(routeCalls, 0);
    assertEquals(loads > 0, true);
  });

  it("keeps project middleware enabled for control-plane run execution", async () => {
    // Unsigned: a request that only looks like a dispatch carries no envelope
    // for a control-plane handler to verify, so it stays project traffic and
    // project middleware keeps answering it.
    const adapter = createAdapter();
    let loads = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loads++;
        return Promise.resolve([
          () => new Response("project-middleware", { status: 418 }),
        ]);
      },
    });
    let routeCalls = 0;

    const response = await execute(
      runtime,
      createContext(adapter),
      new Request("https://example.com/api/control-plane/runs/run_1/execute", {
        method: "POST",
      }),
      () => {
        routeCalls++;
        return Promise.resolve(new Response("route"));
      },
    );

    assertEquals(response?.status, 418);
    assertEquals(await response?.text(), "project-middleware");
    assertEquals(loads, 1);
    assertEquals(routeCalls, 0);
  });

  it("separates shared middleware cache entries from host-execution entries", async () => {
    const adapter = createAdapter();
    let loads = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loads++;
        return Promise.resolve([]);
      },
    });
    let routeCalls = 0;
    const next = () => {
      routeCalls++;
      return Promise.resolve(new Response("route"));
    };

    await runtime.execute({
      request: new Request("https://example.com"),
      handlerContext: createContext(adapter),
      isSharedProxy: false,
      next,
    });
    await execute(runtime, createContext(adapter, { isLocalProject: true }), undefined, next);
    await execute(runtime, createContext(adapter, { proxyToken: undefined }), undefined, next);

    assertEquals(loads, 2);
    assertEquals(routeCalls, 3);
  });

  it("keeps middleware execution inside the exact source policy scope", async () => {
    const adapter = createAdapter();
    const policy = normalizeSourceIntegrationPolicy({
      allow: { confluence: { allowedTools: ["get_page"] } },
    });
    let observedPolicy: unknown;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          async (_context, next) => {
            observedPolicy = getActiveSourceIntegrationPolicy();
            return await next();
          },
        ]),
    });

    await runWithExactSourceIntegrationPolicy(policy, () =>
      runtime.execute({
        request: new Request("https://example.com"),
        handlerContext: createContext(adapter),
        isSharedProxy: false,
        next: () => Promise.resolve(new Response("route")),
      }));

    assertEquals(observedPolicy, policy);
  });
});
