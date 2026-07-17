import "#veryfront/schemas/_test-setup.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { HandlerContext } from "#veryfront/types";
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
    isLocalProject: false,
    ...overrides,
  };
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

  it("preserves request and response identity for WebSocket upgrade handling", async () => {
    const adapter = createAdapter();
    const request = new Request("https://example.com/_ws", {
      headers: { upgrade: "websocket" },
    });
    const routeResponse = new Response("upgrade handoff");
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

  it("rejects malformed shared production middleware before routing", async () => {
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
    assertEquals(await response?.text(), "project-middleware");
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
      handlerContext: createContext(adapter),
      isSharedProxy: false,
      next,
    });
    await execute(runtime, createContext(adapter, { isLocalProject: true }), undefined, next);
    await execute(runtime, createContext(adapter, { proxyToken: undefined }), undefined, next);

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
