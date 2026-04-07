import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { dynamicTool } from "#veryfront/tool";
import { z } from "zod";
import { clearMCPRegistry, registerTool } from "./registry.ts";
import { createMCPServer } from "./server.ts";
import type { ToolListEntry } from "./types.ts";

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

  describe("initialize version negotiation", () => {
    it("echoes 2025-11-25 when client requests it", async () => {
      const server = createMCPServer({ enabled: true });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });
      const result = res.result as Record<string, unknown>;
      assertEquals(result.protocolVersion, "2025-11-25");
    });

    it("echoes 2024-11-05 when client requests it", async () => {
      const server = createMCPServer({ enabled: true });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05" },
      });
      const result = res.result as Record<string, unknown>;
      assertEquals(result.protocolVersion, "2024-11-05");
    });

    it("returns 2025-11-25 for unknown version", async () => {
      const server = createMCPServer({ enabled: true });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "1999-01-01" },
      });
      const result = res.result as Record<string, unknown>;
      assertEquals(result.protocolVersion, "2025-11-25");
    });

    it("returns 2025-11-25 when no version is provided", async () => {
      const server = createMCPServer({ enabled: true });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });
      const result = res.result as Record<string, unknown>;
      assertEquals(result.protocolVersion, "2025-11-25");
    });

    it("serverInfo includes title and description", async () => {
      const server = createMCPServer({ enabled: true });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });
      const result = res.result as Record<string, unknown>;
      const serverInfo = result.serverInfo as Record<string, unknown>;
      assertEquals(serverInfo.name, "veryfront-mcp");
      assertExists(serverInfo.title);
      assertExists(serverInfo.description);
    });

    it("includes instructions field", async () => {
      const server = createMCPServer({ enabled: true });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });
      const result = res.result as Record<string, unknown>;
      assertExists(result.instructions);
    });

    it("capabilities include listChanged", async () => {
      const server = createMCPServer({ enabled: true });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      });
      const result = res.result as Record<string, unknown>;
      const caps = result.capabilities as Record<string, Record<string, unknown>>;
      assertEquals(caps.tools.listChanged, true);
      assertEquals(caps.resources.listChanged, true);
      assertEquals(caps.prompts.listChanged, true);
    });
  });

  describe("Origin validation (DNS rebinding protection)", () => {
    it("returns 403 when Origin is not in allowed list", async () => {
      const server = createMCPServer({
        enabled: true,
        cors: { enabled: true, origins: ["https://allowed.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Origin": "https://evil.com",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      assertEquals(response.status, 403);
      const body = await response.json();
      assertEquals(body.error.message, "Forbidden: Origin not allowed");
    });

    it("returns 200 when Origin is in allowed list", async () => {
      const server = createMCPServer({
        enabled: true,
        cors: { enabled: true, origins: ["https://allowed.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Origin": "https://allowed.com",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );

      assertEquals(response.status, 200);
    });

    it("returns 200 when no Origin header is present", async () => {
      const server = createMCPServer({
        enabled: true,
        cors: { enabled: true, origins: ["https://allowed.com"] },
      });

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

  describe("notifications/initialized", () => {
    it("handles notifications/initialized with id", async () => {
      const server = createMCPServer({ enabled: true });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "notifications/initialized",
      });
      assertEquals(res.jsonrpc, "2.0");
      assertEquals(res.id, 1);
      assertEquals(res.error, undefined);
    });

    it("handles notifications/initialized without id (proper notification)", async () => {
      const server = createMCPServer({ enabled: true });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      assertEquals(res.jsonrpc, "2.0");
      assertEquals(res.id, undefined);
      assertEquals(res.error, undefined);
    });
  });

  it("includes title and annotations in tools/list when configured", async () => {
    const server = createMCPServer({ enabled: true });

    registerTool(
      "test:annotated",
      dynamicTool({
        id: "test:annotated",
        description: "Tool with annotations",
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
        mcp: {
          enabled: true,
          title: "Annotated Tool",
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
      }),
    );

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const tools = (response.result as { tools: ToolListEntry[] }).tools;
    const annotated = tools.find((t) => t.name === "test:annotated");
    assertExists(annotated);
    assertEquals(annotated.title, "Annotated Tool");
    assertEquals(annotated.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("omits title and annotations from tools/list when not configured", async () => {
    const server = createMCPServer({ enabled: true });

    registerTool(
      "test:plain",
      dynamicTool({
        id: "test:plain",
        description: "Plain tool",
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
      }),
    );

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const tools = (response.result as { tools: ToolListEntry[] }).tools;
    const plain = tools.find((t) => t.name === "test:plain");
    assertExists(plain);
    assertEquals(plain.title, undefined);
    assertEquals(plain.annotations, undefined);
  });

  it("only includes valid annotation keys in tools/list", async () => {
    const server = createMCPServer({ enabled: true });

    registerTool(
      "test:partial-annotations",
      dynamicTool({
        id: "test:partial-annotations",
        description: "Partially annotated",
        inputSchema: z.object({}),
        execute: async () => ({ ok: true }),
        mcp: {
          enabled: true,
          title: "Partial",
          annotations: { readOnlyHint: true },
        },
      }),
    );

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    const tools = (response.result as { tools: ToolListEntry[] }).tools;
    const tool = tools.find((t) => t.name === "test:partial-annotations");
    assertExists(tool);
    assertEquals(tool.annotations, { readOnlyHint: true });
  });

  describe("callTool error handling", () => {
    it("returns isError false on successful tool execution", async () => {
      const server = createMCPServer({ enabled: true });

      registerTool(
        "test:echo",
        dynamicTool({
          id: "test:echo",
          description: "Echo tool",
          inputSchema: z.object({}),
          execute: async () => ({ hello: "world" }),
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test:echo", arguments: {} },
      });

      assertEquals(response.error, undefined);
      const result = response.result as {
        content: { type: string; text: string }[];
        isError: boolean;
      };
      assertEquals(result.isError, false);
      assertEquals(result.content[0].type, "text");
      assertEquals(JSON.parse(result.content[0].text).hello, "world");
    });

    it("returns isError true when tool execution throws", async () => {
      const server = createMCPServer({ enabled: true });

      registerTool(
        "test:fail",
        dynamicTool({
          id: "test:fail",
          description: "Failing tool",
          inputSchema: z.object({}),
          execute: async () => {
            throw new Error("tool broke");
          },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "test:fail", arguments: {} },
      });

      assertEquals(response.error, undefined);
      const result = response.result as {
        content: { type: string; text: string }[];
        isError: boolean;
      };
      assertEquals(result.isError, true);
      assertEquals(result.content[0].text, "tool broke");
    });

    it("returns JSON-RPC error with code -32602 for unknown tool", async () => {
      const server = createMCPServer({ enabled: true });

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "nonexistent:tool", arguments: {} },
      });

      assertExists(response.error);
      assertEquals(response.error.code, -32602);
      assertStringIncludes(response.error.message, "Unknown tool");
    });

    it("returns JSON-RPC error with code -32602 for invalid arguments", async () => {
      const server = createMCPServer({ enabled: true });

      registerTool(
        "test:strict",
        dynamicTool({
          id: "test:strict",
          description: "Tool with required arg",
          inputSchema: z.object({ required_field: z.string() }),
          execute: async (input) => input,
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "test:strict", arguments: { wrong_field: 123 } },
      });

      assertExists(response.error);
      assertEquals(response.error.code, -32602);
      assertStringIncludes(response.error.message, "Invalid arguments");
      assertEquals(response.result, undefined);
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
