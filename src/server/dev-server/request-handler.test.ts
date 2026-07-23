import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  type RuntimeAdapter,
  type RuntimeRequestHandler,
} from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import {
  getErrorCollector,
  getLogBuffer,
  resetErrorCollector,
  resetLogBuffer,
} from "#veryfront/observability";
import {
  __destroyRSCHandlerForTests,
  __injectCacheForTests,
  getRSCHandler,
  type HandlerCache,
} from "#veryfront/server/services/rsc/endpoints/handler-registry.ts";
import type { RSCDevServerHandler } from "#veryfront/server/services/rsc/orchestrators/index.ts";
import {
  __injectCacheForTests as __injectApiCacheForTests,
  type HandlerCache as ApiHandlerCache,
  resetApiHandler,
} from "../handlers/request/api/pages-api-handler.ts";
import { RequestHandler } from "./request-handler.ts";

function createHandlerCache(): HandlerCache<RSCDevServerHandler> {
  const entries = new Map<string, RSCDevServerHandler>();
  return {
    get: (key) => entries.get(key),
    set: (key, value) => entries.set(key, value),
    delete: (key) => entries.delete(key),
    clear: () => entries.clear(),
    keys: () => entries.keys(),
    get size() {
      return entries.size;
    },
  };
}

describe("server/dev-server/request-handler", () => {
  afterEach(async () => {
    __destroyRSCHandlerForTests();
    await resetApiHandler();
    __injectApiCacheForTests(null);
    __resetLogRecordEmitterForTests();
    __resetLoggerConfigForTests();
    resetErrorCollector();
    resetLogBuffer();
  });

  it("restricts health endpoints to GET and HEAD with private security headers", async () => {
    const handler = new RequestHandler(
      "/project/a",
      createMockAdapter(),
      () => true,
      () => false,
    );

    const post = await handler.handleRequest(
      new Request("http://localhost/healthz", { method: "POST" }),
    );
    assertEquals(post instanceof Response, true);
    assertEquals(post.status, 405);
    assertEquals(post.headers.get("allow"), "GET, HEAD");
    assertEquals(post.headers.get("cache-control"), "no-store");
    assertEquals(post.headers.get("x-content-type-options"), "nosniff");

    const head = await handler.handleRequest(
      new Request("http://localhost/readyz", { method: "HEAD" }),
    );
    assertEquals(head instanceof Response, true);
    assertEquals(head.status, 200);
    assertEquals(await (head as Response).text(), "");
    assertEquals(head.headers.get("cache-control"), "no-store");
  });

  it("restricts the error-overlay asset to GET and HEAD", async () => {
    const handler = new RequestHandler(
      "/project/a",
      createMockAdapter(),
      () => true,
      () => false,
    );

    const response = await handler.handleRequest(
      new Request("http://localhost/_veryfront/error-overlay.js", { method: "POST" }),
    );

    assertEquals(response instanceof Response, true);
    assertEquals(response.status, 405);
    assertEquals(response.headers.get("allow"), "GET, HEAD");
    assertEquals(response.headers.get("cache-control"), "no-store");
  });

  it("turns non-Error throws into a stable private 500 response", async () => {
    const handler = new RequestHandler(
      "/project/a",
      createMockAdapter(),
      () => true,
      () => false,
    );
    (handler as unknown as { runtimeHandler: RuntimeRequestHandler }).runtimeHandler = () => {
      throw "private-thrown-value-canary";
    };

    const response = await handler.handleRequest(new Request("http://localhost/page"));

    assertEquals(response instanceof Response, true);
    assertEquals(response.status, 500);
    assertEquals(response.headers.get("cache-control"), "no-store");
    assertEquals(response.headers.get("x-content-type-options"), "nosniff");
    assertEquals((await (response as Response).text()).includes("Unknown runtime error"), true);
    assertEquals(getErrorCollector().getAll()[0]?.message, "Unknown runtime error");
  });

  it("omits request paths and error details from logs", async () => {
    const entries: LogEntry[] = [];
    const previousLogLevel = Deno.env.get("LOG_LEVEL");
    Deno.env.set("LOG_LEVEL", "DEBUG");
    __resetLoggerConfigForTests();
    __registerLogRecordEmitter((entry) => entries.push(entry));
    const handler = new RequestHandler(
      "/project/a",
      createMockAdapter(),
      () => true,
      () => false,
    );
    (handler as unknown as { runtimeHandler: RuntimeRequestHandler }).runtimeHandler = () => {
      throw new Error("private-runtime-error-canary");
    };

    try {
      await handler.handleRequest(
        new Request("http://localhost/private-request-path-canary"),
      );

      const serializedLogs = JSON.stringify({
        entries,
        buffered: getLogBuffer().getAll(),
      });
      assertEquals(serializedLogs.includes("private-request-path-canary"), false);
      assertEquals(serializedLogs.includes("private-runtime-error-canary"), false);
    } finally {
      if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
      else Deno.env.set("LOG_LEVEL", previousLogLevel);
      __resetLoggerConfigForTests();
    }
  });

  it("creates one runtime handler for concurrent first requests", async () => {
    let factoryCalls = 0;
    const handler = new RequestHandler(
      "/project/a",
      createMockAdapter(),
      () => true,
      () => false,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        factoryCalls++;
        await Promise.resolve();
        return () => new Response("factory-response");
      },
    );

    const [first, second] = await Promise.all([
      handler.handleRequest(new Request("http://localhost/first")),
      handler.handleRequest(new Request("http://localhost/second")),
    ]);

    assertEquals(factoryCalls, 1);
    assertEquals(await (first as Response).text(), "factory-response");
    assertEquals(await (second as Response).text(), "factory-response");
  });

  it("awaits asynchronous API-handler destruction during invalidation", async () => {
    const deferred = Promise.withResolvers<{
      destroy(): void;
    }>();
    const entries = new Map<string, Promise<{ destroy(): void }>>([
      ["/project/a", deferred.promise],
    ]);
    const cache: ApiHandlerCache<Promise<{ destroy(): void }>> = {
      get: (key) => entries.get(key),
      set: (key, value) => entries.set(key, value),
      delete: (key) => entries.delete(key),
      clear: () => entries.clear(),
      entries: () => entries.entries(),
      values: () => entries.values(),
    };
    __injectApiCacheForTests(cache as never);
    const handler = new RequestHandler(
      "/project/a",
      createMockAdapter(),
      () => true,
      () => false,
    );

    const invalidation = handler.invalidateRuntimeHandler();
    let settled = false;
    Promise.resolve(invalidation).then(() => {
      settled = true;
    });
    await Promise.resolve();
    const settledBeforeDestroy = settled;
    deferred.resolve({ destroy() {} });
    await Promise.resolve(invalidation);

    assertEquals(settledBeforeDestroy, false);
    assertEquals(settled, true);
  });

  it("invalidates the project RSC handler during file-change invalidation", () => {
    __injectCacheForTests(createHandlerCache());
    const handlerOptions = {
      mode: "development" as const,
      config: { react: { version: "19.1.1" } },
    };
    const before = getRSCHandler("/project/a", "project-a", handlerOptions);
    const requestHandler = new RequestHandler(
      "/project/a",
      {} as RuntimeAdapter,
      () => true,
      () => false,
      undefined,
      undefined,
      "project-a",
    );

    void requestHandler.invalidateRuntimeHandler();

    const after = getRSCHandler("/project/a", "project-a", handlerOptions);
    assertEquals(after !== before, true);
  });
});
