import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import type { APIRouteHandler } from "#veryfront/routing";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import { ApiHandlerWrapper } from "./api-handler-wrapper.ts";
import { __injectCacheForTests, type HandlerCache, resetApiHandler } from "./pages-api-handler.ts";

function createCtx(captured: { options?: Record<string, unknown> }): HandlerContext {
  return {
    projectDir: "/tmp/project",
    adapter: {
      fs: {
        isMultiProjectMode: () => true,
        isVeryfrontAdapter: () => true,
        getUnderlyingAdapter: () => ({}),
        runWithContext: async (
          _slug: string,
          _token: string,
          _fn: () => Promise<unknown>,
          _projectId?: string,
          options?: Record<string, unknown>,
        ) => {
          captured.options = options;
          return { continue: true };
        },
      },
      env: { get: () => undefined },
    },
    securityConfig: null,
    cspUserHeader: null,
    projectSlug: "my-project",
    projectId: "project-123",
    proxyToken: "vf_proxy_token",
    releaseId: "release-123",
    environmentName: "Staging",
    requestContext: {
      token: "vf_proxy_token",
      branch: "feature-branch",
      mode: "production",
    },
  } as unknown as HandlerContext;
}

function injectApiResponse(
  response: Response | null,
  capture?: { handleOptions?: unknown },
): void {
  const handler = {
    handle: (_req: Request, _ctx: HandlerContext, options?: unknown) => {
      if (capture) capture.handleOptions = options;
      return Promise.resolve(response);
    },
    destroy: () => {},
  } as unknown as APIRouteHandler;
  injectApiHandlerPromise(Promise.resolve(handler));
}

function injectApiHandlerPromise(promise: Promise<APIRouteHandler>): void {
  const store = new Map<string, Promise<APIRouteHandler>>([
    ["/tmp/project", promise],
  ]);
  const cache: HandlerCache<Promise<APIRouteHandler>> = {
    get: (key) => store.get(key),
    set: (key, value) => store.set(key, value),
    delete: (key) => store.delete(key),
    clear: () => store.clear(),
    entries: () => store.entries(),
    values: () => store.values(),
  };
  __injectCacheForTests(cache);
}

function createResponseCtx(
  isLocalProject: boolean,
  securityConfig: HandlerContext["securityConfig"],
): HandlerContext {
  return {
    projectDir: "/tmp/project",
    adapter: createMockAdapter(),
    config: {},
    securityConfig,
    cspUserHeader: null,
    isLocalProject,
    requestContext: {
      token: "",
      slug: "test-project",
      mode: isLocalProject ? "preview" : "production",
      branch: "main",
    },
  } as HandlerContext;
}

function projectPolicyOverrideHeaders(): Headers {
  return new Headers({
    "access-control-allow-origin": "https://attacker.example",
    "access-control-allow-credentials": "true",
    "access-control-expose-headers": "x-attacker-secret",
    "content-security-policy": "default-src *",
    "cross-origin-resource-policy": "cross-origin",
    "referrer-policy": "unsafe-url",
    "strict-transport-security": "max-age=0",
    "x-content-type-options": "off",
    "x-frame-options": "SAMEORIGIN",
    "x-project-header": "preserved",
  });
}

afterEach(async () => {
  await resetApiHandler();
  __injectCacheForTests(null);
});

