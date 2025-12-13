import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { RouteRegistry } from "./registry.ts";
import type { Handler, HandlerContext } from "./types.ts";
import { HandlerPriority as HP } from "../../core/types/server.ts";

describe("RouteRegistry", () => {
  let registry: RouteRegistry;

  beforeEach(() => {
    registry = new RouteRegistry();
  });

  describe("constructor", () => {
    it("should create registry with default config", () => {
      const reg = new RouteRegistry();
      assertExists(reg);
    });

    it("should create registry with custom config", () => {
      const reg = new RouteRegistry({ debug: true, enableMetrics: false });
      assertExists(reg);
    });
  });

  describe("register", () => {
    it("should register a handler", () => {
      const handler: Handler = {
        metadata: { name: "test", priority: HP.MEDIUM },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler);
      assertEquals(registry.getHandlers().length, 1);
    });

    it("should return this for chaining", () => {
      const handler: Handler = {
        metadata: { name: "test", priority: HP.MEDIUM },
        handle: async () => ({ response: undefined, continue: true }),
      };

      const result = registry.register(handler);
      assertEquals(result, registry);
    });

    it("should sort handlers by priority ascending", () => {
      const handler1: Handler = {
        metadata: { name: "high", priority: HP.HIGH },
        handle: async () => ({ response: undefined, continue: true }),
      };
      const handler2: Handler = {
        metadata: { name: "low", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };
      const handler3: Handler = {
        metadata: { name: "medium", priority: HP.MEDIUM },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler1);
      registry.register(handler2);
      registry.register(handler3);

      const handlers = registry.getHandlers();
      // Priorities: HP.CRITICAL = 0, HP.HIGH = 100, HP.MEDIUM = 500
      // handler1 = "high" (100), handler2 = "low" (0), handler3 = "medium" (500)
      // Sorted ascending: low (0), high (100), medium (500)
      assertEquals(handlers[0]?.metadata.name, "low");
      assertEquals(handlers[1]?.metadata.name, "high");
      assertEquals(handlers[2]?.metadata.name, "medium");
    });
  });

  describe("registerAll", () => {
    it("should register multiple handlers", () => {
      const handlers: Handler[] = [
        {
          metadata: { name: "test1", priority: HP.CRITICAL },
          handle: async () => ({ response: undefined, continue: true }),
        },
        {
          metadata: { name: "test2", priority: HP.CRITICAL + 10 },
          handle: async () => ({ response: undefined, continue: true }),
        },
      ];

      registry.registerAll(handlers);
      assertEquals(registry.getHandlers().length, 2);
    });

    it("should return this for chaining", () => {
      const handlers: Handler[] = [];
      const result = registry.registerAll(handlers);
      assertEquals(result, registry);
    });
  });

  describe("execute", () => {
    it("should execute handlers in priority order", async () => {
      const order: string[] = [];

      const handler1: Handler = {
        metadata: { name: "first", priority: HP.CRITICAL },
        handle: async () => {
          order.push("first");
          return { response: undefined, continue: true };
        },
      };
      const handler2: Handler = {
        metadata: { name: "second", priority: HP.CRITICAL + 1 },
        handle: async () => {
          order.push("second");
          return { response: undefined, continue: true };
        },
      };

      registry.register(handler2);
      registry.register(handler1);

      const req = new Request("https://example.com/test");
      const ctx = {} as HandlerContext;

      await registry.execute(req, ctx);

      assertEquals(order, ["first", "second"]);
    });

    it("should return response from first matching handler", async () => {
      const response = new Response("test");

      const handler1: Handler = {
        metadata: { name: "matcher", priority: HP.CRITICAL },
        handle: async () => ({ response, continue: false }),
      };
      const handler2: Handler = {
        metadata: { name: "never", priority: HP.CRITICAL + 1 },
        handle: async () => ({ response: new Response("wrong"), continue: false }),
      };

      registry.register(handler1);
      registry.register(handler2);

      const req = new Request("https://example.com/test");
      const ctx = {} as HandlerContext;

      const result = await registry.execute(req, ctx);
      assertEquals(result, response);
    });

    it("should return null when no handler matches", async () => {
      const handler: Handler = {
        metadata: { name: "test", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler);

      const req = new Request("https://example.com/test");
      const ctx = {} as HandlerContext;

      const result = await registry.execute(req, ctx);
      assertEquals(result, null);
    });

    it("should stop chain when continue is false", async () => {
      let secondCalled = false;

      const handler1: Handler = {
        metadata: { name: "stopper", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: false }),
      };
      const handler2: Handler = {
        metadata: { name: "never", priority: HP.CRITICAL + 1 },
        handle: async () => {
          secondCalled = true;
          return { response: undefined, continue: true };
        },
      };

      registry.register(handler1);
      registry.register(handler2);

      const req = new Request("https://example.com/test");
      const ctx = {} as HandlerContext;

      await registry.execute(req, ctx);

      assertEquals(secondCalled, false);
    });

    it("should skip disabled handlers", async () => {
      let disabledCalled = false;

      const handler: Handler = {
        metadata: {
          name: "disabled",
          priority: HP.CRITICAL,
          enabled: () => false,
        },
        handle: async () => {
          disabledCalled = true;
          return { response: undefined, continue: true };
        },
      };

      registry.register(handler);

      const req = new Request("https://example.com/test");
      const ctx = {} as HandlerContext;

      await registry.execute(req, ctx);

      assertEquals(disabledCalled, false);
    });

    it("should continue after handler error", async () => {
      let secondCalled = false;

      const handler1: Handler = {
        metadata: { name: "error", priority: HP.CRITICAL },
        handle: async () => {
          throw new Error("test error");
        },
      };
      const handler2: Handler = {
        metadata: { name: "ok", priority: HP.CRITICAL + 1 },
        handle: async () => {
          secondCalled = true;
          return { response: undefined, continue: true };
        },
      };

      registry.register(handler1);
      registry.register(handler2);

      const req = new Request("https://example.com/test");
      const ctx = {} as HandlerContext;

      await registry.execute(req, ctx);

      assertEquals(secondCalled, true);
    });
  });

  describe("getHandlers", () => {
    it("should return readonly array of handlers", () => {
      const handler: Handler = {
        metadata: { name: "test", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler);
      const handlers = registry.getHandlers();

      assertEquals(handlers.length, 1);
      assertEquals(handlers[0]?.metadata.name, "test");
    });

    it("should return empty array when no handlers", () => {
      const handlers = registry.getHandlers();
      assertEquals(handlers.length, 0);
    });
  });

  describe("clear", () => {
    it("should remove all handlers", () => {
      const handler: Handler = {
        metadata: { name: "test", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler);
      assertEquals(registry.getHandlers().length, 1);

      registry.clear();
      assertEquals(registry.getHandlers().length, 0);
    });

    it("should return this for chaining", () => {
      const result = registry.clear();
      assertEquals(result, registry);
    });
  });

  describe("remove", () => {
    it("should remove handler by name", () => {
      const handler1: Handler = {
        metadata: { name: "test1", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };
      const handler2: Handler = {
        metadata: { name: "test2", priority: HP.CRITICAL + 1 },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler1);
      registry.register(handler2);
      assertEquals(registry.getHandlers().length, 2);

      registry.remove("test1");
      assertEquals(registry.getHandlers().length, 1);
      assertEquals(registry.getHandlers()[0]?.metadata.name, "test2");
    });

    it("should return this for chaining", () => {
      const result = registry.remove("nonexistent");
      assertEquals(result, registry);
    });

    it("should do nothing when handler not found", () => {
      const handler: Handler = {
        metadata: { name: "test", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler);
      registry.remove("nonexistent");
      assertEquals(registry.getHandlers().length, 1);
    });
  });

  describe("has", () => {
    it("should return true when handler exists", () => {
      const handler: Handler = {
        metadata: { name: "test", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler);
      assertEquals(registry.has("test"), true);
    });

    it("should return false when handler does not exist", () => {
      assertEquals(registry.has("nonexistent"), false);
    });
  });

  describe("getStats", () => {
    it("should return empty stats for empty registry", () => {
      const stats = registry.getStats();

      assertEquals(stats.totalHandlers, 0);
      assertEquals(stats.handlerNames.length, 0);
      assertEquals(Object.keys(stats.handlersByPriority).length, 0);
    });

    it("should return correct total handlers", () => {
      const handler1: Handler = {
        metadata: { name: "test1", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };
      const handler2: Handler = {
        metadata: { name: "test2", priority: HP.CRITICAL + 1 },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler1);
      registry.register(handler2);

      const stats = registry.getStats();
      assertEquals(stats.totalHandlers, 2);
    });

    it("should return handler names", () => {
      const handler1: Handler = {
        metadata: { name: "test1", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };
      const handler2: Handler = {
        metadata: { name: "test2", priority: HP.CRITICAL + 1 },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler1);
      registry.register(handler2);

      const stats = registry.getStats();
      assertEquals(stats.handlerNames.includes("test1"), true);
      assertEquals(stats.handlerNames.includes("test2"), true);
    });

    it("should group handlers by priority", () => {
      const handler1: Handler = {
        metadata: { name: "test1", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };
      const handler2: Handler = {
        metadata: { name: "test2", priority: HP.CRITICAL },
        handle: async () => ({ response: undefined, continue: true }),
      };
      const handler3: Handler = {
        metadata: { name: "test3", priority: HP.CRITICAL + 1 },
        handle: async () => ({ response: undefined, continue: true }),
      };

      registry.register(handler1);
      registry.register(handler2);
      registry.register(handler3);

      const stats = registry.getStats();
      assertEquals(stats.handlersByPriority["0"], 2); // HP.CRITICAL = 0
      assertEquals(stats.handlersByPriority["1"], 1); // HP.CRITICAL + 1 = 1
    });
  });
});
