import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import { MemoryDebugHandler } from "./memory.handler.ts";

function createHandler(): MemoryDebugHandler {
  return new MemoryDebugHandler();
}

const localCtx = { securityConfig: undefined, isLocalProject: true } as unknown as HandlerContext;
const remoteCtx = { securityConfig: undefined, isLocalProject: false } as unknown as HandlerContext;

function createAuthenticatedLocalContext(token: string): HandlerContext {
  return {
    isLocalProject: true,
    securityConfig: { auth: { bearer: { token } } },
    adapter: {
      env: { get: () => undefined },
    },
  } as unknown as HandlerContext;
}

function createOperatorRequest(): Request {
  return new Request("http://localhost/_debug/memory/gc", {
    method: "POST",
    headers: { authorization: "Bearer operator-token" },
  });
}

describe("server/handlers/monitoring/memory-debug", () => {
  describe("MemoryDebugHandler metadata", () => {
    it("should have correct handler name", () => {
      const handler = createHandler();
      assertEquals(handler.metadata.name, "MemoryDebugHandler");
    });

    it("should match /_debug/memory prefix", () => {
      const handler = createHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns.length, 1);

      const pattern = handler.metadata.patterns[0];
      assertExists(pattern);
      assertEquals(typeof pattern !== "string" && pattern.pattern, "/_debug/memory");
      assertEquals(typeof pattern !== "string" && pattern.prefix, true);
    });

    it("should only be enabled for local projects", () => {
      const handler = createHandler();
      const enabledFn = handler.metadata.enabled;
      assertEquals(typeof enabledFn, "function");

      if (typeof enabledFn !== "function") return;

      assertEquals(enabledFn({ isLocalProject: false } as unknown as HandlerContext), false);
      assertEquals(enabledFn({ isLocalProject: true } as unknown as HandlerContext), true);
      assertEquals(enabledFn({} as unknown as HandlerContext), false);
    });
  });

  describe("MemoryDebugHandler.handle", () => {
    it("should return continue for remote projects", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory");
      const result = await handler.handle(req, remoteCtx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("should return continue for non-matching pathname", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/other-path");
      const result = await handler.handle(req, localCtx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("should return memory snapshot for local projects", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 200);
    });

    it("should return heap stats for /heap sub-path", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory/heap");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const body = await result.response.json();
      assertExists(body.heap);
    });

    it("should return cache stats for /caches sub-path", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory/caches");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const body = await result.response.json();
      assertExists(body.caches);
    });

    it("rejects non-POST methods for the GC trigger", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory/gc");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 405);
      assertEquals(result.response.headers.get("allow"), "POST");
    });

    it("requires configured operator authentication for the GC trigger", async () => {
      const handler = createHandler();
      const result = await handler.handle(
        new Request("http://localhost/_debug/memory/gc", { method: "POST" }),
        localCtx,
      );

      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });

    it("rejects invalid operator credentials for the GC trigger", async () => {
      const handler = createHandler();
      const result = await handler.handle(
        new Request("http://localhost/_debug/memory/gc", {
          method: "POST",
          headers: { authorization: "Bearer wrong-token" },
        }),
        createAuthenticatedLocalContext("operator-token"),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });

    it("delegates GC operator authentication through the injected auth handler", async () => {
      let authCalls = 0;
      const handler = new MemoryDebugHandler({
        authHandler: {
          handle: () => {
            authCalls++;
            return Promise.resolve({
              continue: false,
              response: new Response("operator forbidden", { status: 403 }),
            });
          },
        },
      });
      const result = await handler.handle(
        createOperatorRequest(),
        createAuthenticatedLocalContext("operator-token"),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 403);
      assertEquals(authCalls, 1);
    });

    it("shares one process-wide forced-GC operation across handler instances", async () => {
      const originalGc = Object.getOwnPropertyDescriptor(globalThis, "gc");
      let gcRuns = 0;
      Object.defineProperty(globalThis, "gc", {
        configurable: true,
        value: () => gcRuns++,
      });
      const context = createAuthenticatedLocalContext("operator-token");
      const left = createHandler();
      const right = createHandler();

      try {
        const first = left.handle(createOperatorRequest(), context);
        const second = right.handle(createOperatorRequest(), context);
        await Promise.resolve();
        await Promise.resolve();
        assertEquals(gcRuns, 1);

        const [firstResult, secondResult] = await Promise.all([first, second]);
        assertExists(firstResult.response);
        assertExists(secondResult.response);
        assertEquals(firstResult.response.status, 200);
        assertEquals(secondResult.response.status, 200);
        assertEquals(await firstResult.response.json(), await secondResult.response.json());
      } finally {
        if (originalGc) Object.defineProperty(globalThis, "gc", originalGc);
        else Reflect.deleteProperty(globalThis, "gc");
      }
    });

    it("accepts an authenticated POST for the GC trigger", async () => {
      const handler = new MemoryDebugHandler({
        forceGC: () => Promise.resolve(false),
        settle: () => Promise.resolve(),
        now: () => 1_000,
      });
      const result = await handler.handle(
        new Request("http://localhost/_debug/memory/gc", {
          method: "POST",
          headers: { authorization: "Bearer operator-token" },
        }),
        createAuthenticatedLocalContext("operator-token"),
      );

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const body = await result.response.json();
      assertEquals(typeof body.gcTriggered, "boolean");
      assertExists(body.before);
      assertExists(body.after);
    });

    it("shares one forced-GC operation across concurrent authenticated requests", async () => {
      let resolveGC!: (value: boolean) => void;
      const gcResult = new Promise<boolean>((resolve) => {
        resolveGC = resolve;
      });
      let gcRuns = 0;
      const handler = new MemoryDebugHandler({
        forceGC: () => {
          gcRuns++;
          return gcResult;
        },
        settle: () => Promise.resolve(),
        now: () => 1_000,
      });
      const context = createAuthenticatedLocalContext("operator-token");

      const first = handler.handle(createOperatorRequest(), context);
      const second = handler.handle(createOperatorRequest(), context);
      await Promise.resolve();
      assertEquals(gcRuns, 1);

      resolveGC(true);
      const [firstResult, secondResult] = await Promise.all([first, second]);
      assertExists(firstResult.response);
      assertExists(secondResult.response);
      assertEquals(firstResult.response.status, 200);
      assertEquals(secondResult.response.status, 200);
      assertEquals(await firstResult.response.json(), await secondResult.response.json());
    });

    it("rate limits new forced-GC operations with bounded global state", async () => {
      let now = 10_000;
      let gcRuns = 0;
      const handler = new MemoryDebugHandler({
        forceGC: () => {
          gcRuns++;
          return Promise.resolve(true);
        },
        settle: () => Promise.resolve(),
        now: () => now,
      });
      const context = createAuthenticatedLocalContext("operator-token");

      const first = await handler.handle(createOperatorRequest(), context);
      assertExists(first.response);
      assertEquals(first.response.status, 200);

      now += 1_000;
      const limited = await handler.handle(createOperatorRequest(), context);
      assertExists(limited.response);
      assertEquals(limited.response.status, 429);
      assertEquals(limited.response.headers.get("retry-after"), "59");

      now += 59_000;
      const afterWindow = await handler.handle(createOperatorRequest(), context);
      assertExists(afterWindow.response);
      assertEquals(afterWindow.response.status, 200);
      assertEquals(gcRuns, 2);
    });

    it("should return pressure check for /pressure sub-path", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory/pressure");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const body = await result.response.json();
      assertExists(body.recommendations);
    });
  });
});
