import "#veryfront/schemas/_test-setup.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "#veryfront/types";
import { __injectProjectDiscoveryForTests, ApiHandlerWrapper } from "./api-handler-wrapper.ts";
import { __injectCacheForTests, type HandlerCache, resetApiHandler } from "./pages-api-handler.ts";
import { getPagesApiHandlerCacheKey } from "./pages-api-cache.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

afterEach(async () => {
  await resetApiHandler();
  __injectCacheForTests(null);
  __injectProjectDiscoveryForTests(undefined);
  __resetLogRecordEmitterForTests();
});

function createCtx(
  captured: { options?: Record<string, unknown>; token?: string },
): HandlerContext {
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
          captured.token = _token;
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

function getTestCacheKey(ctx: HandlerContext): string {
  const key = getPagesApiHandlerCacheKey(ctx);
  assertExists(key);
  return key;
}

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

  it("fails closed when multi-project context has no request token", async () => {
    const captured: { options?: Record<string, unknown>; token?: string } = {};
    const ctx = createCtx(captured);
    ctx.proxyToken = undefined;
    delete (ctx.requestContext as { token?: string }).token;
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/api/test"), ctx);

    assertEquals(result.response?.status, 500);
    assertEquals(captured.token, undefined);
  });

  it("returns a private failure when multi-project capability detection throws", async () => {
    const privateCanary = "private-multi-project-capability-canary";
    const ctx = createCtx({});
    const fs = ctx.adapter.fs as typeof ctx.adapter.fs & { isMultiProjectMode(): boolean };
    fs.isMultiProjectMode = () => {
      throw new Error(privateCanary);
    };
    const handler = new ApiHandlerWrapper("/tmp/project", ctx.adapter);

    const result = await handler.handle(new Request("http://localhost/api/test"), ctx);

    assertEquals(result.response?.status, 500);
    assertEquals((await result.response!.text()).includes(privateCanary), false);
  });

  it("returns a sanitized 500 when API execution throws", async () => {
    const entries: LogEntry[] = [];
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const adapter = createMockAdapter();
    const apiHandler = {
      handle: () => Promise.reject(new Error("private-api-failure-canary")),
      destroy: () => {},
    };
    const ctx = {
      projectDir: "/project",
      adapter,
      securityConfig: null,
      cspUserHeader: null,
      resolvedEnvironment: "preview",
      debug: true,
    } as unknown as HandlerContext;
    const store = new Map<string, Promise<typeof apiHandler>>([
      [getTestCacheKey(ctx), Promise.resolve(apiHandler)],
    ]);
    const cache: HandlerCache<Promise<typeof apiHandler>> = {
      get: (key) => store.get(key),
      set: (key, value) => store.set(key, value),
      delete: (key) => store.delete(key),
      clear: () => store.clear(),
      entries: () => store.entries(),
      values: () => store.values(),
    };
    type InjectableApiCache = NonNullable<Parameters<typeof __injectCacheForTests>[0]>;
    __injectCacheForTests(cache as unknown as InjectableApiCache);

    const result = await new ApiHandlerWrapper(ctx.projectDir, adapter).handle(
      new Request("https://runtime.example.com/api/PRIVATE_ROUTE_MARKER"),
      ctx,
    );

    assertEquals(result.continue, false);
    assertEquals(result.response?.status, 500);
    assertEquals((await result.response!.text()).includes("private-api-failure-canary"), false);
    assertEquals(result.response?.headers.get("cache-control")?.includes("no-store"), true);
    assertEquals(JSON.stringify(entries).includes("PRIVATE_ROUTE_MARKER"), false);
  });

  it("keeps framework policy headers authoritative and preserves route headers", async () => {
    const adapter = createMockAdapter();
    const routeHeaders = new Headers({
      "Access-Control-Allow-Origin": "*",
      "Content-Security-Policy": "default-src *",
      "X-Custom": "route-value",
    });
    routeHeaders.append("Set-Cookie", "first=1; Path=/; HttpOnly");
    routeHeaders.append("Set-Cookie", "second=2; Path=/; Secure");

    const apiHandler = {
      handle: () => Promise.resolve(new Response("ok", { headers: routeHeaders })),
      destroy: () => {},
    };
    const ctx = {
      projectDir: "/project",
      adapter,
      securityConfig: {
        cors: { origin: "https://app.example.com" },
        csp: { "default-src": "'self'" },
      },
      cspUserHeader: null,
      resolvedEnvironment: "preview",
    } as unknown as HandlerContext;
    const store = new Map<string, Promise<typeof apiHandler>>([
      [getTestCacheKey(ctx), Promise.resolve(apiHandler)],
    ]);
    const cache: HandlerCache<Promise<typeof apiHandler>> = {
      get: (key) => store.get(key),
      set: (key, value) => store.set(key, value),
      delete: (key) => store.delete(key),
      clear: () => store.clear(),
      entries: () => store.entries(),
      values: () => store.values(),
    };
    type InjectableApiCache = NonNullable<Parameters<typeof __injectCacheForTests>[0]>;
    __injectCacheForTests(cache as unknown as InjectableApiCache);

    const handler = new ApiHandlerWrapper(ctx.projectDir, adapter);
    const result = await handler.handle(
      new Request("https://runtime.example.com/api/test", {
        headers: { Origin: "https://app.example.com" },
      }),
      ctx,
    );

    assertEquals(
      result.response?.headers.get("Access-Control-Allow-Origin"),
      "https://app.example.com",
    );
    assertEquals(result.response?.headers.get("Content-Security-Policy"), "default-src 'self'");
    assertEquals(result.response?.headers.get("X-Custom"), "route-value");
    assertEquals(result.response?.headers.getSetCookie(), [
      "first=1; Path=/; HttpOnly",
      "second=2; Path=/; Secure",
    ]);
  });

  it("does not run primitive discovery for an explicitly remote project", async () => {
    const adapter = createMockAdapter();
    const apiHandler = {
      handle: () => Promise.resolve(new Response("isolated")),
      destroy: () => {},
    };
    let discoveryCalls = 0;
    __injectProjectDiscoveryForTests(() => {
      discoveryCalls++;
      return Promise.reject(new Error("remote discovery must not execute"));
    });
    const ctx = {
      projectDir: "/project",
      adapter,
      config: { title: "Trusted host" },
      securityConfig: null,
      cspUserHeader: null,
      resolvedEnvironment: "production",
      releaseId: "release-1",
      projectSlug: "remote-project",
      isLocalProject: false,
    } as unknown as HandlerContext;
    const store = new Map<string, Promise<typeof apiHandler>>([
      [getTestCacheKey(ctx), Promise.resolve(apiHandler)],
    ]);
    const cache: HandlerCache<Promise<typeof apiHandler>> = {
      get: (key) => store.get(key),
      set: (key, value) => store.set(key, value),
      delete: (key) => store.delete(key),
      clear: () => store.clear(),
      entries: () => store.entries(),
      values: () => store.values(),
    };
    type InjectableApiCache = NonNullable<Parameters<typeof __injectCacheForTests>[0]>;
    __injectCacheForTests(cache as unknown as InjectableApiCache);

    const result = await new ApiHandlerWrapper(ctx.projectDir, adapter).handle(
      new Request("https://runtime.example.com/api/test"),
      ctx,
    );

    assertEquals(discoveryCalls, 0);
    assertEquals(result.response?.status, 200);
    assertEquals(await result.response?.text(), "isolated");
  });
});
