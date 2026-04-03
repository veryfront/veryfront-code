import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { dynamicTool } from "#veryfront/tool";
import { z } from "zod";
import { clearMCPRegistry, registerTool } from "./registry.ts";
import { createMCPServer } from "./server.ts";

const originalFetch = globalThis.fetch;

describe("mcp/server", () => {
  beforeEach(() => {
    clearMCPRegistry();
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    clearMCPRegistry();
    globalThis.fetch = originalFetch;
  });

  it("extracts end-user and project IDs from HTTP headers into tool context", async () => {
    const server = createMCPServer({ enabled: true });
    let capturedContext: { endUserId?: string; projectId?: string } | undefined;

    registerTool(
      "test:context",
      dynamicTool({
        id: "test:context",
        description: "Echo tool context",
        inputSchema: z.object({}),
        execute: async (_input, context) => {
          capturedContext = context as typeof capturedContext;
          return { ok: true };
        },
      }),
    );

    const handler = server.createHTTPHandler();
    const request = new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-end-user-id": "user_123",
        "x-project-id": "proj-abc_123",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test:context", arguments: {} },
      }),
    });

    const response = await handler(request);
    assertEquals(response.status, 200);
    assertExists(capturedContext);
    assertEquals(capturedContext?.endUserId, "user_123");
    assertEquals(capturedContext?.projectId, "proj-abc_123");
  });

  it("ignores invalid identity headers when building tool context", async () => {
    const server = createMCPServer({ enabled: true });
    let capturedContext: { endUserId?: string; projectId?: string } | undefined;

    registerTool(
      "test:context",
      dynamicTool({
        id: "test:context",
        description: "Echo tool context",
        inputSchema: z.object({}),
        execute: async (_input, context) => {
          capturedContext = context as typeof capturedContext;
          return { ok: true };
        },
      }),
    );

    const handler = server.createHTTPHandler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-end-user-id": "user 123",
          "x-project-id": "proj/abc",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "test:context", arguments: {} },
        }),
      }),
    );

    assertEquals(response.status, 200);
    assertEquals(capturedContext, undefined);
  });

  it("includes integration context headers in CORS preflight response", async () => {
    const server = createMCPServer({
      enabled: true,
      cors: { enabled: true, origins: ["https://example.com"] },
    });

    const handler = server.createHTTPHandler();
    const response = await handler(
      new Request("http://localhost/mcp", {
        method: "OPTIONS",
        headers: { "Origin": "https://example.com" },
      }),
    );

    assertEquals(response.status, 204);
    const allowHeaders = response.headers.get("Access-Control-Allow-Headers");
    assertExists(allowHeaders);
    assertStringIncludes(allowHeaders, "X-End-User-Id");
    assertStringIncludes(allowHeaders, "X-Project-Id");
  });

  describe("bearer auth", () => {
    it("rejects requests when bearer auth has no validate function", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "bearer" },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer some-token",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      assertEquals(response.status, 401);
    });

    it("rejects requests without Authorization header", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "bearer", validate: async (token: string) => token === "valid" },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      assertEquals(response.status, 401);
    });

    it("accepts requests with valid bearer token", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "bearer", validate: async (token: string) => token === "valid-token" },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer valid-token",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      assertEquals(response.status, 200);
    });

    it("rejects requests with invalid bearer token", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "bearer", validate: async (token: string) => token === "valid-token" },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer wrong-token",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      assertEquals(response.status, 401);
    });
  });

  describe("request body size limit", () => {
    it("rejects requests with Content-Length exceeding 1MB", async () => {
      const server = createMCPServer({ enabled: true });
      const handler = server.createHTTPHandler();

      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": "2000000",
          },
          body: "{}",
        }),
      );

      assertEquals(response.status, 413);
      const body = await response.json();
      assertEquals(body.error.message, "Request body too large");
    });

    it("rejects requests with body exceeding 1MB even without Content-Length", async () => {
      const server = createMCPServer({ enabled: true });
      const handler = server.createHTTPHandler();

      const largeBody = "x".repeat(1_048_577);
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: largeBody,
        }),
      );

      assertEquals(response.status, 413);
      const body = await response.json();
      assertEquals(body.error.message, "Request body too large");
    });

    it("accepts requests within the 1MB limit", async () => {
      const server = createMCPServer({ enabled: true });
      const handler = server.createHTTPHandler();

      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      assertEquals(response.status, 200);
    });
  });

  describe("request validation", () => {
    it("rejects requests with invalid content type", async () => {
      const server = createMCPServer({ enabled: true });
      const handler = server.createHTTPHandler();

      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      assertEquals(response.status, 400);
      const body = await response.json();
      assertEquals(body.error.message, "Invalid Content-Type: expected application/json");
    });

    it("rejects malformed JSON request bodies", async () => {
      const server = createMCPServer({ enabled: true });
      const handler = server.createHTTPHandler();

      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{invalid",
        }),
      );

      assertEquals(response.status, 400);
      const body = await response.json();
      assertEquals(body.error.message, "Parse error");
    });
  });

  describe("CORS origin matching", () => {
    it("returns CORS headers when request Origin matches configured origins", async () => {
      const server = createMCPServer({
        enabled: true,
        cors: { enabled: true, origins: ["https://a.com", "https://b.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "OPTIONS",
          headers: { "Origin": "https://b.com" },
        }),
      );

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://b.com");
      assertEquals(response.headers.get("Vary"), "Origin");
    });

    it("returns no CORS headers when request Origin does not match", async () => {
      const server = createMCPServer({
        enabled: true,
        cors: { enabled: true, origins: ["https://allowed.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "OPTIONS",
          headers: { "Origin": "https://evil.com" },
        }),
      );

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("returns no CORS headers when no origins configured", async () => {
      const server = createMCPServer({
        enabled: true,
        cors: { enabled: true },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "OPTIONS",
          headers: { "Origin": "https://example.com" },
        }),
      );

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("returns no CORS headers when CORS is disabled", async () => {
      const server = createMCPServer({ enabled: true });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "OPTIONS",
          headers: { "Origin": "https://example.com" },
        }),
      );

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("includes CORS headers on POST responses when Origin matches", async () => {
      const server = createMCPServer({
        enabled: true,
        cors: { enabled: true, origins: ["https://example.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Origin": "https://example.com",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://example.com");
    });
  });

  it("syncs integration config to API on first tools/list call", async () => {
    const server = createMCPServer({ enabled: true });
    server.setIntegrationLoader({
      integrations: { github: {} },
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
    });

    let configSyncCalled = false;
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.example.com/integrations/config") {
        configSyncCalled = true;
        return new Response(JSON.stringify({ synced: 1 }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    };

    await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    assertEquals(configSyncCalled, true);
  });

  it("syncs integration config only once", async () => {
    const server = createMCPServer({ enabled: true });
    server.setIntegrationLoader({
      integrations: { github: {} },
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
    });

    let configSyncCalls = 0;
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.example.com/integrations/config") {
        configSyncCalls += 1;
        return new Response(JSON.stringify({ synced: 1 }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Not Found", { status: 404 });
    };

    await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    await server.handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" });

    assertEquals(configSyncCalls, 1);
  });
});
