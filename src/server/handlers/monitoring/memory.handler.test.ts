import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { registerCache, unregisterCache } from "#veryfront/utils/memory/index.ts";
import type { HandlerContext } from "../types.ts";
import { MemoryDebugHandler } from "./memory.handler.ts";

function createHandler(): MemoryDebugHandler {
  return new MemoryDebugHandler();
}

const localCtx = { securityConfig: undefined, isLocalProject: true } as unknown as HandlerContext;
const remoteCtx = { securityConfig: undefined, isLocalProject: false } as unknown as HandlerContext;
const PRIVATE_CACHE_NAME = "memory-handler-private-cache";

describe("server/handlers/monitoring/memory-debug", () => {
  afterEach(() => {
    unregisterCache(PRIVATE_CACHE_NAME);
  });

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

    it("should not claim a path that only shares the memory prefix", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory-private");
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
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
    });

    it("should reject a non-loopback requester for a local project", async () => {
      const handler = createHandler();
      const req = new Request("http://devbox.example/_debug/memory");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 401);
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
    });

    it("should reject a cross-origin browser requester", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory", {
        headers: { origin: "https://attacker.example" },
      });
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 401);
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

    it("should omit cache-specific values from memory responses", async () => {
      registerCache(PRIVATE_CACHE_NAME, () => ({
        name: PRIVATE_CACHE_NAME,
        entries: 1,
        maxEntries: 10,
        projectPath: "private-source/customer-project.ts",
        privateValue: "private-cache-value",
      }));
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory/caches");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      const body = await result.response.json();
      const cache = body.caches.find((entry: { name: string }) =>
        entry.name === PRIVATE_CACHE_NAME
      );
      assertEquals(cache, {
        name: PRIVATE_CACHE_NAME,
        entries: 1,
        maxEntries: 10,
      });
      assertEquals(JSON.stringify(body).includes("private-source"), false);
      assertEquals(JSON.stringify(body).includes("private-cache-value"), false);
    });

    it("should reject mutations on read-only memory endpoints", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory/heap", { method: "POST" });
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 405);
      assertEquals(result.response.headers.get("allow"), "GET");
    });

    it("should reject GC mutation over GET", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory/gc");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 405);
      assertEquals(result.response.headers.get("allow"), "POST");
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
    });

    it("should handle GC trigger over POST", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_debug/memory/gc", { method: "POST" });
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const body = await result.response.json();
      assertEquals(typeof body.gcTriggered, "boolean");
      assertExists(body.before);
      assertExists(body.after);
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
