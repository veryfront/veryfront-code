import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { AuthHandler } from "./auth.ts";
import type { HandlerContext } from "@veryfront/types";

// Mock adapter for testing
const createMockAdapter = (env: Record<string, string> = {}) => ({
  env: {
    get: (key: string) => env[key] || null,
  },
}) as unknown as HandlerContext["adapter"];

const createMockContext = (envVars: Record<string, string> = {}): HandlerContext => ({
  adapter: createMockAdapter(envVars),
  mode: "production" as const,
  debug: false,
  projectDir: "/test",
  securityConfig: null,
  cspUserHeader: null,
});

describe("AuthHandler", () => {
  let handler: AuthHandler;

  beforeEach(() => {
    handler = new AuthHandler();
  });

  it("should have correct metadata", () => {
    assertExists(handler.metadata);
    assertEquals(handler.metadata.name, "AuthHandler");
    assertEquals(handler.metadata.priority, 0);
    assertEquals(handler.metadata.patterns, []);
  });

  describe("no auth configured", () => {
    it("should allow requests when no auth is configured", async () => {
      const request = new Request("https://example.com/test");
      const ctx = createMockContext();
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, true);
    });

    it("should allow OPTIONS requests", async () => {
      const request = new Request("https://example.com/test", { method: "OPTIONS" });
      const ctx = createMockContext();
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("basic auth", () => {
    it("should reject request without auth header", async () => {
      const request = new Request("https://example.com/test");
      const ctx = createMockContext({
        VERYFRONT_BASIC_USER: "admin",
        VERYFRONT_BASIC_PASS: "secret",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, false);
      assertExists(result.response);
      assertEquals(result.response.status, 401);
      assertEquals(result.response.headers.get("WWW-Authenticate"), 'Basic realm="Secure Area"');
    });

    it("should reject request with invalid credentials", async () => {
      const request = new Request("https://example.com/test", {
        headers: {
          Authorization: "Basic " + btoa("wrong:password"),
        },
      });
      const ctx = createMockContext({
        VERYFRONT_BASIC_USER: "admin",
        VERYFRONT_BASIC_PASS: "secret",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, false);
      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });

    it("should accept request with valid credentials", async () => {
      const request = new Request("https://example.com/test", {
        headers: {
          Authorization: "Basic " + btoa("admin:secret"),
        },
      });
      const ctx = createMockContext({
        VERYFRONT_BASIC_USER: "admin",
        VERYFRONT_BASIC_PASS: "secret",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, true);
    });

    it("should allow OPTIONS requests even with basic auth configured", async () => {
      const request = new Request("https://example.com/test", { method: "OPTIONS" });
      const ctx = createMockContext({
        VERYFRONT_BASIC_USER: "admin",
        VERYFRONT_BASIC_PASS: "secret",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("bearer auth", () => {
    it("should reject request without auth header", async () => {
      const request = new Request("https://example.com/test");
      const ctx = createMockContext({
        VERYFRONT_BEARER_TOKEN: "secret-token-123",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, false);
      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });

    it("should reject request with invalid token", async () => {
      const request = new Request("https://example.com/test", {
        headers: {
          Authorization: "Bearer wrong-token",
        },
      });
      const ctx = createMockContext({
        VERYFRONT_BEARER_TOKEN: "secret-token-123",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, false);
      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });

    it("should reject request with malformed bearer header", async () => {
      const request = new Request("https://example.com/test", {
        headers: {
          Authorization: "secret-token-123",
        },
      });
      const ctx = createMockContext({
        VERYFRONT_BEARER_TOKEN: "secret-token-123",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, false);
      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });

    it("should accept request with valid token", async () => {
      const request = new Request("https://example.com/test", {
        headers: {
          Authorization: "Bearer secret-token-123",
        },
      });
      const ctx = createMockContext({
        VERYFRONT_BEARER_TOKEN: "secret-token-123",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("auth priority", () => {
    it("should check basic auth before bearer auth when both are configured", async () => {
      const request = new Request("https://example.com/test");
      const ctx = createMockContext({
        VERYFRONT_BASIC_USER: "admin",
        VERYFRONT_BASIC_PASS: "secret",
        VERYFRONT_BEARER_TOKEN: "token123",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, false);
      assertExists(result.response);
      // Should get basic auth challenge, not bearer
      assertEquals(result.response.headers.get("WWW-Authenticate"), 'Basic realm="Secure Area"');
    });
  });

  describe("edge cases", () => {
    it("should handle empty user/pass values", async () => {
      const request = new Request("https://example.com/test");
      const ctx = createMockContext({
        VERYFRONT_BASIC_USER: "",
        VERYFRONT_BASIC_PASS: "",
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, true);
    });

    it("should handle special characters in credentials", async () => {
      const username = "user@example.com";
      const password = "p@ss:w0rd!";
      const request = new Request("https://example.com/test", {
        headers: {
          Authorization: "Basic " + btoa(`${username}:${password}`),
        },
      });
      const ctx = createMockContext({
        VERYFRONT_BASIC_USER: username,
        VERYFRONT_BASIC_PASS: password,
      });
      const result = await handler.handle(request, ctx);
      assertEquals(result.continue, true);
    });
  });
});
