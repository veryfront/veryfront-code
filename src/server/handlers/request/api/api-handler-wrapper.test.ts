import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import type { APIRouteHandler } from "#veryfront/routing";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { ApiHandlerWrapper } from "./api-handler-wrapper.ts";
import { __injectCacheForTests, type HandlerCache, resetApiHandler } from "./pages-api-handler.ts";

function createCtx(captured: { options?: Record<string, unknown> }): HandlerContext {
  return {
    projectDir: "/tmp/project",
    adapter: {
      fs: {
        isMultiProjectMode: () => true,
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
