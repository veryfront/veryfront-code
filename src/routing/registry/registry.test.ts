import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { RouteRegistry } from "./registry.ts";
import type { Handler, HandlerContext, HandlerResult } from "./types.ts";

function makeHandler(
  name: string,
  priority: number,
  result: HandlerResult = { continue: true },
  enabled?: (ctx: HandlerContext) => boolean,
): Handler {
  return {
    metadata: { name, priority, enabled },
    handle: () => Promise.resolve(result),
  };
}

function makeCtx(): HandlerContext {
  return {
    projectDir: "/tmp/test",
    adapter: {} as HandlerContext["adapter"],
    securityConfig: null,
    cspUserHeader: null,
  };
}

function makeReq(): Request {
  return new Request("http://localhost/test");
}

describe("routing/registry/RouteRegistry", () => {
  describe("register()", () => {
    it("should register a handler", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("test", 100));
      assertEquals(registry.has("test"), true);
    });

    it("should sort handlers by priority after registration", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("low", 1000));
      registry.register(makeHandler("high", 100));
      registry.register(makeHandler("medium", 500));

      const names = registry.getHandlers().map((h) => h.metadata.name);
      assertEquals(names, ["high", "medium", "low"]);
    });

    it("should return this for chaining", () => {
      const registry = new RouteRegistry();
      const result = registry.register(makeHandler("test", 100));
      assertEquals(result, registry);
    });
  });

  describe("registerAll()", () => {
    it("should register multiple handlers", () => {
      const registry = new RouteRegistry();
      registry.registerAll([
        makeHandler("a", 100),
        makeHandler("b", 200),
        makeHandler("c", 300),
      ]);
      assertEquals(registry.getHandlers().length, 3);
    });

    it("should sort all handlers by priority", () => {
      const registry = new RouteRegistry();
      registry.registerAll([
        makeHandler("c", 300),
        makeHandler("a", 100),
        makeHandler("b", 200),
      ]);
      const names = registry.getHandlers().map((h) => h.metadata.name);
      assertEquals(names, ["a", "b", "c"]);
    });
  });

  describe("execute()", () => {
    it("should return response from first matching handler", async () => {
      const registry = new RouteRegistry();
      registry.register(
        makeHandler("responder", 100, {
          response: new Response("ok", { status: 200 }),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result?.status, 200);
    });

    it("should skip handlers that return continue: true", async () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("pass-through", 100, { continue: true }));
      registry.register(
        makeHandler("responder", 200, {
          response: new Response("found", { status: 200 }),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result?.status, 200);
      assertEquals(await result?.text(), "found");
    });

    it("should return null when no handler matches", async () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("pass", 100, { continue: true }));

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result, null);
    });

    it("should stop chain when handler returns continue: false without response", async () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("stopper", 100, { continue: false }));
      registry.register(
        makeHandler("never-reached", 200, {
          response: new Response("should not see"),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result, null);
    });

    it("should skip disabled handlers", async () => {
      const registry = new RouteRegistry();
      registry.register(
        makeHandler(
          "disabled",
          100,
          { response: new Response("disabled") },
          () => false,
        ),
      );
      registry.register(
        makeHandler("enabled", 200, {
          response: new Response("enabled"),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(await result?.text(), "enabled");
    });

    it("should continue on handler errors", async () => {
      const registry = new RouteRegistry();
      const errorHandler: Handler = {
        metadata: { name: "erroring", priority: 100 },
        handle: () => Promise.reject(new Error("handler error")),
      };

      registry.register(errorHandler);
      registry.register(
        makeHandler("fallback", 200, {
          response: new Response("fallback", { status: 200 }),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result?.status, 200);
      assertEquals(await result?.text(), "fallback");
    });

    it("should return null on empty registry", async () => {
      const registry = new RouteRegistry();
      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result, null);
    });
  });

  describe("getHandlers()", () => {
    it("should return all registered handlers", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 200));
      assertEquals(registry.getHandlers().length, 2);
    });

    it("should return empty array when no handlers registered", () => {
      const registry = new RouteRegistry();
      assertEquals(registry.getHandlers().length, 0);
    });
  });

  describe("clear()", () => {
    it("should remove all handlers", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 200));
      registry.clear();
      assertEquals(registry.getHandlers().length, 0);
    });

    it("should return this for chaining", () => {
      const registry = new RouteRegistry();
      const result = registry.clear();
      assertEquals(result, registry);
    });
  });

  describe("remove()", () => {
    it("should remove handler by name", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 200));
      registry.remove("a");
      assertEquals(registry.has("a"), false);
      assertEquals(registry.has("b"), true);
    });

    it("should return this for chaining", () => {
      const registry = new RouteRegistry();
      const result = registry.remove("nonexistent");
      assertEquals(result, registry);
    });
  });

  describe("has()", () => {
    it("should return true for existing handler", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("test", 100));
      assertEquals(registry.has("test"), true);
    });

    it("should return false for non-existing handler", () => {
      const registry = new RouteRegistry();
      assertEquals(registry.has("nonexistent"), false);
    });
  });

  describe("getStats()", () => {
    it("should return correct statistics", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 100));
      registry.register(makeHandler("c", 500));

      const stats = registry.getStats();
      assertEquals(stats.totalHandlers, 3);
      assertEquals(stats.handlerNames, ["a", "b", "c"]);
      assertEquals(stats.handlersByPriority["100"], 2);
      assertEquals(stats.handlersByPriority["500"], 1);
    });

    it("should return empty stats for empty registry", () => {
      const registry = new RouteRegistry();
      const stats = registry.getStats();
      assertEquals(stats.totalHandlers, 0);
      assertEquals(stats.handlerNames, []);
      assertEquals(stats.handlersByPriority, {});
    });
  });
});
