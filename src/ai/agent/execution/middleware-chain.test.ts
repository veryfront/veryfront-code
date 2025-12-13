import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  MiddlewareChain,
  createMiddlewareChain,
  type AgentMiddleware,
} from "./middleware-chain.ts";
import type { AgentContext, AgentResponse } from "../../types/agent.ts";

describe("MiddlewareChain", () => {
  const mockContext: AgentContext = {
    agentId: "test-agent",
    model: "test-model",
    input: "test input",
    platform: "node",
  };

  const mockResponse: AgentResponse = {
    text: "response",
    messages: [],
    toolCalls: [],
    status: "completed",
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  };

  describe("execute", () => {
    it("should execute final handler when no middleware", async () => {
      const chain = new MiddlewareChain();
      let called = false;

      const finalHandler = async () => {
        called = true;
        return mockResponse;
      };

      const result = await chain.execute(mockContext, finalHandler);

      assert(called);
      assertEquals(result, mockResponse);
    });

    it("should execute middleware in order", async () => {
      const executionOrder: number[] = [];

      const middleware1: AgentMiddleware = async (_context, next) => {
        executionOrder.push(1);
        const result = await next();
        executionOrder.push(4);
        return result;
      };

      const middleware2: AgentMiddleware = async (_context, next) => {
        executionOrder.push(2);
        const result = await next();
        executionOrder.push(3);
        return result;
      };

      const chain = new MiddlewareChain([middleware1, middleware2]);

      await chain.execute(mockContext, async () => mockResponse);

      assertEquals(executionOrder, [1, 2, 3, 4]);
    });

    it("should pass context through middleware", async () => {
      const capturedContexts: AgentContext[] = [];

      const middleware: AgentMiddleware = async (context, next) => {
        capturedContexts.push(context);
        return await next();
      };

      const chain = new MiddlewareChain([middleware]);

      await chain.execute(mockContext, async () => mockResponse);

      assertEquals(capturedContexts.length, 1);
      assertEquals(capturedContexts[0], mockContext);
    });

    it("should allow middleware to modify response", async () => {
      const middleware: AgentMiddleware = async (_context, next) => {
        const result = await next();
        return {
          ...result,
          text: "Modified: " + result.text,
        };
      };

      const chain = new MiddlewareChain([middleware]);

      const result = await chain.execute(mockContext, async () => mockResponse);

      assertEquals(result.text, "Modified: response");
    });

    it("should allow middleware to short-circuit", async () => {
      let finalHandlerCalled = false;

      const shortCircuitMiddleware: AgentMiddleware = async () => {
        return {
          text: "short-circuited",
          messages: [],
          toolCalls: [],
          status: "completed",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        };
      };

      const chain = new MiddlewareChain([shortCircuitMiddleware]);

      const result = await chain.execute(mockContext, async () => {
        finalHandlerCalled = true;
        return mockResponse;
      });

      assert(!finalHandlerCalled);
      assertEquals(result.text, "short-circuited");
    });
  });

  describe("use", () => {
    it("should add middleware to the chain", () => {
      const chain = new MiddlewareChain();
      const middleware: AgentMiddleware = async (_context, next) => await next();

      chain.use(middleware);

      assertEquals(chain.length, 1);
    });

    it("should return chain for chaining", () => {
      const chain = new MiddlewareChain();
      const middleware: AgentMiddleware = async (_context, next) => await next();

      const result = chain.use(middleware);

      assertEquals(result, chain);
    });

    it("should add multiple middleware via chaining", () => {
      const chain = new MiddlewareChain();
      const mw1: AgentMiddleware = async (_context, next) => await next();
      const mw2: AgentMiddleware = async (_context, next) => await next();

      chain.use(mw1).use(mw2);

      assertEquals(chain.length, 2);
    });
  });

  describe("prepend", () => {
    it("should add middleware to the beginning", async () => {
      const executionOrder: string[] = [];

      const mw1: AgentMiddleware = async (_context, next) => {
        executionOrder.push("first");
        return await next();
      };

      const mw2: AgentMiddleware = async (_context, next) => {
        executionOrder.push("prepended");
        return await next();
      };

      const chain = new MiddlewareChain([mw1]);
      chain.prepend(mw2);

      await chain.execute(mockContext, async () => mockResponse);

      assertEquals(executionOrder[0], "prepended");
      assertEquals(executionOrder[1], "first");
    });

    it("should return chain for chaining", () => {
      const chain = new MiddlewareChain();
      const middleware: AgentMiddleware = async (_context, next) => await next();

      const result = chain.prepend(middleware);

      assertEquals(result, chain);
    });
  });

  describe("length", () => {
    it("should return 0 for empty chain", () => {
      const chain = new MiddlewareChain();
      assertEquals(chain.length, 0);
    });

    it("should return correct count", () => {
      const mw: AgentMiddleware = async (_context, next) => await next();
      const chain = new MiddlewareChain([mw, mw, mw]);
      assertEquals(chain.length, 3);
    });
  });

  describe("isEmpty", () => {
    it("should return true for empty chain", () => {
      const chain = new MiddlewareChain();
      assert(chain.isEmpty());
    });

    it("should return false for non-empty chain", () => {
      const mw: AgentMiddleware = async (_context, next) => await next();
      const chain = new MiddlewareChain([mw]);
      assert(!chain.isEmpty());
    });
  });

  describe("createMiddlewareChain", () => {
    it("should create empty chain without argument", () => {
      const chain = createMiddlewareChain();
      assert(chain.isEmpty());
    });

    it("should create chain with initial middleware", () => {
      const mw: AgentMiddleware = async (_context, next) => await next();
      const chain = createMiddlewareChain([mw]);
      assertEquals(chain.length, 1);
    });
  });
});
