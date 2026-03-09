import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isProductionMode, SSRHandler } from "./ssr.handler.ts";
import type { HandlerContext } from "../../types.ts";

describe("server/handlers/request/ssr/ssr.handler", () => {
  describe("SSRHandler metadata", () => {
    it("should have correct handler name", () => {
      const handler = new SSRHandler();
      assertEquals(handler.metadata.name, "SSRHandler");
    });

    it("should have patterns defined", () => {
      const handler = new SSRHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns!.length > 0, true);
    });

    it("should accept GET and HEAD methods", () => {
      const handler = new SSRHandler();
      const patterns = handler.metadata.patterns;
      assertExists(patterns);
      const first = patterns[0];
      assertEquals(typeof first !== "string", true);
      if (typeof first !== "string") {
        const method = (first as { method?: string | string[] }).method;
        assertEquals(Array.isArray(method), true);
        if (Array.isArray(method)) {
          assertEquals(method.includes("GET"), true);
          assertEquals(method.includes("HEAD"), true);
        }
      }
    });
  });

  describe("isProductionMode", () => {
    it("should return true when config has productionMode enabled", () => {
      const ctx = {
        config: { fs: { veryfront: { productionMode: true } } },
      } as unknown as HandlerContext;
      assertEquals(isProductionMode(ctx), true);
    });

    it("should return true when resolvedEnvironment is 'production'", () => {
      const ctx = {
        resolvedEnvironment: "production",
      } as HandlerContext;
      assertEquals(isProductionMode(ctx), true);
    });

    it("should return false when resolvedEnvironment is 'preview'", () => {
      const ctx = {
        resolvedEnvironment: "preview",
      } as HandlerContext;
      assertEquals(isProductionMode(ctx), false);
    });

    it("should fallback to requestContext.mode when no resolvedEnvironment", () => {
      const ctx = {
        requestContext: { token: "", slug: "", branch: null, mode: "production" as const },
      } as HandlerContext;
      assertEquals(isProductionMode(ctx), true);
    });

    it("should return false when requestContext.mode is preview", () => {
      const ctx = {
        requestContext: { token: "", slug: "", branch: null, mode: "preview" as const },
      } as HandlerContext;
      assertEquals(isProductionMode(ctx), false);
    });

    it("should return false when no environment info is available", () => {
      const ctx = {} as HandlerContext;
      assertEquals(isProductionMode(ctx), false);
    });

    it("should prefer config override over resolvedEnvironment", () => {
      const ctx = {
        config: { fs: { veryfront: { productionMode: true } } },
        resolvedEnvironment: "preview",
      } as unknown as HandlerContext;
      assertEquals(isProductionMode(ctx), true);
    });

    it("should prefer resolvedEnvironment over requestContext.mode", () => {
      const ctx = {
        resolvedEnvironment: "production",
        requestContext: { token: "", slug: "", branch: null, mode: "preview" as const },
      } as HandlerContext;
      assertEquals(isProductionMode(ctx), true);
    });
  });
});
