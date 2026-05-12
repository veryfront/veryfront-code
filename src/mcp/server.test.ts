import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { dynamicTool } from "#veryfront/tool";
import "#veryfront/schemas/_test-setup.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";

import { clearMCPRegistry, registerResource, registerTool } from "./registry.ts";
import { createMCPServer } from "./server.ts";
import type { ToolListEntry } from "./types.ts";

const originalFetch = globalThis.fetch;
const MCP_URL = "http://localhost/mcp";
const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonRpcRequest(
  payload: Record<string, unknown>,
  headers: HeadersInit = JSON_HEADERS,
): Request {
  return new Request(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function optionsRequest(origin: string): Request {
  return new Request(MCP_URL, {
    method: "OPTIONS",
    headers: { Origin: origin },
  });
}

function deleteSessionRequest(sessionId: string, headers: HeadersInit = {}): Request {
  return new Request(MCP_URL, {
    method: "DELETE",
    headers: { "MCP-Session-Id": sessionId, ...headers },
  });
}

async function initSession(handler: (req: Request) => Promise<Response>): Promise<string> {
  return initSessionWithCapabilities(handler, {});
}

async function initSessionWithCapabilities(
  handler: (req: Request) => Promise<Response>,
  capabilities: Record<string, unknown>,
): Promise<string> {
  const response = await handler(jsonRpcRequest({
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities,
      clientInfo: { name: "test", version: "1.0" },
    },
  }));
  const sessionId = response.headers.get("MCP-Session-Id");
  if (!sessionId) throw new Error("initSession: no MCP-Session-Id in response");
  return sessionId;
}

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
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let capturedContext: { endUserId?: string; projectId?: string } | undefined;

    registerTool(
      "test:context",
      dynamicTool({
        id: "test:context",
        description: "Echo tool context",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async (_input, context) => {
          capturedContext = context as typeof capturedContext;
          return { ok: true };
        },
      }),
    );

    const handler = server.createHTTPHandler();
    const request = jsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test:context", arguments: {} },
      },
      {
        ...JSON_HEADERS,
        "x-end-user-id": "user_123",
        "x-project-id": "proj-abc_123",
      },
    );

    const response = await handler(request);
    assertEquals(response.status, 200);
    assertExists(capturedContext);
    assertEquals(capturedContext?.endUserId, "user_123");
    assertEquals(capturedContext?.projectId, "proj-abc_123");
  });

  it("ignores invalid identity headers when building tool context", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let capturedContext: { endUserId?: string; projectId?: string } | undefined;

    registerTool(
      "test:context",
      dynamicTool({
        id: "test:context",
        description: "Echo tool context",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async (_input, context) => {
          capturedContext = context as typeof capturedContext;
          return { ok: true };
        },
      }),
    );

    const handler = server.createHTTPHandler();
    const response = await handler(
      jsonRpcRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "test:context", arguments: {} },
        },
        {
          ...JSON_HEADERS,
          "x-end-user-id": "user 123",
          "x-project-id": "proj/abc",
        },
      ),
    );

    assertEquals(response.status, 200);
    assertEquals(capturedContext, undefined);
  });

  it("includes integration context headers in CORS preflight response", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
      cors: { enabled: true, origins: ["https://example.com"] },
    });

    const handler = server.createHTTPHandler();
    const response = await handler(
      optionsRequest("https://example.com"),
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
        jsonRpcRequest(
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { ...JSON_HEADERS, Authorization: "Bearer some-token" },
        ),
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
        jsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
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
        jsonRpcRequest(
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { ...JSON_HEADERS, Authorization: "Bearer valid-token" },
        ),
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
        jsonRpcRequest(
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { ...JSON_HEADERS, Authorization: "Bearer wrong-token" },
        ),
      );

      assertEquals(response.status, 401);
    });
  });

  describe("request body size limit", () => {
    it("rejects requests with Content-Length exceeding 1MB", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      const response = await handler(
        new Request(MCP_URL, {
          method: "POST",
          headers: {
            ...JSON_HEADERS,
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      const response = await handler(
        jsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      );

      assertEquals(response.status, 200);
    });
  });

  describe("request validation", () => {
    it("rejects requests with invalid content type", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      const response = await handler(
        new Request(MCP_URL, {
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      const response = await handler(
        new Request(MCP_URL, {
          method: "POST",
          headers: JSON_HEADERS,
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
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true, origins: ["https://a.com", "https://b.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        optionsRequest("https://b.com"),
      );

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://b.com");
      assertEquals(response.headers.get("Vary"), "Origin");
    });

    it("returns no CORS headers when request Origin does not match", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true, origins: ["https://allowed.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        optionsRequest("https://evil.com"),
      );

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("returns no CORS headers when no origins configured", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        optionsRequest("https://example.com"),
      );

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("returns no CORS headers when CORS is disabled", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        optionsRequest("https://example.com"),
      );

      assertEquals(response.status, 204);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("includes CORS headers on POST responses when Origin matches", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true, origins: ["https://example.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        jsonRpcRequest(
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { ...JSON_HEADERS, Origin: "https://example.com" },
        ),
      );

      assertEquals(response.status, 200);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), "https://example.com");
    });
  });

  describe("initialize version negotiation", () => {
    it("echoes 2025-11-25 when client requests it", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const res = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });
      const result = res.result as Record<string, unknown>;
      assertEquals(result.protocolVersion, "2025-11-25");
    });

    it("serverInfo includes title and description", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
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
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true, origins: ["https://allowed.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        jsonRpcRequest(
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { ...JSON_HEADERS, Origin: "https://evil.com" },
        ),
      );

      assertEquals(response.status, 403);
      const body = await response.json();
      assertEquals(body.error.message, "Forbidden: Origin not allowed");
    });

    it("returns 200 when Origin is in allowed list", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true, origins: ["https://allowed.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        jsonRpcRequest(
          { jsonrpc: "2.0", id: 1, method: "tools/list" },
          { ...JSON_HEADERS, Origin: "https://allowed.com" },
        ),
      );

      assertEquals(response.status, 200);
    });

    it("returns 200 when no Origin header is present", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true, origins: ["https://allowed.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        jsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      );

      assertEquals(response.status, 200);
    });
  });

  describe("notifications/initialized", () => {
    it("handles notifications/initialized with id", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
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
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });

    registerTool(
      "test:annotated",
      dynamicTool({
        id: "test:annotated",
        description: "Tool with annotations",
        inputSchema: defineSchema((v) => v.object({}))(),
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
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });

    registerTool(
      "test:plain",
      dynamicTool({
        id: "test:plain",
        description: "Plain tool",
        inputSchema: defineSchema((v) => v.object({}))(),
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
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });

    registerTool(
      "test:partial-annotations",
      dynamicTool({
        id: "test:partial-annotations",
        description: "Partially annotated",
        inputSchema: defineSchema((v) => v.object({}))(),
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

      registerTool(
        "test:echo",
        dynamicTool({
          id: "test:echo",
          description: "Echo tool",
          inputSchema: defineSchema((v) => v.object({}))(),
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

      registerTool(
        "test:fail",
        dynamicTool({
          id: "test:fail",
          description: "Failing tool",
          inputSchema: defineSchema((v) => v.object({}))(),
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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

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
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

      registerTool(
        "test:strict",
        dynamicTool({
          id: "test:strict",
          description: "Tool with required arg",
          inputSchema: defineSchema((v) => v.object({ required_field: v.string() }))(),
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

  describe("list endpoint pagination", () => {
    it("tools/list accepts cursor param without erroring", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: { cursor: "abc123" },
      });

      assertEquals(response.error, undefined);
      assertExists(response.result);
    });

    it("tools/list does not include nextCursor when all results fit", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

      registerTool(
        "test:pagination",
        dynamicTool({
          id: "test:pagination",
          description: "Pagination test tool",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: async () => ({ ok: true }),
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });

      assertEquals(response.error, undefined);
      const result = response.result as { tools: unknown[]; nextCursor?: string };
      assertEquals(result.nextCursor, undefined);
    });

    it("resources/list accepts cursor param without erroring", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
        params: { cursor: "abc123" },
      });

      assertEquals(response.error, undefined);
      assertExists(response.result);
    });

    it("prompts/list accepts cursor param without erroring", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/list",
        params: { cursor: "abc123" },
      });

      assertEquals(response.error, undefined);
      assertExists(response.result);
    });
  });

  describe("resources/templates/list", () => {
    it("returns array without error", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/templates/list",
      });

      assertEquals(response.jsonrpc, "2.0");
      assertEquals(response.id, 1);
      assertEquals(response.error, undefined);
      const result = response.result as { resourceTemplates: unknown[] };
      assertEquals(Array.isArray(result.resourceTemplates), true);
    });

    it("includes parameterized resources as templates", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource("test:users", {
        id: "test:users",
        pattern: "/users/:id",
        description: "Get user by id",
        paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
        load: async () => ({}),
      });

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/templates/list",
      });

      const result = response.result as {
        resourceTemplates: Array<Record<string, unknown>>;
      };
      const tmpl = result.resourceTemplates.find((t) => t.name === "test:users");
      assertExists(tmpl);
      assertEquals(tmpl.uriTemplate, "/users/{id}");
      assertEquals(tmpl.description, "Get user by id");
    });

    it("excludes scheme-only colons like openapi://spec", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource("test:openapi", {
        id: "test:openapi",
        pattern: "openapi://spec",
        description: "OpenAPI spec",
        paramsSchema: defineSchema((v) => v.object({}))(),
        load: async () => ({}),
      });

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/templates/list",
      });

      const result = response.result as {
        resourceTemplates: Array<Record<string, unknown>>;
      };
      const tmpl = result.resourceTemplates.find((t) => t.name === "test:openapi");
      assertEquals(tmpl, undefined);
    });

    it("includes title when set on resource", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource("test:posts", {
        id: "test:posts",
        pattern: "/posts/:slug",
        description: "Get post",
        title: "Blog Post",
        paramsSchema: defineSchema((v) => v.object({ slug: v.string() }))(),
        load: async () => ({}),
      });

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/templates/list",
      });

      const result = response.result as {
        resourceTemplates: Array<Record<string, unknown>>;
      };
      const tmpl = result.resourceTemplates.find((t) => t.name === "test:posts");
      assertExists(tmpl);
      assertEquals(tmpl.title, "Blog Post");
      assertEquals(tmpl.uriTemplate, "/posts/{slug}");
    });
  });

  it("declares completions capability in initialize", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    const caps = (result.result as Record<string, unknown>)
      .capabilities as Record<string, unknown>;
    assertExists(caps.completions);
  });

  it("completion/complete returns empty values for unknown ref", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "completion/complete",
      params: {
        ref: { type: "ref/resource", uri: "unknown://template" },
        argument: { name: "param", value: "" },
      },
    });
    assertEquals(result.error, undefined);
    const data = result.result as {
      completion: { values: string[]; hasMore: boolean };
    };
    assertEquals(data.completion.values, []);
    assertEquals(data.completion.hasMore, false);
  });

  it("completion/complete returns empty values when argument is missing", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "completion/complete",
      params: {
        ref: { type: "ref/resource", uri: "test://x" },
      },
    });
    assertEquals(result.error, undefined);
    const data = result.result as {
      completion: { values: string[]; hasMore: boolean };
    };
    assertEquals(data.completion.values, []);
    assertEquals(data.completion.hasMore, false);
  });

  it("completion/complete returns empty values when ref is missing", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "completion/complete",
      params: {
        argument: { name: "param", value: "test" },
      },
    });
    assertEquals(result.error, undefined);
    const data = result.result as {
      completion: { values: string[]; hasMore: boolean };
    };
    assertEquals(data.completion.values, []);
    assertEquals(data.completion.hasMore, false);
  });

  it("stores client capabilities from initialize request", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { elicitation: { form: {}, url: {} } },
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    assertEquals(server.clientSupportsElicitation("form"), true);
    assertEquals(server.clientSupportsElicitation("url"), true);
  });

  it("reports no elicitation support when client does not declare it", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    assertEquals(server.clientSupportsElicitation("form"), false);
    assertEquals(server.clientSupportsElicitation("url"), false);
  });

  it("treats empty elicitation capability as form-only support", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { elicitation: {} },
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    assertEquals(server.clientSupportsElicitation("form"), true);
    assertEquals(server.clientSupportsElicitation("url"), false);
  });

  it("handles malformed elicitation capability without crashing", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: { elicitation: true },
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    assertEquals(server.clientSupportsElicitation("form"), false);
    assertEquals(server.clientSupportsElicitation("url"), false);
  });

  it("keeps elicitation capabilities isolated per HTTP session", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const handler = server.createHTTPHandler();

    const sessionA = await initSessionWithCapabilities(handler, { elicitation: { form: {} } });
    const sessionB = await initSessionWithCapabilities(handler, { elicitation: { url: {} } });

    assertEquals(server.clientSupportsElicitation("form", sessionA), true);
    assertEquals(server.clientSupportsElicitation("url", sessionA), false);
    assertEquals(server.clientSupportsElicitation("form", sessionB), false);
    assertEquals(server.clientSupportsElicitation("url", sessionB), true);
  });

  it("syncs integration config to API on first tools/list call", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
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
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
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

  describe("Streamable HTTP session management", () => {
    it("returns MCP-Session-Id header on initialize response", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-11-25",
              capabilities: {},
              clientInfo: { name: "test", version: "1.0" },
            },
          }),
        }),
      );
      assertEquals(response.status, 200);
      const sessionId = response.headers.get("MCP-Session-Id");
      assertExists(sessionId);
      assertEquals(sessionId.length > 0, true);

      const body = await response.json() as {
        result: {
          protocolVersion: string;
          serverInfo: { name: string };
        };
      };
      assertEquals(body.result.protocolVersion, "2025-11-25");
      assertEquals(body.result.serverInfo.name, "veryfront-mcp");
    });

    it("returns 400 when MCP-Session-Id is missing on post-init request", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      // First, initialize to create a session
      await initSession(handler);

      // Then make a request without session ID
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        }),
      );
      assertEquals(response.status, 400);
    });

    it("returns 404 for expired/unknown session ID", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      // Initialize to set the initialized flag
      await initSession(handler);

      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "MCP-Session-Id": "nonexistent-session",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      assertEquals(response.status, 404);
    });

    it("accepts DELETE to terminate session", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      // Initialize two sessions so one remains active after DELETE
      const sessionA = await initSession(handler);
      const sessionB = await initSession(handler);

      // DELETE session A
      const deleteResponse = await handler(
        deleteSessionRequest(sessionA),
      );
      assertEquals(deleteResponse.status, 200);

      // Terminated session returns 404 (session B still active, so check is enforced)
      const postResponse = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "MCP-Session-Id": sessionA,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        }),
      );
      assertEquals(postResponse.status, 404);

      // Session B still works
      const okResponse = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "MCP-Session-Id": sessionB,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
        }),
      );
      assertEquals(okResponse.status, 200);
    });

    it("clears session-scoped elicitation capabilities after DELETE", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      const sessionId = await initSessionWithCapabilities(handler, { elicitation: { form: {} } });
      assertEquals(server.clientSupportsElicitation("form", sessionId), true);

      const deleteResponse = await handler(
        deleteSessionRequest(sessionId),
      );
      assertEquals(deleteResponse.status, 200);
      assertEquals(server.clientSupportsElicitation("form", sessionId), false);
    });

    it("returns 202 for JSON-RPC notifications", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      // Initialize
      const sessionId = await initSession(handler);

      // Send notification (no id field = notification)
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "MCP-Session-Id": sessionId,
          },
          body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        }),
      );
      assertEquals(response.status, 202);
    });

    it("returns 200 with JSON-RPC response for request with id: 0", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();
      const sessionId = await initSession(handler);

      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "MCP-Session-Id": sessionId,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" }),
        }),
      );
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.id, 0);
      assertExists(body.result);
    });

    it("rejects unauthenticated DELETE when bearer auth is configured", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: {
          type: "bearer",
          validate: async (token: string) => token === "valid-token",
        },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "DELETE",
          headers: { "MCP-Session-Id": "some-session" },
        }),
      );
      assertEquals(response.status, 401);
    });

    it("returns 405 for unsupported HTTP methods", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", { method: "PUT" }),
      );
      assertEquals(response.status, 405);
    });

    it("includes MCP-Session-Id in CORS allowed headers", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
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
      assertStringIncludes(allowHeaders, "MCP-Session-Id");
    });

    it("includes DELETE in CORS allowed methods", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true, origins: ["https://example.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "OPTIONS",
          headers: { "Origin": "https://example.com" },
        }),
      );

      const allowMethods = response.headers.get("Access-Control-Allow-Methods");
      assertExists(allowMethods);
      assertStringIncludes(allowMethods, "DELETE");
    });

    it("resets session requirement after all sessions are terminated", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      // Client initializes, creating a session
      const sessionId = await initSession(handler);

      // Terminate that session
      await handler(
        deleteSessionRequest(sessionId),
      );

      // After all sessions terminated, server should not require MCP-Session-Id
      // (no active sessions = pre-init state)
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      assertEquals(response.status, 200);
    });

    it("isolates concurrent sessions independently", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      // Two clients initialize
      const sessionA = await initSession(handler);
      const sessionB = await initSession(handler);

      // Both sessions are distinct
      assertEquals(sessionA !== sessionB, true);

      // Both can make requests
      for (const sid of [sessionA, sessionB]) {
        const res = await handler(
          new Request("http://localhost/mcp", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "MCP-Session-Id": sid,
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
          }),
        );
        assertEquals(res.status, 200);
      }

      // Terminate A — B still valid
      await handler(
        deleteSessionRequest(sessionA),
      );

      const resB = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "MCP-Session-Id": sessionB,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        }),
      );
      assertEquals(resB.status, 200);

      // A is rejected
      const resA = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "MCP-Session-Id": sessionA,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list" }),
        }),
      );
      assertEquals(resA.status, 404);
    });

    it("accepts valid session ID on post-init requests", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      const sessionId = await initSession(handler);

      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "MCP-Session-Id": sessionId,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        }),
      );
      assertEquals(response.status, 200);
    });
  });

  it("declares tasks capability in initialize", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    const caps = (result.result as Record<string, unknown>)
      .capabilities as Record<string, Record<string, unknown>>;
    assertExists(caps.tasks);
    assertExists(caps.logging);
  });

  it("logging/setLevel stores the level and returns empty result", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "logging/setLevel",
      params: { level: "warning" },
    });
    assertEquals(result.error, undefined);
    assertEquals(result.result, {});
  });

  it("extracts progressToken from _meta and passes to tool context", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let capturedContext: Record<string, unknown> | undefined;

    registerTool(
      "test:progress",
      dynamicTool({
        id: "test:progress",
        description: "Captures context",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async (_input, context) => {
          capturedContext = context as Record<string, unknown>;
          return { ok: true };
        },
      }),
    );

    await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:progress", arguments: {}, _meta: { progressToken: "token-123" } },
    });

    assertExists(capturedContext);
    assertEquals(capturedContext?.progressToken, "token-123");
  });

  it("accepts notifications/cancelled without error", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1, reason: "User cancelled" },
    });
    assertEquals(result.error, undefined);
    assertEquals(result.result, {});
  });

  it("logging/setLevel rejects invalid level", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "logging/setLevel",
      params: { level: "invalid_level" },
    });
    assertExists(result.error);
    assertEquals(result.error.code, -32602);
  });

  it("tools/call with task field returns CreateTaskResult immediately", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:slow",
      dynamicTool({
        id: "test:slow",
        description: "Slow tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => {
          await new Promise((r) => setTimeout(r, 50));
          return { done: true };
        },
      }),
    );
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:slow", arguments: {}, task: { ttl: 60000 } },
    });
    const res = result.result as { task: Record<string, unknown> };
    assertExists(res.task.taskId);
    assertEquals(res.task.status, "working");
    await server.waitForPendingTasks();
  });

  it("tasks/get returns task status", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:slow2",
      dynamicTool({
        id: "test:slow2",
        description: "Slow tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return { done: true };
        },
      }),
    );
    const createResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:slow2", arguments: {}, task: { ttl: 60000 } },
    });
    const taskId = (createResult.result as { task: { taskId: string } }).task.taskId;
    const getResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/get",
      params: { taskId },
    });
    const task = getResult.result as Record<string, unknown>;
    assertExists(task.taskId);
    assertExists(task.status);
    await server.waitForPendingTasks();
  });

  it("tasks/cancel cancels a working task", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:slow3",
      dynamicTool({
        id: "test:slow3",
        description: "Slow tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => {
          await new Promise((r) => setTimeout(r, 100));
          return { done: true };
        },
      }),
    );
    const createResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:slow3", arguments: {}, task: { ttl: 60000 } },
    });
    const taskId = (createResult.result as { task: { taskId: string } }).task.taskId;
    const cancelResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/cancel",
      params: { taskId },
    });
    assertEquals(
      (cancelResult.result as Record<string, unknown>).status,
      "cancelled",
    );
    await server.waitForPendingTasks();
  });

  it("tasks/result returns completed task result", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:fast",
      dynamicTool({
        id: "test:fast",
        description: "Fast tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => ({ answer: 42 }),
      }),
    );
    const createResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:fast", arguments: {}, task: { ttl: 60000 } },
    });
    const taskId = (createResult.result as { task: { taskId: string } }).task.taskId;
    await server.waitForPendingTasks();
    const resultResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/result",
      params: { taskId },
    });
    const payload = resultResp.result as { content: { text: string }[]; isError: boolean };
    assertEquals(payload.isError, false);
    assertExists(payload.content);
  });

  it("tasks/result returns error when task is still working", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:slow4",
      dynamicTool({
        id: "test:slow4",
        description: "Slow tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return { done: true };
        },
      }),
    );
    const createResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:slow4", arguments: {}, task: { ttl: 60000 } },
    });
    const taskId = (createResult.result as { task: { taskId: string } }).task.taskId;
    const resultResp = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/result",
      params: { taskId },
    });
    assertExists(resultResp.error);
    assertEquals(resultResp.error!.code, -32002);
    await server.waitForPendingTasks();
  });

  it("async tool failure sets task status to failed", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:fail",
      dynamicTool({
        id: "test:fail",
        description: "Failing tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => {
          throw new Error("tool broke");
        },
      }),
    );
    const createResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:fail", arguments: {}, task: { ttl: 60000 } },
    });
    const taskId = (createResult.result as { task: { taskId: string } }).task.taskId;
    await server.waitForPendingTasks();
    const getResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/get",
      params: { taskId },
    });
    const task = getResult.result as Record<string, unknown>;
    assertEquals(task.status, "failed");
    assertEquals(task.statusMessage, "tool broke");
  });

  it("tasks/get returns error for unknown taskId", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/get",
      params: { taskId: "nonexistent" },
    });
    assertExists(result.error);
    assertEquals(result.error!.code, -32602);
  });

  it("tasks/cancel returns error for unknown taskId", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const result = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tasks/cancel",
      params: { taskId: "nonexistent" },
    });
    assertExists(result.error);
  });

  describe("listChanged notifications", () => {
    it("calls onNotification when tools list changes", () => {
      const notifications: Array<{ method: string }> = [];
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      server.onNotification = (notification) => {
        notifications.push(notification as { method: string });
      };
      server.notifyToolsChanged();
      assertEquals(notifications.length, 1);
      assertEquals(notifications[0].method, "notifications/tools/list_changed");
    });

    it("calls onNotification for resources list changes", () => {
      const notifications: Array<{ method: string }> = [];
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      server.onNotification = (notification) => {
        notifications.push(notification as { method: string });
      };
      server.notifyResourcesChanged();
      assertEquals(notifications.length, 1);
      assertEquals(notifications[0].method, "notifications/resources/list_changed");
    });

    it("calls onNotification for prompts list changes", () => {
      const notifications: Array<{ method: string }> = [];
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      server.onNotification = (notification) => {
        notifications.push(notification as { method: string });
      };
      server.notifyPromptsChanged();
      assertEquals(notifications.length, 1);
      assertEquals(notifications[0].method, "notifications/prompts/list_changed");
    });

    it("does not throw when onNotification is not set", () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      server.notifyToolsChanged(); // should not throw
    });

    it("emits tools/list_changed when loadRemoteIntegrationTools succeeds", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      server.setIntegrationLoader({
        integrations: { github: {} },
        apiBaseUrl: "https://api.example.com",
        apiToken: "test-token",
      });

      const notifications: Array<{ method: string }> = [];
      server.onNotification = (notification) => {
        notifications.push(notification as { method: string });
      };

      globalThis.fetch = async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === "https://api.example.com/integrations/config") {
          return new Response(JSON.stringify({ synced: 1 }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      };

      await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });

      const toolsChanged = notifications.find(
        (n) => n.method === "notifications/tools/list_changed",
      );
      assertExists(toolsChanged);
    });
  });

  describe("auth fail-closed (VULN-SRV-5)", () => {
    it("throws when no auth is configured (unset auth)", () => {
      assertThrows(
        () => {
          // deno-lint-ignore no-explicit-any -- testing runtime guard against missing auth
          createMCPServer({ enabled: true } as any);
        },
        Error,
        "MCP auth must be configured",
      );
    });

    it("error for unset auth mentions allowUnauthenticated for dev opt-in", () => {
      assertThrows(
        () => {
          // deno-lint-ignore no-explicit-any -- testing runtime guard against missing auth
          createMCPServer({ enabled: true } as any);
        },
        Error,
        "allowUnauthenticated: true",
      );
    });

    it("throws when auth.type is 'none' without allowUnauthenticated (undefined)", () => {
      assertThrows(
        () => {
          // deno-lint-ignore no-explicit-any -- testing runtime guard against {type:"none"} shorthand
          createMCPServer({ enabled: true, auth: { type: "none" } } as any);
        },
        Error,
        "allowUnauthenticated: true",
      );
    });

    it("throws when auth.type is 'none' with allowUnauthenticated: false", () => {
      assertThrows(
        () => {
          createMCPServer({
            enabled: true,
            // deno-lint-ignore no-explicit-any -- deliberately invalid: allow=false must reject
            auth: { type: "none", allowUnauthenticated: false } as any,
          });
        },
        Error,
        "allowUnauthenticated: true",
      );
    });

    it("throws when auth.type is 'none' with non-boolean allowUnauthenticated", () => {
      assertThrows(
        () => {
          createMCPServer({
            enabled: true,
            // deno-lint-ignore no-explicit-any -- deliberately invalid non-bool flag
            auth: { type: "none", allowUnauthenticated: "yes" } as any,
          });
        },
        Error,
        "allowUnauthenticated: true",
      );
    });

    it("throws when auth.type is unknown", () => {
      assertThrows(
        () => {
          createMCPServer({
            enabled: true,
            // deno-lint-ignore no-explicit-any -- deliberately invalid auth type
            auth: { type: "oauth" } as any,
          });
        },
        Error,
        "not supported",
      );
    });

    it("throws when auth.type is 'api-key' (no validator wiring yet)", () => {
      assertThrows(
        () => {
          createMCPServer({
            enabled: true,
            // deno-lint-ignore no-explicit-any -- api-key is not yet supported; must fail closed
            auth: { type: "api-key" } as any,
          });
        },
        Error,
        "not supported",
      );
    });

    it("succeeds with explicit allowUnauthenticated: true", () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      assertExists(server);
    });

    it("succeeds with bearer auth", () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "bearer", validate: async (t: string) => t === "ok" },
      });
      assertExists(server);
    });

    it("http-transport: bearer rejects missing token", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "bearer", validate: async (t: string) => t === "ok" },
      });
      const handler = server.createHTTPHandler();
      const res = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      assertEquals(res.status, 401);
    });

    it("http-transport: bearer rejects bad token", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "bearer", validate: async (t: string) => t === "ok" },
      });
      const handler = server.createHTTPHandler();
      const res = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer nope" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      assertEquals(res.status, 401);
    });

    it("http-transport: none + allowUnauthenticated accepts requests", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();
      const res = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      assertEquals(res.status, 200);
    });
  });
});
