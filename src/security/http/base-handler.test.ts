import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { BaseHandler } from "./base-handler.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "@veryfront/types";

// Create a concrete implementation for testing
class TestHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "TestHandler",
    priority: 50 as HandlerPriority,
    patterns: [],
  };

  async handle(_req: Request, _ctx: HandlerContext): Promise<HandlerResult> {
    return this.continue();
  }
}

class PatternTestHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "PatternTestHandler",
    priority: 50 as HandlerPriority,
    patterns: [
      { pattern: "/api", prefix: true },
      { pattern: "/exact", exact: true },
      { pattern: /^\/regex\/.*/ },
      { pattern: "/method-test", method: "POST" },
    ],
  };

  async handle(_req: Request, _ctx: HandlerContext): Promise<HandlerResult> {
    return this.continue();
  }
}

// Mock adapter and context
const createMockAdapter = (envVars: Record<string, string> = {}) => ({
  env: {
    get: (key: string) => envVars[key] || null,
  },
}) as unknown as HandlerContext["adapter"];

const createMockContext = (opts: {
  envVars?: Record<string, string>;
  debug?: boolean;
  mode?: "development" | "production";
} = {}): HandlerContext => ({
  adapter: createMockAdapter(opts.envVars || {}),
  mode: opts.mode || "production",
  debug: opts.debug || false,
  projectDir: "/test",
  securityConfig: null,
  cspUserHeader: null,
});

describe("BaseHandler", () => {
  it("should create handler with metadata", () => {
    const handler = new TestHandler();
    assertExists(handler.metadata);
    assertEquals(handler.metadata.name, "TestHandler");
    assertEquals(handler.metadata.priority, 50);
  });

  it("should provide continue method", () => {
    const handler = new TestHandler();
    const result = (handler as unknown as { continue: () => HandlerResult }).continue();
    assertEquals(result.continue, true);
  });

  it("should provide respond method", () => {
    const handler = new TestHandler();
    const response = new Response("test");
    const result = (handler as unknown as { respond: (r: Response) => HandlerResult }).respond(
      response,
    );
    assertEquals(result.continue, false);
    assertEquals(result.response, response);
  });

  it("should provide respond method with metadata", () => {
    const handler = new TestHandler();
    const response = new Response("test");
    const metadata = { custom: "data" };
    const result = (handler as unknown as {
      respond: (r: Response, m?: Record<string, unknown>) => HandlerResult;
    }).respond(response, metadata);
    assertEquals(result.continue, false);
    assertEquals(result.response, response);
    assertEquals(result.metadata, metadata);
  });

  describe("shouldHandle", () => {
    it("should return true when no patterns are defined", () => {
      const handler = new TestHandler();
      const request = new Request("https://example.com/anything");
      const ctx = createMockContext();
      const shouldHandle = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, ctx);
      assertEquals(shouldHandle, true);
    });

    it("should match prefix pattern", () => {
      const handler = new PatternTestHandler();
      const request = new Request("https://example.com/api/users");
      const ctx = createMockContext();
      const shouldHandle = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, ctx);
      assertEquals(shouldHandle, true);
    });

    it("should not match non-prefix", () => {
      const handler = new PatternTestHandler();
      const request = new Request("https://example.com/notapi");
      const ctx = createMockContext();
      const shouldHandle = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, ctx);
      assertEquals(shouldHandle, false);
    });

    it("should match exact pattern", () => {
      const handler = new PatternTestHandler();
      const request = new Request("https://example.com/exact");
      const ctx = createMockContext();
      const shouldHandle = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, ctx);
      assertEquals(shouldHandle, true);
    });

    it("should not match exact pattern with suffix", () => {
      const handler = new PatternTestHandler();
      const request = new Request("https://example.com/exact/more");
      const ctx = createMockContext();
      const shouldHandle = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, ctx);
      assertEquals(shouldHandle, false);
    });

    it("should match regex pattern", () => {
      const handler = new PatternTestHandler();
      const request = new Request("https://example.com/regex/test");
      const ctx = createMockContext();
      const shouldHandle = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, ctx);
      assertEquals(shouldHandle, true);
    });

    it("should match method-specific pattern", () => {
      const handler = new PatternTestHandler();
      const request = new Request("https://example.com/method-test", { method: "POST" });
      const ctx = createMockContext();
      const shouldHandle = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, ctx);
      assertEquals(shouldHandle, true);
    });

    it("should not match wrong method", () => {
      const handler = new PatternTestHandler();
      const request = new Request("https://example.com/method-test", { method: "GET" });
      const ctx = createMockContext();
      const shouldHandle = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, ctx);
      assertEquals(shouldHandle, false);
    });
  });

  describe("utility methods", () => {
    it("should extract error message from Error object", () => {
      const handler = new TestHandler();
      const error = new Error("Test error");
      const message = (handler as unknown as {
        getErrorMessage: (e: unknown) => string;
      }).getErrorMessage(error);
      assertEquals(message, "Test error");
    });

    it("should convert unknown error to string", () => {
      const handler = new TestHandler();
      const message = (handler as unknown as {
        getErrorMessage: (e: unknown) => string;
      }).getErrorMessage("string error");
      assertEquals(message, "string error");
    });

    it("should create response builder", () => {
      const handler = new TestHandler();
      const ctx = createMockContext();
      const builder = (handler as unknown as {
        createResponseBuilder: (ctx: HandlerContext) => unknown;
      }).createResponseBuilder(ctx);
      assertExists(builder);
    });
  });

  describe("conditional handling", () => {
    it("should respect enabled condition", () => {
      class ConditionalHandler extends BaseHandler {
        metadata: HandlerMetadata = {
          name: "ConditionalHandler",
          priority: 50 as HandlerPriority,
          patterns: [],
          enabled: (ctx: HandlerContext) => ctx.mode === "development",
        };

        async handle(_req: Request, _ctx: HandlerContext): Promise<HandlerResult> {
          return this.continue();
        }
      }

      const handler = new ConditionalHandler();
      const request = new Request("https://example.com/test");
      const devCtx = createMockContext({ mode: "development" });
      const prodCtx = createMockContext({ mode: "production" });

      const shouldHandleDev = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, devCtx);
      const shouldHandleProd = (handler as unknown as {
        shouldHandle: (req: Request, ctx: HandlerContext) => boolean;
      }).shouldHandle(request, prodCtx);

      assertEquals(shouldHandleDev, true);
      assertEquals(shouldHandleProd, false);
    });
  });
});
