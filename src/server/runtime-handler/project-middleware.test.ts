import "#veryfront/schemas/_test-setup.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createWebSocketUpgradeResponse,
  type RuntimeAdapter,
  type RuntimeResponse,
} from "#veryfront/platform/adapters/base.ts";
import { FS_ADAPTER_KIND } from "#veryfront/platform/adapters/fs/veryfront/types.ts";
import type { HandlerContext } from "#veryfront/types";
import { runWithProjectEnv } from "#veryfront/server/project-env";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import {
  getActiveSourceIntegrationPolicy,
  runWithExactSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import {
  ProjectMiddlewareRuntime,
  type ProjectMiddlewareRuntimeContext,
} from "./project-middleware.ts";
import { MAX_MIDDLEWARE_FUNCTIONS } from "#veryfront/server/dev-server/middleware.ts";

interface ActiveFsContext {
  projectSlug: string;
  projectId?: string;
  releaseId?: string | null;
  branch?: string | null;
}

function createAdapter(
  storage = new AsyncLocalStorage<ActiveFsContext>(),
  middlewareSource?: string,
): RuntimeAdapter {
  const fs = {
    [FS_ADAPTER_KIND]: "veryfront-multi-project" as const,
    getUnderlyingAdapter: () => fs,
    getAdapterType: () => "MultiProjectFSAdapter",
    isVeryfrontAdapter: () => true,
    isMultiProjectMode: () => true,
    isContextualMode: () => true,
    exists: (path: string) =>
      Promise.resolve(middlewareSource !== undefined && path.endsWith("/middleware.ts")),
    readFile: () => Promise.resolve(middlewareSource ?? ""),
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
    cspUserHeader: null,
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
    isLocalProject: true,
    ...overrides,
  };
}

function execute(
  runtime: ProjectMiddlewareRuntime,
  context: HandlerContext,
  request = new Request("https://example.com/resource"),
  next = (): Promise<RuntimeResponse> => Promise.resolve(new Response("route")),
  isSharedProxy = true,
): Promise<RuntimeResponse | undefined> {
  const runtimeContext: ProjectMiddlewareRuntimeContext = {
    request,
    handlerContext: context,
    isSharedProxy,
    next,
  };
  return runtime.execute(runtimeContext);
}

function expectResponse(response: RuntimeResponse | undefined): Response {
  if (!(response instanceof Response)) throw new Error("Expected an HTTP response");
  return response;
}

describe("ProjectMiddlewareRuntime", () => {
  afterAll(async () => {
    const { stop } = await import("veryfront/extensions/bundler");
    await stop();
  });

  it("rejects remote middleware without loading it in the host process", async () => {
    const adapter = createAdapter(
      undefined,
      "export default () => new Response('unsafe');",
    );
    let loadCalls = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCalls++;
        return Promise.resolve([() => new Response("unsafe")]);
      },
    });

    const response = await execute(
      runtime,
      createContext(adapter, { isLocalProject: false }),
    );

    assertEquals(response?.status, 503);
    assertEquals(response?.headers.get("cache-control"), "no-store");
    assertEquals(response?.headers.get("x-content-type-options"), "nosniff");
    assertEquals(loadCalls, 0);
  });

  it("fails closed in shared proxy mode when project locality is absent", async () => {
    const adapter = createAdapter(
      undefined,
      "export default () => new Response('unsafe');",
    );
    let loadCalls = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCalls++;
        return Promise.resolve([() => new Response("unsafe")]);
      },
    });

    const response = await execute(
      runtime,
      createContext(adapter, { isLocalProject: undefined }),
    );

    assertEquals(response?.status, 503);
    assertEquals(loadCalls, 0);
  });

  it("keeps absent locality compatible for standalone trusted runtimes", async () => {
    const adapter = createAdapter();
    let loadCalls = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCalls++;
        return Promise.resolve([() => new Response("standalone")]);
      },
    });

    const response = await execute(
      runtime,
      createContext(adapter, { isLocalProject: undefined }),
      undefined,
      undefined,
      false,
    );

    assertEquals(await expectResponse(response).text(), "standalone");
    assertEquals(loadCalls, 1);
  });

  it("passes remote requests through when the project has no middleware", async () => {
    const adapter = createAdapter();
    let loadCalls = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCalls++;
        return Promise.resolve([() => new Response("unsafe")]);
      },
    });

    const response = await execute(
      runtime,
      createContext(adapter, { isLocalProject: false }),
    );

    assertEquals(await expectResponse(response).text(), "route");
    assertEquals(loadCalls, 0);
  });

  it("rejects configured remote middleware without invoking it", async () => {
    const adapter = createAdapter();
    let middlewareCalls = 0;
    const runtime = new ProjectMiddlewareRuntime();
    const context = createContext(adapter, {
      isLocalProject: false,
      config: {
        middleware: {
          custom: [() => {
            middlewareCalls++;
            return new Response("unsafe");
          }],
        },
      } as HandlerContext["config"],
    });

    const response = await execute(runtime, context);

    assertEquals(response?.status, 503);
    assertEquals(middlewareCalls, 0);
  });

  it("fails closed when remote middleware presence cannot be verified", async () => {
    const adapter = createAdapter();
    adapter.fs.exists = () => Promise.reject(new Error("private filesystem failure"));
    let routeCalls = 0;
    const runtime = new ProjectMiddlewareRuntime();

    const response = await execute(
      runtime,
      createContext(adapter, { isLocalProject: false }),
      undefined,
      () => {
        routeCalls++;
        return Promise.resolve(new Response("unsafe"));
      },
    );

    assertEquals(response?.status, 503);
    assertEquals(routeCalls, 0);
  });

  it("does not expose a remote filesystem error name in middleware logs", async () => {
    const canary = "PRIVATE_REMOTE_ERROR_NAME";
    const adapter = createAdapter();
    adapter.fs.exists = () => {
      const error = new Error("private failure");
      error.name = canary;
      return Promise.reject(error);
    };
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));

    try {
      const response = await execute(
        new ProjectMiddlewareRuntime(),
        createContext(adapter, { isLocalProject: false }),
      );
      assertEquals(response?.status, 503);
      assertEquals(JSON.stringify(entries).includes(canary), false);
    } finally {
      __resetLogRecordEmitterForTests();
    }
  });

  it("returns a bodyless non-cacheable response for remote HEAD middleware requests", async () => {
    const response = await execute(
      new ProjectMiddlewareRuntime(),
      createContext(createAdapter(undefined, "export default () => new Response('unsafe');"), {
        isLocalProject: false,
      }),
      new Request("https://example.com/resource", { method: "HEAD" }),
    );

    assertEquals(response?.status, 503);
    assertEquals(await expectResponse(response).text(), "");
    assertEquals(response?.headers.get("cache-control"), "no-store");
    assertEquals(response?.headers.get("x-content-type-options"), "nosniff");
  });

  it("keeps explicitly local project middleware available", async () => {
    const adapter = createAdapter();
    let loadCalls = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCalls++;
        return Promise.resolve([() => new Response("local")]);
      },
    });

    const response = await execute(
      runtime,
      createContext(adapter, { isLocalProject: true }),
    );

    assertEquals(await expectResponse(response).text(), "local");
    assertEquals(loadCalls, 1);
  });

  it("loads trusted middleware without using request selector headers and caches by release", async () => {
    const adapter = createAdapter();
    const loadedProjectDirs: string[] = [];
    let loadCount = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: (projectDir) => {
        loadCount++;
        loadedProjectDirs.push(projectDir);
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
    assertEquals(loadedProjectDirs, ["/app"]);
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

    assertEquals(await expectResponse(first).text(), "middleware-1");
    assertEquals(await expectResponse(second).text(), "middleware-2");
    assertEquals(loadCount, 2);
  });

  it("does not share compiled middleware between adapter instances", async () => {
    const adapterA = createAdapter();
    const adapterB = createAdapter();
    Object.defineProperty(adapterA, "name", { value: "adapter-a" });
    Object.defineProperty(adapterB, "name", { value: "adapter-b" });
    let loadCount = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: (_projectDir, adapter) => {
        loadCount++;
        return Promise.resolve([() => new Response(adapter.name)]);
      },
    });

    const responseA = await execute(
      runtime,
      createContext(adapterA, { isLocalProject: true }),
    );
    const responseB = await execute(
      runtime,
      createContext(adapterB, { isLocalProject: true }),
    );

    assertEquals(await expectResponse(responseA).text(), "adapter-a");
    assertEquals(await expectResponse(responseB).text(), "adapter-b");
    assertEquals(loadCount, 2);
  });

  it("scopes preview middleware by branch and supports explicit project invalidation", async () => {
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
    assertEquals(loadCount, 2);

    assertEquals(runtime.invalidateProject("project-a"), 2);
    await execute(runtime, previewContext("feature-b"));
    assertEquals(loadCount, 3);
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
    assertEquals(await expectResponse(response).text(), "route");
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
    assertEquals(await expectResponse(allowed).text(), "route");
    assertEquals(routeCalls, 1);
    assertEquals(calls, [
      "first:before",
      "second:before",
      "route",
      "second:after",
      "first:after",
    ]);
  });

  it("preserves request and response identity for WebSocket upgrade handling", async () => {
    const adapter = createAdapter();
    const request = new Request("https://example.com/_ws", {
      headers: { upgrade: "websocket" },
    });
    const routeResponse = createWebSocketUpgradeResponse();
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () =>
        Promise.resolve([
          async (c, next) => {
            assertEquals(c.req === request, true);
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

    assertEquals(response === routeResponse, true);
  });

  it("isolates concurrent trusted project directories and ignores request selectors", async () => {
    const adapter = createAdapter();
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: async (projectDir) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return [() => new Response(projectDir)];
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
          projectDir: "/app-b",
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

    assertEquals(await expectResponse(projectA).text(), "/app");
    assertEquals(await expectResponse(projectB).text(), "/app-b");
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
    assertEquals(await expectResponse(response).text(), "recovered");
  });

  it("omits project identities and raw failures from middleware load logs", async () => {
    const canaries = [
      "PRIVATE_PROJECT_SLUG",
      "PRIVATE_PROJECT_ID",
      "PRIVATE_RELEASE_ID",
      "PRIVATE_BRANCH",
      "PRIVATE_LOAD_FAILURE",
    ] as const;
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => Promise.reject(new Error(canaries[4])),
    });
    const context = createContext(createAdapter(), {
      projectSlug: canaries[0],
      projectId: canaries[1],
      releaseId: canaries[2],
      requestContext: {
        token: "trusted-token",
        slug: canaries[0],
        branch: canaries[3],
        mode: "production",
      },
    });

    try {
      await assertRejects(() => execute(runtime, context), Error, canaries[4]);
      const serialized = JSON.stringify(entries);
      for (const canary of canaries) {
        assertEquals(serialized.includes(canary), false);
      }
    } finally {
      __resetLogRecordEmitterForTests();
    }
  });

  it("rejects malformed trusted middleware before routing", async () => {
    const adapter = createAdapter(
      undefined,
      "export const middleware = () => new Response('untrusted');",
    );
    const runtime = new ProjectMiddlewareRuntime();
    let routeCalls = 0;

    await assertRejects(
      () =>
        execute(runtime, createContext(adapter), undefined, () => {
          routeCalls++;
          return Promise.resolve(new Response("route"));
        }),
      TypeError,
      "Invalid middleware export",
    );

    assertEquals(routeCalls, 0);
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

  it("rejects oversized custom middleware configuration before loading files", async () => {
    const adapter = createAdapter();
    let loadCalls = 0;
    const runtime = new ProjectMiddlewareRuntime({
      loadMiddleware: () => {
        loadCalls++;
        return Promise.resolve([]);
      },
    });
    const custom = Array.from(
      { length: MAX_MIDDLEWARE_FUNCTIONS + 1 },
      () => () => new Response("unused"),
    );

    await assertRejects(
      () =>
        execute(
          runtime,
          createContext(adapter, {
            isLocalProject: true,
            config: { middleware: { custom } } as HandlerContext["config"],
          }),
        ),
      TypeError,
      "too many functions",
    );
    assertEquals(loadCalls, 0);
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

    assertEquals(await expectResponse(response).json(), { TENANT_VALUE: "project-only" });
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
    const context = createContext(adapter, { releaseId: undefined, isLocalProject: undefined });
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
      assertEquals(await expectResponse(response).text(), "route");
    }

    assertEquals(loads, 0);
    assertEquals(routeCalls, 3);
  });

  it("keeps project middleware enabled for control-plane run execution", async () => {
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
    assertEquals(await expectResponse(response).text(), "project-middleware");
    assertEquals(loads, 1);
    assertEquals(routeCalls, 0);
  });

  it("uses the same middleware runtime for local, standalone, and unauthenticated contexts", async () => {
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
      handlerContext: createContext(adapter, { isLocalProject: undefined }),
      isSharedProxy: false,
      next,
    });
    await execute(runtime, createContext(adapter, { isLocalProject: true }), undefined, next);
    await execute(
      runtime,
      createContext(adapter, { isLocalProject: undefined, proxyToken: undefined }),
      undefined,
      next,
    );

    assertEquals(loads, 1);
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