describe("ApiHandlerWrapper", () => {
  it("does not run host project discovery for a remote route when worker flags are disabled", async () => {
    const previousMaster = Deno.env.get("WORKER_ISOLATION_ENABLED");
    const previousApi = Deno.env.get("WORKER_ISOLATION_API");
    Deno.env.delete("WORKER_ISOLATION_ENABLED");
    Deno.env.delete("WORKER_ISOLATION_API");
    __resetPoolForTests();

    const ctx = createResponseCtx(false, null);
    let fsExistsCalls = 0;
    ctx.adapter.fs.exists = () => {
      fsExistsCalls++;
      return Promise.resolve(false);
    };
    injectApiResponse(new Response("project"));

    try {
      const result = await new ApiHandlerWrapper(ctx.projectDir, ctx.adapter).handle(
        new Request("https://project.example/api/data"),
        ctx,
      );

      assertEquals(result.response?.status, 200);
      assertEquals(fsExistsCalls, 0);
    } finally {
      __resetPoolForTests();
      if (previousMaster === undefined) Deno.env.delete("WORKER_ISOLATION_ENABLED");
      else Deno.env.set("WORKER_ISOLATION_ENABLED", previousMaster);
      if (previousApi === undefined) Deno.env.delete("WORKER_ISOLATION_API");
      else Deno.env.set("WORKER_ISOLATION_API", previousApi);
    }
  });

  it("runs host discovery for an approved standalone source without local-development mode", async () => {
    const previousMaster = Deno.env.get("WORKER_ISOLATION_ENABLED");
    const previousApi = Deno.env.get("WORKER_ISOLATION_API");
    Deno.env.delete("WORKER_ISOLATION_ENABLED");
    Deno.env.delete("WORKER_ISOLATION_API");
    __resetPoolForTests();

    const ctx = createResponseCtx(false, null);
    ctx.allowHostProjectCodeExecution = true;
    let fsExistsCalls = 0;
    ctx.adapter.fs.exists = () => {
      fsExistsCalls++;
      return Promise.resolve(false);
    };
    injectApiResponse(new Response("project"));

    try {
      const result = await new ApiHandlerWrapper(ctx.projectDir, ctx.adapter).handle(
        new Request("https://project.example/api/data"),
        ctx,
      );

      assertEquals(result.response?.status, 200);
      assertEquals(fsExistsCalls > 0, true);
      assertEquals(ctx.isLocalProject, false);
    } finally {
      __resetPoolForTests();
      if (previousMaster === undefined) Deno.env.delete("WORKER_ISOLATION_ENABLED");
      else Deno.env.set("WORKER_ISOLATION_ENABLED", previousMaster);
      if (previousApi === undefined) Deno.env.delete("WORKER_ISOLATION_API");
      else Deno.env.set("WORKER_ISOLATION_API", previousApi);
    }
  });

  it("does not trust inherited, accessor, or throwing locality for host discovery", async () => {
    const previousMaster = Deno.env.get("WORKER_ISOLATION_ENABLED");
    const previousApi = Deno.env.get("WORKER_ISOLATION_API");
    const previousPrototypeLocality = Object.getOwnPropertyDescriptor(
      Object.prototype,
      "isLocalProject",
    );
    Deno.env.delete("WORKER_ISOLATION_ENABLED");
    Deno.env.delete("WORKER_ISOLATION_API");
    __resetPoolForTests();
    injectApiResponse(new Response("project"));
    let fsExistsCalls = 0;
    let accessorCalls = 0;
    let hostCapabilityAccessorCalls = 0;
    let throwingDescriptorCalls = 0;

    const makeRemoteCtx = (): HandlerContext => {
      const ctx = createResponseCtx(false, null);
      delete (ctx as { isLocalProject?: boolean }).isLocalProject;
      ctx.adapter.fs.exists = () => {
        fsExistsCalls++;
        return Promise.resolve(false);
      };
      return ctx;
    };
    const inherited = makeRemoteCtx();
    Object.setPrototypeOf(inherited, { isLocalProject: true });
    const accessor = Object.defineProperty(
      makeRemoteCtx(),
      "isLocalProject",
      {
        get() {
          accessorCalls++;
          return true;
        },
      },
    );
    const inheritedHostCapability = makeRemoteCtx();
    Object.setPrototypeOf(inheritedHostCapability, {
      allowHostProjectCodeExecution: true,
    });
    const hostCapabilityAccessor = Object.defineProperty(
      makeRemoteCtx(),
      "allowHostProjectCodeExecution",
      {
        get() {
          hostCapabilityAccessorCalls++;
          return true;
        },
      },
    );
    const throwingProxy = new Proxy(makeRemoteCtx(), {
      getOwnPropertyDescriptor(target, key) {
        if (key === "isLocalProject") {
          throwingDescriptorCalls++;
          throw new Error("locality descriptor unavailable");
        }
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    try {
      for (
        const ctx of [
          inherited,
          accessor,
          inheritedHostCapability,
          hostCapabilityAccessor,
          throwingProxy,
        ]
      ) {
        const result = await new ApiHandlerWrapper(ctx.projectDir, ctx.adapter).handle(
          new Request("https://project.example/api/data"),
          ctx,
        );
        assertEquals(result.response?.status, 200);
      }

      const poisoned = makeRemoteCtx();
      Object.defineProperty(Object.prototype, "isLocalProject", {
        configurable: true,
        value: true,
      });
      const result = await new ApiHandlerWrapper(
        poisoned.projectDir,
        poisoned.adapter,
      ).handle(
        new Request("https://project.example/api/data"),
        poisoned,
      );
      assertEquals(result.response?.status, 200);
    } finally {
      if (previousPrototypeLocality) {
        Object.defineProperty(
          Object.prototype,
          "isLocalProject",
          previousPrototypeLocality,
        );
      } else {
        delete (Object.prototype as { isLocalProject?: boolean }).isLocalProject;
      }
      __resetPoolForTests();
      if (previousMaster === undefined) Deno.env.delete("WORKER_ISOLATION_ENABLED");
      else Deno.env.set("WORKER_ISOLATION_ENABLED", previousMaster);
      if (previousApi === undefined) Deno.env.delete("WORKER_ISOLATION_API");
      else Deno.env.set("WORKER_ISOLATION_API", previousApi);
    }

    assertEquals(fsExistsCalls, 0);
    assertEquals(accessorCalls, 0);
    assertEquals(hostCapabilityAccessorCalls, 0);
    assertEquals(throwingDescriptorCalls > 0, true);
  });

  it("routes known pages without remote stat misses or full API discovery", async () => {
    let enteredProjectContext = false;
    let remoteStatMisses = 0;
    let primitiveDiscoveryChecks = 0;
    let apiRouteChecks = 0;
    let sourceSnapshotRefreshes = 0;
    let pageReads = 0;
    const ctx = createCtx({});
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      exists: (path: string) => Promise<boolean>;
      stat: (path: string) => Promise<unknown>;
      readDir: (path: string) => AsyncIterable<{
        name: string;
        isFile: boolean;
        isDirectory: boolean;
        isSymlink: boolean;
      }>;
      resolveFile: (path: string) => Promise<string | null>;
      readFile: (path: string) => Promise<string>;
      refreshSourceSnapshot: (reason?: string) => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => {
      enteredProjectContext = true;
      return await fn();
    };
    fs.exists = (path) => {
      if (path.endsWith("/pages/api") || path.endsWith("/app")) {
        apiRouteChecks++;
      } else {
        primitiveDiscoveryChecks++;
      }
      return Promise.resolve(false);
    };
    fs.stat = () => {
      remoteStatMisses++;
      return Promise.reject(new Error("File not found"));
    };
    fs.readDir = async function* (path) {
      if (path === "/tmp/project") {
        yield { name: "pages", isFile: false, isDirectory: true, isSymlink: false };
      } else if (path === "/tmp/project/pages") {
        yield { name: "index.tsx", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "review.tsx", isFile: true, isDirectory: false, isSymlink: false };
      }
    };
    fs.resolveFile = (path) =>
      Promise.resolve(
        path === "/tmp/project/pages/review" ? "/tmp/project/pages/review.tsx" : null,
      );
    fs.readFile = (path) => {
      if (path === "/tmp/project/pages/review.tsx" || path === "pages/review.tsx") {
        pageReads++;
        return Promise.resolve("export default function Review() { return null; }");
      }
      return Promise.reject(new Error("File not found"));
    };
    fs.refreshSourceSnapshot = () => {
      sourceSnapshotRefreshes++;
      return Promise.resolve();
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/review"), ctx);

    assertEquals(result, { continue: true });
    assertEquals(enteredProjectContext, true);
    assertEquals(remoteStatMisses, 0);
    assertEquals(pageReads, 1);
    assertEquals(primitiveDiscoveryChecks, 0);
    assertEquals(apiRouteChecks, 0);
    assertEquals(sourceSnapshotRefreshes, 0);
  });

  it("checks preview source freshness before resolving page ownership", async () => {
    const events: string[] = [];
    const ctx = createCtx({});
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    ctx.config = { router: "pages" };
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      ensureSourceSnapshotFresh: (reason?: string) => Promise<void>;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
      resolveFile: (path: string) => Promise<string | null>;
      readFile: (path: string) => Promise<string>;
      refreshSourceSnapshot: (reason?: string) => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => await fn();
    fs.ensureSourceSnapshotFresh = () => {
      events.push("source-fresh");
      return Promise.resolve();
    };
    fs.exists = () => Promise.resolve(false);
    fs.readDir = async function* () {};
    fs.resolveFile = (path) => {
      events.push("resolve-page");
      return Promise.resolve(
        path === "/tmp/project/pages/review" ? "/tmp/project/pages/review.tsx" : null,
      );
    };
    fs.readFile = (path) => {
      if (path === "pages/review.tsx" || path === "/tmp/project/pages/review.tsx") {
        return Promise.resolve("export default function Review() { return null; }");
      }
      return Promise.reject(new Error("File not found"));
    };
    fs.refreshSourceSnapshot = () => {
      events.push("full-refresh");
      return Promise.resolve();
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/review"), ctx);

    assertEquals(result, { continue: true });
    assertEquals(events.slice(0, 2), ["source-fresh", "resolve-page"]);
    assertEquals(events.includes("full-refresh"), false);
  });

  it("preserves fresh API discovery when no page owns a non-API path", async () => {
    let sourceSnapshotRefreshes = 0;
    const ctx = createCtx({});
    ctx.projectSlug = "unmatched-preview-project";
    ctx.config = { router: "pages" };
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
      resolveFile: (path: string) => Promise<string | null>;
      readFile: (path: string) => Promise<string>;
      refreshSourceSnapshot: (reason?: string) => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => await fn();
    fs.exists = () => Promise.resolve(false);
    fs.readDir = async function* () {};
    fs.resolveFile = () => Promise.resolve(null);
    fs.readFile = () => Promise.reject(new Error("File not found"));
    fs.refreshSourceSnapshot = () => {
      sourceSnapshotRefreshes++;
      return Promise.resolve();
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/new-webhook"), ctx);

    assertEquals(result, { continue: true });
    assertEquals(sourceSnapshotRefreshes, 1);
  });

  it("keeps the exact /api path in the API handler flow", async () => {
    let sourceSnapshotRefreshes = 0;
    const ctx = createCtx({});
    ctx.projectSlug = "exact-api-preview-project";
    ctx.config = { router: "pages" };
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    const fs = ctx.adapter.fs as unknown as {
      runWithContext: (
        slug: string,
        token: string,
        fn: () => Promise<unknown>,
      ) => Promise<unknown>;
      exists: (path: string) => Promise<boolean>;
      readDir: (path: string) => AsyncIterable<never>;
      readFile: (path: string) => Promise<string>;
      refreshSourceSnapshot: (reason?: string) => Promise<void>;
    };
    fs.runWithContext = async (_slug, _token, fn) => await fn();
    fs.exists = () => Promise.resolve(false);
    fs.readDir = async function* () {};
    fs.readFile = () => Promise.reject(new Error("File not found"));
    fs.refreshSourceSnapshot = () => {
      sourceSnapshotRefreshes++;
      return Promise.resolve();
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/api"), ctx);

    assertEquals(result.response?.status, 404);
    assertEquals(sourceSnapshotRefreshes, 1);
  });

  it("forwards environmentName into multi-project request context", async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const handler = new ApiHandlerWrapper("/tmp/project", createCtx(captured).adapter);

    await handler.handle(new Request("http://localhost/api/test"), createCtx(captured));

    assertEquals(captured.options?.environmentName, "Staging");
  });

  it("forwards preview branch into multi-project request context", async () => {
    const captured: { options?: Record<string, unknown> } = {};
    const ctx = createCtx(captured);
    ctx.requestContext!.mode = "preview";
    ctx.releaseId = undefined;
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    await handler.handle(new Request("http://localhost/api/test"), ctx);

    assertEquals(captured.options?.branch, "feature-branch");
  });

  it("applies hosted CORS and security policy after allowed project response headers", async () => {
    injectApiResponse(
      new Response("project", {
        status: 201,
        headers: projectPolicyOverrideHeaders(),
      }),
    );
    const ctx = createResponseCtx(false, {
      cors: {
        origin: "https://allowed.example",
        credentials: false,
        exposedHeaders: ["x-public"],
      },
      csp: { "default-src": ["'none'"] },
    });
    const handler = new ApiHandlerWrapper(ctx.projectDir, ctx.adapter);

    const result = await handler.handle(
      new Request("https://project.example/api/data", {
        headers: { origin: "https://allowed.example" },
      }),
      ctx,
    );

    const response = result.response!;
    assertEquals(response.status, 201);
    assertEquals(await response.text(), "project");
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      "https://allowed.example",
    );
    assertEquals(response.headers.get("access-control-allow-credentials"), null);
    assertEquals(response.headers.get("access-control-expose-headers"), "x-public");
    assertEquals(response.headers.get("content-security-policy"), "default-src 'none'");
    assertEquals(response.headers.get("strict-transport-security")?.startsWith("max-age="), true);
    assertEquals(response.headers.get("x-frame-options"), "DENY");
    assertEquals(response.headers.get("cross-origin-resource-policy"), "same-origin");
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    assertEquals(
      response.headers.get("referrer-policy"),
      "strict-origin-when-cross-origin",
    );
    assertEquals(response.headers.get("x-project-header"), "preserved");
  });

  it("does not let project headers bypass a hosted CORS denial", async () => {
    injectApiResponse(
      new Response("project", {
        headers: projectPolicyOverrideHeaders(),
      }),
    );
    const ctx = createResponseCtx(false, {
      cors: {
        origin: "https://allowed.example",
        credentials: true,
        exposedHeaders: ["x-public"],
      },
    });
    const handler = new ApiHandlerWrapper(ctx.projectDir, ctx.adapter);

    const result = await handler.handle(
      new Request("https://project.example/api/data", {
        headers: { origin: "https://denied.example" },
      }),
      ctx,
    );

    const headers = result.response!.headers;
    assertEquals(headers.get("access-control-allow-origin"), null);
    assertEquals(headers.get("access-control-allow-credentials"), null);
    assertEquals(headers.get("access-control-expose-headers"), null);
    assertEquals(headers.get("x-project-header"), "preserved");
  });

  it("keeps local policy-owned omissions authoritative over project headers", async () => {
    injectApiResponse(
      new Response("project", {
        headers: projectPolicyOverrideHeaders(),
      }),
    );
    const ctx = createResponseCtx(true, { cors: false });
    const handler = new ApiHandlerWrapper(ctx.projectDir, ctx.adapter);

    const result = await handler.handle(
      new Request("http://localhost/api/data", {
        headers: { origin: "https://attacker.example" },
      }),
      ctx,
    );

    const headers = result.response!.headers;
    assertEquals(headers.get("access-control-allow-origin"), null);
    assertEquals(headers.get("access-control-allow-credentials"), null);
    assertEquals(headers.get("access-control-expose-headers"), null);
    assertEquals(headers.get("content-security-policy"), null);
    assertEquals(headers.get("strict-transport-security"), null);
    assertEquals(headers.get("x-frame-options"), null);
    assertEquals(headers.get("cross-origin-resource-policy"), "same-origin");
    assertEquals(headers.get("x-content-type-options"), "nosniff");
    assertEquals(headers.get("x-project-header"), "preserved");
  });

  it("merges route headers before security and one asynchronous CORS pass", async () => {
    const capture: { handleOptions?: unknown } = {};
    injectApiResponse(
      new Response("project", {
        status: 202,
        headers: projectPolicyOverrideHeaders(),
      }),
      capture,
    );
    let originValidationCount = 0;
    const securityConfig = {
      cors: {
        origin: async (origin: string) => {
          originValidationCount++;
          await Promise.resolve();
          return origin === "https://allowed.example";
        },
      },
      csp: { "default-src": ["'none'"] },
    } as unknown as HandlerContext["securityConfig"];
    const ctx = createResponseCtx(false, securityConfig);
    const handler = new ApiHandlerWrapper(ctx.projectDir, ctx.adapter);

    const result = await handler.handle(
      new Request("https://project.example/api/data", {
        headers: { origin: "https://allowed.example" },
      }),
      ctx,
    );

    const response = result.response!;
    assertEquals(response.status, 202);
    assertEquals(originValidationCount, 1);
    assertEquals(capture.handleOptions, { applyCORS: false });
    assertEquals(
      response.headers.get("access-control-allow-origin"),
      "https://allowed.example",
    );
    assertEquals(response.headers.get("content-security-policy"), "default-src 'none'");
    assertEquals(response.headers.get("x-project-header"), "preserved");
  });

  it("rejects Response.error as a non-HTTP response before wrapper serialization", async () => {
    injectApiResponse(Response.error());
    const ctx = createResponseCtx(false, null);
    const handler = new ApiHandlerWrapper(ctx.projectDir, ctx.adapter);

    const result = await handler.handle(
      new Request("https://project.example/api/error"),
      ctx,
    );

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 500);
  });

  it("returns a sanitized terminal response when API handler initialization fails", async () => {
    injectApiHandlerPromise(
      Promise.reject(new Error("secret initialization path /private/project/config.ts")),
    );
    const ctx = createResponseCtx(false, null);
    const handler = new ApiHandlerWrapper(ctx.projectDir, ctx.adapter);

    const result = await handler.handle(
      new Request("https://project.example/api/data"),
      ctx,
    );

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 503);
    const body = await result.response?.text();
    assertEquals(body?.includes("secret initialization path"), false);
    assertEquals(body?.includes("/private/project"), false);
  });

  it("returns a sanitized terminal response when an owned API path resolves to null", async () => {
    injectApiResponse(null);
    const ctx = createResponseCtx(false, null);
    const handler = new ApiHandlerWrapper(ctx.projectDir, ctx.adapter);

    const result = await handler.handle(
      new Request("https://project.example/api/data"),
      ctx,
    );

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 503);
    assertEquals((await result.response?.text())?.includes(ctx.projectDir), false);
  });

  it("fails CORS closed when the centralized origin validator throws", async () => {
    injectApiResponse(new Response("project"));
    const ctx = createResponseCtx(false, {
      cors: {
        origin: () => {
          throw new Error("secret CORS evaluator detail");
        },
      },
    });
    const handler = new ApiHandlerWrapper(ctx.projectDir, ctx.adapter);

    const result = await handler.handle(
      new Request("https://project.example/api/data", {
        headers: { origin: "https://request.example" },
      }),
      ctx,
    );

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 200);
    assertEquals(result.response?.headers.get("access-control-allow-origin"), null);
    assertEquals(result.response?.headers.get("access-control-allow-credentials"), null);
    assertEquals((await result.response?.text())?.includes("secret CORS"), false);
  });

  it("does not fall through when centralized API security policy throws", async () => {
    injectApiResponse(new Response("project"));
    const csp = {};
    Object.defineProperty(csp, "default-src", {
      enumerable: true,
      get() {
        throw new Error("secret security evaluator detail");
      },
    });
    const ctx = createResponseCtx(false, {
      csp: csp as Record<string, string[]>,
    });
    const handler = new ApiHandlerWrapper(ctx.projectDir, ctx.adapter);

    const result = await handler.handle(
      new Request("https://project.example/api/data"),
      ctx,
    );

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 503);
    assertEquals((await result.response?.text())?.includes("secret security"), false);
  });
});
