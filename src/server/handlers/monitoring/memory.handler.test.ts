import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryDebugHandler } from "./memory.handler.ts";

function createHandler(): MemoryDebugHandler {
  return new MemoryDebugHandler();
}

const localCtx = { securityConfig: undefined, isLocalProject: true } as never;
const remoteCtx = { securityConfig: undefined, isLocalProject: false } as never;

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

      assertEquals(enabledFn({ isLocalProject: false } as never), false);
      assertEquals(enabledFn({ isLocalProject: true } as never), true);
      assertEquals(enabledFn({} as never), false);
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
