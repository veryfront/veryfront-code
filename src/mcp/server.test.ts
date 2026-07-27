import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { dynamicTool } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { prompt } from "#veryfront/prompt";
import { resource } from "#veryfront/resource";

import { clearMCPRegistry, registerPrompt, registerResource, registerTool } from "./registry.ts";
import { createMCPServer } from "./server.ts";
import type { ToolListEntry } from "./types.ts";

const originalFetch = globalThis.fetch;
const MCP_URL = "http://localhost/mcp";
const JSON_HEADERS = { "Content-Type": "application/json" };

function initializePayload(
  id: string | number = 0,
  capabilities: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-11-25",
      capabilities,
      clientInfo: { name: "test", version: "1.0" },
    },
  };
}

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

async function initSession(
  handler: (req: Request) => Promise<Response>,
  headers: HeadersInit = {},
): Promise<string> {
  return initSessionWithCapabilities(handler, {}, headers);
}

async function initSessionWithCapabilities(
  handler: (req: Request) => Promise<Response>,
  capabilities: Record<string, unknown>,
  headers: HeadersInit = {},
): Promise<string> {
  const response = await handler(jsonRpcRequest(
    initializePayload(0, capabilities),
    { ...JSON_HEADERS, ...headers },
  ));
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

  it("does not trust caller-supplied identity headers", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let capturedContext:
      | { endUserId?: string; projectId?: string; abortSignal?: AbortSignal }
      | undefined;

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
    const sessionId = await initSession(handler);
    const request = jsonRpcRequest(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test:context", arguments: {} },
      },
      {
        ...JSON_HEADERS,
        "MCP-Session-Id": sessionId,
        "x-end-user-id": "user_123",
        "x-project-id": "proj-abc_123",
      },
    );

    const response = await handler(request);
    assertEquals(response.status, 200);
    assertEquals(capturedContext?.endUserId, undefined);
    assertEquals(capturedContext?.projectId, undefined);
  });

  it("ignores invalid identity headers when building tool context", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let capturedContext:
      | { abortSignal?: AbortSignal; endUserId?: string; projectId?: string }
      | undefined;

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
    const sessionId = await initSession(handler);
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
          "MCP-Session-Id": sessionId,
          "x-end-user-id": "user 123",
          "x-project-id": "proj/abc",
        },
      ),
    );

    assertEquals(response.status, 200);
    assertEquals(capturedContext?.endUserId, undefined);
    assertEquals(capturedContext?.projectId, undefined);
    assertEquals(capturedContext?.abortSignal instanceof AbortSignal, true);
  });

  it("does not allow caller-selected identity headers in CORS preflight", async () => {
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
    assertEquals(allowHeaders.includes("X-End-User-Id"), false);
    assertEquals(allowHeaders.includes("X-Project-Id"), false);
    assertStringIncludes(allowHeaders, "MCP-Protocol-Version");
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
          initializePayload(1),
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
        jsonRpcRequest(initializePayload(1)),
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
          initializePayload(1),
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
          initializePayload(1),
          { ...JSON_HEADERS, Authorization: "Bearer wrong-token" },
        ),
      );

      assertEquals(response.status, 401);
    });

    it("rejects bearer credentials outside the token grammar", async () => {
      let validatorCalls = 0;
      const server = createMCPServer({
        enabled: true,
        auth: {
          type: "bearer",
          validate: async () => {
            validatorCalls++;
            return true;
          },
        },
      });

      const response = await server.createHTTPHandler()(
        jsonRpcRequest(
          initializePayload(1),
          {
            ...JSON_HEADERS,
            Authorization: "Bearer token with spaces",
          },
        ),
      );

      assertEquals(response.status, 401);
      assertEquals(validatorCalls, 0);
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
        jsonRpcRequest(initializePayload(1)),
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

    it("rejects a preflight when request Origin does not match", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true, origins: ["https://allowed.com"] },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        optionsRequest("https://evil.com"),
      );

      assertEquals(response.status, 403);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("rejects non-loopback preflight origins when no origins are configured", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: { enabled: true },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        optionsRequest("https://example.com"),
      );

      assertEquals(response.status, 403);
      assertEquals(response.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("still enforces origin validation when CORS response headers are disabled", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

      const handler = server.createHTTPHandler();
      const response = await handler(
        optionsRequest("https://example.com"),
      );

      assertEquals(response.status, 403);
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
          initializePayload(1),
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
      assertEquals(
        (result.capabilities as Record<string, unknown>).tasks,
        undefined,
      );
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

    it("does not advertise listChanged without a notification-capable transport", async () => {
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
      assertEquals(caps.tools?.listChanged, undefined);
      assertEquals(caps.resources?.listChanged, undefined);
      assertEquals(caps.prompts?.listChanged, undefined);
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
          initializePayload(1),
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
        jsonRpcRequest(initializePayload(1)),
      );

      assertEquals(response.status, 200);
    });

    it("rejects malformed and non-HTTP loopback origins by default", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();

      for (
        const origin of [
          "ftp://localhost",
          "http://localhost/path",
          "http://user@localhost",
        ]
      ) {
        const response = await handler(optionsRequest(origin));
        assertEquals(response.status, 403);
      }
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

  it("responds to the base-protocol ping method", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
    });

    assertEquals(response.error, undefined);
    assertEquals(response.result, {});
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

  it("returns defensive snapshots from tools/list", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const registered = dynamicTool({
      id: "test:snapshotted",
      description: "Snapshotted tool",
      inputSchema: defineSchema((v) => v.object({ value: v.string() }))(),
      execute: async () => ({ ok: true }),
      mcp: {
        annotations: { readOnlyHint: true },
      },
    });
    registerTool("test:snapshotted", registered);

    const firstResponse = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    const first = (firstResponse.result as { tools: ToolListEntry[] }).tools[0]!;
    (first.inputSchema as { type: string }).type = "array";
    first.annotations!.readOnlyHint = false;

    const secondResponse = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    const second = (secondResponse.result as { tools: ToolListEntry[] }).tools[0]!;
    assertEquals((second.inputSchema as { type: string }).type, "object");
    assertEquals(second.annotations, { readOnlyHint: true });
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

  it("declares optional task execution for every listed tool", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });

    registerTool(
      "test:task-capable",
      dynamicTool({
        id: "test:task-capable",
        description: "Task-capable tool",
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
    assertEquals(tools[0]?.execution, { taskSupport: "optional" });
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
      const content = result.content[0];
      assertExists(content);
      assertEquals(content.type, "text");
      assertEquals(JSON.parse(content.text).hello, "world");
    });

    it("serializes tool results without pretty-print amplification", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

      registerTool(
        "test:compact",
        dynamicTool({
          id: "test:compact",
          description: "Compact tool",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: async () => ({ nested: { value: "ok" } }),
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test:compact", arguments: {} },
      });

      const result = response.result as {
        content: { type: string; text: string }[];
      };
      assertEquals(result.content[0]?.text, '{"nested":{"value":"ok"}}');
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
      const content = result.content[0];
      assertExists(content);
      assertEquals(content.text, "tool broke");
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
    it("paginates every supported list endpoint with endpoint-bound cursors", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

      for (let index = 0; index < 51; index++) {
        const suffix = String(index).padStart(2, "0");
        registerTool(
          `test:pagination-${suffix}`,
          dynamicTool({
            id: `test:pagination-${suffix}`,
            description: `Pagination test tool ${suffix}`,
            inputSchema: defineSchema((v) => v.object({}))(),
            execute: async () => ({ ok: true }),
          }),
        );
        registerPrompt(
          `pagination-${suffix}`,
          prompt({
            id: `pagination-${suffix}`,
            description: `Pagination test prompt ${suffix}`,
            content: `Prompt ${suffix}`,
          }),
        );
        registerResource(
          `pagination-resource-${suffix}`,
          resource({
            pattern: `docs://pagination/resource-${suffix}`,
            description: `Pagination test resource ${suffix}`,
            paramsSchema: defineSchema((v) => v.object({}))(),
            load: () => ({ ok: true }),
          }),
        );
        registerResource(
          `pagination-template-${suffix}`,
          resource({
            pattern: `/pagination-template-${suffix}/:id`,
            description: `Pagination test template ${suffix}`,
            paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
            load: () => ({ ok: true }),
          }),
        );
      }

      const endpoints = [
        ["tools/list", "tools"],
        ["prompts/list", "prompts"],
        ["resources/list", "resources"],
        ["resources/templates/list", "resourceTemplates"],
      ] as const;

      let toolsCursor: string | undefined;
      for (const [method, resultKey] of endpoints) {
        const firstResponse = await server.handleRequest({
          jsonrpc: "2.0",
          id: 1,
          method,
        });
        assertEquals(firstResponse.error, undefined);
        const first = firstResponse.result as Record<string, unknown>;
        assertEquals((first[resultKey] as unknown[]).length, 50);
        assertEquals(typeof first.nextCursor, "string");

        const secondResponse = await server.handleRequest({
          jsonrpc: "2.0",
          id: 2,
          method,
          params: { cursor: first.nextCursor },
        });
        assertEquals(secondResponse.error, undefined);
        const second = secondResponse.result as Record<string, unknown>;
        assertEquals((second[resultKey] as unknown[]).length, 1);
        assertEquals(second.nextCursor, undefined);

        if (method === "tools/list") {
          toolsCursor = first.nextCursor as string;
        }
      }

      const foreignCursor = await server.handleRequest({
        jsonrpc: "2.0",
        id: 3,
        method: "prompts/list",
        params: { cursor: toolsCursor },
      });
      assertEquals(foreignCursor.error?.code, -32602);

      const invalidCursor = await server.handleRequest({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
        params: { cursor: "not-an-issued-cursor" },
      });
      assertEquals(invalidCursor.error?.code, -32602);
    });

    it("does not include nextCursor when all results fit", async () => {
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

  describe("resource exposure policy", () => {
    it("excludes templates and MCP-disabled resources from resources/list", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "public",
        resource({
          pattern: "docs://public",
          description: "Public docs",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => ({ ok: true }),
        }),
      );
      registerResource(
        "template",
        resource({
          pattern: "/users/:id",
          description: "User",
          paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
          load: () => ({ ok: true }),
        }),
      );
      registerResource(
        "disabled",
        resource({
          pattern: "docs://disabled",
          description: "Disabled docs",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => ({ secret: true }),
          mcp: { enabled: false },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
      });

      const result = response.result as {
        resources: Array<{ name: string }>;
      };
      assertEquals(result.resources.map(({ name }) => name), ["public"]);
    });

    it("excludes MCP-disabled resources from resources/templates/list", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "disabled-template",
        resource({
          pattern: "/private/:id",
          description: "Private resource",
          paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
          load: () => ({ secret: true }),
          mcp: { enabled: false },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/templates/list",
      });

      assertEquals(
        (response.result as { resourceTemplates: unknown[] }).resourceTemplates,
        [],
      );
    });

    it("treats MCP-disabled and missing resources as not found", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "disabled",
        resource({
          pattern: "docs://disabled",
          description: "Disabled docs",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => ({ secret: true }),
          mcp: { enabled: false },
        }),
      );

      for (const uri of ["docs://disabled", "docs://missing"]) {
        const response = await server.handleRequest({
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri },
        });
        assertEquals(response.error?.code, -32002);
        assertStringIncludes(response.error?.message ?? "", "Resource not found");
      }
    });

    it("maps malformed encoded resource params to invalid params", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "user",
        resource({
          pattern: "/users/:id",
          description: "User",
          paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
          load: ({ id }) => ({ id }),
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "/users/%E0%A4%A" },
      });

      assertEquals(response.error?.code, -32602);
      assertEquals(
        response.error?.message,
        'Resource URI has invalid percent-encoding for parameter "id"',
      );
    });

    it("keeps query and fragment variants distinct from a path template", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "user",
        resource({
          pattern: "/users/:id",
          description: "User",
          paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
          load: ({ id }) => ({ id }),
        }),
      );

      for (const uri of ["/users/42?view=full", "/users/42#profile"]) {
        const response = await server.handleRequest({
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri },
        });
        assertEquals(response.error?.code, -32002);
        assertEquals(response.error?.message, `Resource not found: ${uri}`);
      }
    });

    it("rejects malformed resource URIs before invoking a loader", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      let loadCalls = 0;
      registerResource(
        "bounded-user",
        resource({
          pattern: "/bounded-users/:id",
          description: "Bounded user",
          paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
          load: ({ id }) => {
            loadCalls += 1;
            return { id };
          },
        }),
      );

      for (
        const uri of [
          "/bounded-users/raw value",
          `/bounded-users/${"x".repeat(8 * 1024)}`,
        ]
      ) {
        const response = await server.handleRequest({
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri },
        });
        assertEquals(response.error?.code, -32602);
        assertStringIncludes(response.error?.message ?? "", "Resource URI");
      }
      assertEquals(loadCalls, 0);
    });

    it("lists and reads explicitly configured text content", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "readme",
        resource({
          pattern: "docs://readme",
          description: "README",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => "# Project\n",
          mcp: {
            content: { type: "text", mimeType: "text/markdown" },
          },
        }),
      );

      const listed = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
      });
      const entry = (
        listed.result as {
          resources: Array<Record<string, unknown>>;
        }
      ).resources.find(({ name }) => name === "readme");
      assertEquals(entry?.mimeType, "text/markdown");

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "docs://readme" },
      });
      assertEquals(response.result, {
        contents: [{
          uri: "docs://readme",
          mimeType: "text/markdown",
          text: "# Project\n",
        }],
      });
    });

    it("lists and reads explicitly configured binary content", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "pixel",
        resource({
          pattern: "asset://pixel",
          description: "Pixel",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => new Uint8Array([0, 255, 128]),
          mcp: {
            content: { type: "blob", mimeType: "image/png" },
          },
        }),
      );

      const listed = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/list",
      });
      const entry = (
        listed.result as {
          resources: Array<Record<string, unknown>>;
        }
      ).resources.find(({ name }) => name === "pixel");
      assertEquals(entry?.mimeType, "image/png");

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/read",
        params: { uri: "asset://pixel" },
      });
      assertEquals(response.result, {
        contents: [{
          uri: "asset://pixel",
          mimeType: "image/png",
          blob: "AP+A",
        }],
      });
    });

    it("rejects content that does not match its declared transport mode", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "invalid-text",
        resource({
          pattern: "docs://invalid-text",
          description: "Invalid text",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => ({ text: "not a string" }),
          mcp: {
            content: { type: "text", mimeType: "text/plain" },
          },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "docs://invalid-text" },
      });

      assertEquals(response.error?.code, -32603);
      assertEquals(
        response.error?.message,
        'Resource "invalid-text" returned invalid text content',
      );
    });

    it("rejects oversized text content before transport encoding", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "oversized-text",
        resource({
          pattern: "docs://oversized-text",
          description: "Oversized text",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => "x".repeat(4 * 1024 * 1024 + 1),
          mcp: {
            content: { type: "text", mimeType: "text/plain" },
          },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "docs://oversized-text" },
      });

      assertEquals(response.error?.code, -32603);
      assertEquals(
        response.error?.message,
        'Resource "oversized-text" returned invalid text content',
      );
    });

    it("propagates MCP cancellation to a pending resource loader", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const started = Promise.withResolvers<void>();
      let receivedSignal: AbortSignal | undefined;
      registerResource(
        "pending-resource",
        resource({
          pattern: "docs://pending",
          description: "Pending resource",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: (_params, context) => {
            receivedSignal = context?.abortSignal;
            started.resolve();
            return new Promise<Record<string, never>>(() => {});
          },
        }),
      );

      const pending = server.handleRequest({
        jsonrpc: "2.0",
        id: 73,
        method: "resources/read",
        params: { uri: "docs://pending" },
      });
      await started.promise;
      await server.handleRequest({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 73 },
      });
      const response = await pending;

      assertEquals(receivedSignal?.aborted, true);
      assertEquals(response.error?.code, -32603);
      assertEquals(
        response.error?.message,
        'Resource "pending-resource" could not be loaded',
      );
    });

    it("rejects non-JSON resource output with a stable transport error", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "invalid-output",
        resource({
          pattern: "docs://invalid-output",
          description: "Invalid output",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => undefined,
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "docs://invalid-output" },
      });

      assertEquals(response.error?.code, -32603);
      assertEquals(
        response.error?.message,
        'Resource "invalid-output" returned data that is not bounded JSON',
      );
    });

    it("maps resource schema rejection to invalid params without schema details", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "numeric-user",
        resource({
          pattern: "/numeric-users/:id",
          description: "Numeric user",
          paramsSchema: defineSchema((v) => v.object({ id: v.number() }))(),
          load: ({ id }) => ({ id }),
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "/numeric-users/not-a-number" },
      });

      assertEquals(response.error?.code, -32602);
      assertEquals(
        response.error?.message,
        'Resource URI does not satisfy parameters for "numeric-user"',
      );
    });

    it("does not disclose resource loader failures", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerResource(
        "failing-resource",
        resource({
          pattern: "docs://failing-resource",
          description: "Fail safely",
          paramsSchema: defineSchema((v) => v.object({}))(),
          load: () => {
            throw new Error("SECRET_SENTINEL database response");
          },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "resources/read",
        params: { uri: "docs://failing-resource" },
      });

      assertEquals(response.error?.code, -32603);
      assertEquals(
        response.error?.message,
        'Resource "failing-resource" could not be loaded',
      );
    });
  });

  describe("prompt retrieval", () => {
    it("lists MCP prompt title and argument metadata", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerPrompt(
        "welcome",
        prompt({
          id: "welcome",
          description: "Welcome a named user",
          content: "Hello {name}",
          mcp: {
            title: "Welcome",
            arguments: [{
              name: "name",
              title: "Display name",
              description: "Name to greet",
              required: true,
            }],
          },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/list",
      });

      assertEquals(response.result, {
        prompts: [{
          name: "welcome",
          title: "Welcome",
          description: "Welcome a named user",
          arguments: [{
            name: "name",
            title: "Display name",
            description: "Name to greet",
            required: true,
          }],
        }],
      });
    });

    it("hides MCP-disabled prompts from list and direct retrieval", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerPrompt(
        "private",
        prompt({
          id: "private",
          description: "Private prompt",
          content: "secret",
          mcp: { enabled: false },
        }),
      );

      const listed = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/list",
      });
      const retrieved = await server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "prompts/get",
        params: { name: "private" },
      });

      assertEquals(listed.result, { prompts: [] });
      assertEquals(retrieved.error?.code, -32602);
      assertEquals(retrieved.error?.message, "Unknown prompt: private");
    });

    it("returns the configured prompt description", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerPrompt(
        "welcome",
        prompt({
          id: "welcome",
          description: "Welcome a named user",
          content: "Hello {name}",
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "welcome", arguments: { name: "Ada" } },
      });

      const result = response.result as {
        description: string;
        messages: Array<{ content: { text: string } }>;
      };
      assertEquals(result.description, "Welcome a named user");
      assertEquals(result.messages[0]?.content.text, "Hello Ada");
    });

    it("enforces declared required prompt arguments", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerPrompt(
        "welcome",
        prompt({
          id: "welcome",
          description: "Welcome",
          content: "Hello {name}",
          mcp: { arguments: [{ name: "name", required: true }] },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "welcome", arguments: {} },
      });

      assertEquals(response.error?.code, -32602);
      assertEquals(response.error?.message, 'Missing required prompt argument: "name"');
    });

    it("rejects undeclared prompt arguments when metadata declares the contract", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerPrompt(
        "welcome",
        prompt({
          id: "welcome",
          description: "Welcome",
          content: "Hello {name}",
          mcp: { arguments: [{ name: "name" }] },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "welcome", arguments: { unexpected: "value" } },
      });

      assertEquals(response.error?.code, -32602);
      assertEquals(response.error?.message, 'Unknown prompt argument: "unexpected"');
    });

    it("rejects non-string prompt argument values required by MCP", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerPrompt(
        "welcome",
        prompt({
          id: "welcome",
          description: "Welcome",
          content: "Hello {name}",
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "welcome", arguments: { name: 42 } },
      });

      assertEquals(response.error?.code, -32602);
      assertEquals(response.error?.message, 'Prompt argument "name" must be a string');
    });

    it("propagates MCP cancellation to a pending prompt generator", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const started = Promise.withResolvers<void>();
      let receivedSignal: AbortSignal | undefined;
      registerPrompt(
        "pending",
        prompt({
          id: "pending",
          description: "Pending",
          generate: (_variables, context) => {
            receivedSignal = context?.abortSignal;
            started.resolve();
            return new Promise<string>(() => {});
          },
        }),
      );

      const pending = server.handleRequest({
        jsonrpc: "2.0",
        id: 42,
        method: "prompts/get",
        params: { name: "pending" },
      });
      await started.promise;
      await server.handleRequest({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 42 },
      });
      const response = await pending;

      assertEquals(receivedSignal?.aborted, true);
      assertEquals(response.error?.code, -32603);
      assertEquals(response.error?.message, 'Prompt "pending" could not be rendered');
    });

    it("rejects non-object prompt arguments", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerPrompt(
        "welcome",
        prompt({
          id: "welcome",
          description: "Welcome",
          content: "Hello",
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "welcome", arguments: ["unexpected"] },
      });

      assertEquals(response.error?.code, -32602);
      assertEquals(response.error?.message, "Prompt arguments must be an object");
    });

    it("returns invalid params for an unknown prompt", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "missing" },
      });

      assertEquals(response.error?.code, -32602);
      assertEquals(response.error?.message, "Unknown prompt: missing");
    });

    it("does not disclose prompt generator failures", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerPrompt(
        "failing",
        prompt({
          id: "failing",
          description: "Fail safely",
          generate: () => {
            throw new Error("SECRET_SENTINEL provider response");
          },
        }),
      );

      const response = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "prompts/get",
        params: { name: "failing" },
      });

      assertEquals(response.error?.code, -32603);
      assertEquals(
        response.error?.message,
        'Prompt "failing" could not be rendered',
      );
    });

    it("rejects non-string and oversized prompt output", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      registerPrompt(
        "non-string",
        {
          id: "non-string",
          description: "Invalid output",
          getContent: () => Promise.resolve(42 as unknown as string),
        },
      );
      registerPrompt(
        "oversized",
        prompt({
          id: "oversized",
          description: "Oversized output",
          generate: () => Promise.resolve("x".repeat(4 * 1024 * 1024 + 1)),
        }),
      );

      for (const name of ["non-string", "oversized"]) {
        const response = await server.handleRequest({
          jsonrpc: "2.0",
          id: name,
          method: "prompts/get",
          params: { name },
        });
        assertEquals(response.error?.code, -32603);
        assertEquals(
          response.error?.message,
          `Prompt "${name}" returned invalid content`,
        );
      }
    });
  });

  it("does not advertise unimplemented completion or logging capabilities", async () => {
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
    assertEquals(caps.completions, undefined);
    assertEquals(caps.logging, undefined);
  });

  it("does not advertise unsupported resource subscriptions", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });

    const capabilities = (response.result as {
      capabilities: { resources: Record<string, unknown> };
    }).capabilities;
    assertEquals(capabilities.resources.subscribe, undefined);
    assertEquals(capabilities.resources.listChanged, undefined);
  });

  it("rejects completion requests while completion is not implemented", async () => {
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
    assertEquals(result.error?.code, -32601);
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

  it("snapshots client capabilities supplied to initialize", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const capabilities: {
      elicitation: {
        form?: Record<string, never>;
        url?: Record<string, never>;
      };
    } = { elicitation: { form: {} } };
    await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities,
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    capabilities.elicitation = { url: {} };

    assertEquals(server.clientSupportsElicitation("form"), true);
    assertEquals(server.clientSupportsElicitation("url"), false);
  });

  it("reports malformed client capabilities as invalid params", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: [],
        clientInfo: { name: "test", version: "1.0" },
      },
    });

    assertEquals(response.error?.code, -32602);
  });

  it("advertises list-change notifications only for a wired custom transport", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    server.onNotification = () => {};

    const response = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0" },
      },
    });
    const capabilities = (response.result as {
      capabilities: Record<string, Record<string, unknown>>;
    }).capabilities;
    assertEquals(capabilities.tools?.listChanged, true);
    assertEquals(capabilities.resources?.listChanged, true);
    assertEquals(capabilities.prompts?.listChanged, true);
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
      assertEquals(allowMethods.includes("GET"), false);
    });

    it("does not treat an HTTP disconnect as MCP cancellation", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const started = Promise.withResolvers<void>();
      registerTool(
        "test:http-abort",
        dynamicTool({
          id: "test:http-abort",
          description: "HTTP disconnect isolation",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: (_input, context) =>
            new Promise((resolve) => {
              const fallback = setTimeout(() => resolve({ aborted: false }), 20);
              context?.abortSignal?.addEventListener("abort", () => {
                clearTimeout(fallback);
                resolve({ aborted: true });
              }, { once: true });
              started.resolve();
            }),
        }),
      );
      const handler = server.createHTTPHandler();
      const sessionId = await initSession(handler);
      const controller = new AbortController();
      const responsePromise = handler(
        new Request(MCP_URL, {
          method: "POST",
          headers: {
            ...JSON_HEADERS,
            "MCP-Session-Id": sessionId,
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 91,
            method: "tools/call",
            params: { name: "test:http-abort", arguments: {} },
          }),
          signal: controller.signal,
        }),
      );
      await started.promise;
      controller.abort();

      const body = await (await responsePromise).json() as {
        result: { content: Array<{ text: string }> };
      };
      assertEquals(JSON.parse(body.result.content[0]!.text), {
        aborted: false,
      });
    });

    it("aborts in-flight foreground work when its session is deleted", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const started = Promise.withResolvers<void>();
      registerTool(
        "test:session-delete-abort",
        dynamicTool({
          id: "test:session-delete-abort",
          description: "Session deletion abort propagation",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: (_input, context) =>
            new Promise((resolve) => {
              const fallback = setTimeout(() => resolve({ aborted: false }), 100);
              context?.abortSignal?.addEventListener("abort", () => {
                clearTimeout(fallback);
                resolve({ aborted: true });
              }, { once: true });
              started.resolve();
            }),
        }),
      );
      const handler = server.createHTTPHandler();
      const sessionId = await initSession(handler);
      const responsePromise = handler(jsonRpcRequest(
        {
          jsonrpc: "2.0",
          id: 92,
          method: "tools/call",
          params: {
            name: "test:session-delete-abort",
            arguments: {},
          },
        },
        {
          ...JSON_HEADERS,
          "MCP-Session-Id": sessionId,
          "MCP-Protocol-Version": "2025-11-25",
        },
      ));
      await started.promise;

      const deleted = await handler(deleteSessionRequest(sessionId, {
        "MCP-Protocol-Version": "2025-11-25",
      }));
      assertEquals(deleted.status, 200);

      const body = await (await responsePromise).json() as {
        result: { content: Array<{ text: string }> };
      };
      assertEquals(JSON.parse(body.result.content[0]!.text), {
        aborted: true,
      });
    });

    it("requires a new initialization after all sessions are terminated", async () => {
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

      // Operation requests never become stateless again after termination.
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      assertEquals(response.status, 400);
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
    assertEquals(caps.logging, undefined);
  });

  it("does not expose task augmentation to a 2024-11-05 session", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:legacy-tool",
      dynamicTool({
        id: "test:legacy-tool",
        description: "Legacy protocol tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => ({ legacy: true }),
      }),
    );
    const handler = server.createHTTPHandler();
    const initializeResponse = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "legacy", version: "1.0" },
      },
    }));
    const sessionId = initializeResponse.headers.get("MCP-Session-Id");
    assertExists(sessionId);
    const headers = { ...JSON_HEADERS, "MCP-Session-Id": sessionId };

    const listResponse = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }, headers));
    const listBody = await listResponse.json() as {
      result: { tools: ToolListEntry[] };
    };
    assertEquals(listBody.result.tools[0]?.execution, undefined);

    const callResponse = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "test:legacy-tool",
        arguments: {},
        task: "unsupported metadata must be ignored",
      },
    }, headers));
    const callBody = await callResponse.json() as {
      result: { task?: unknown; isError?: boolean };
    };
    assertEquals(callBody.result.task, undefined);
    assertEquals(callBody.result.isError, false);

    const tasksResponse = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tasks/list",
    }, headers));
    assertEquals(
      (await tasksResponse.json() as { error?: { code: number } }).error?.code,
      -32601,
    );
  });

  it("rejects logging/setLevel while client log delivery is not implemented", async () => {
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
    assertEquals(result.error?.code, -32601);
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

  it("aborts an in-flight foreground tool when notifications/cancelled names its request", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let resolveStarted!: () => void;
    let resolveAbort!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const abortObserved = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });

    registerTool(
      "test:foreground-abortable",
      dynamicTool({
        id: "test:foreground-abortable",
        description: "Foreground abortable tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: (_input, context) =>
          new Promise((resolve) => {
            resolveStarted();
            context?.abortSignal?.addEventListener("abort", () => {
              resolveAbort();
              resolve({ aborted: true });
            });
            setTimeout(() => resolve({ aborted: false }), 200);
          }),
      }),
    );

    const call = server.handleRequest({
      jsonrpc: "2.0",
      id: 77,
      method: "tools/call",
      params: { name: "test:foreground-abortable", arguments: {} },
    });
    await started;

    await server.handleRequest({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 77, reason: "User cancelled" },
    });

    await Promise.race([
      abortObserved,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("cancel did not abort foreground tool execution")), 50)
      ),
    ]);

    const response = await call;
    const result = response.result as { content: Array<{ text: string }> };
    assertEquals(JSON.parse(result.content[0]!.text), {
      aborted: true,
    });
  });

  it("scopes foreground request cancellation to the HTTP session", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const handler = server.createHTTPHandler();
    const sessionA = await initSession(handler);
    const sessionB = await initSession(handler);

    let resolveStartedA!: () => void;
    let resolveStartedB!: () => void;
    let resolveCallB!: () => void;
    let resolveAbortB!: () => void;
    const startedA = new Promise<void>((resolve) => {
      resolveStartedA = resolve;
    });
    const startedB = new Promise<void>((resolve) => {
      resolveStartedB = resolve;
    });
    const abortB = new Promise<void>((resolve) => {
      resolveAbortB = resolve;
    });

    registerTool(
      "test:session-scoped-abort",
      dynamicTool({
        id: "test:session-scoped-abort",
        description: "Session-scoped abortable tool",
        inputSchema: defineSchema((v) => v.object({ label: v.string() }))(),
        execute: (input, context) =>
          new Promise((resolve) => {
            const { label } = input as { label: "a" | "b" };
            if (label === "a") {
              resolveStartedA();
            } else {
              resolveStartedB();
              resolveCallB = () => resolve({ label, aborted: false });
            }
            context?.abortSignal?.addEventListener(
              "abort",
              () => {
                if (label === "b") resolveAbortB();
                resolve({ label, aborted: true });
              },
              { once: true },
            );
          }),
      }),
    );

    const headersA = { ...JSON_HEADERS, "MCP-Session-Id": sessionA };
    const headersB = { ...JSON_HEADERS, "MCP-Session-Id": sessionB };
    const callA = handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:session-scoped-abort", arguments: { label: "a" } },
    }, headersA));
    const callB = handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:session-scoped-abort", arguments: { label: "b" } },
    }, headersB));
    await Promise.all([startedA, startedB]);

    await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 1, reason: "User cancelled session A request" },
    }, headersA));

    const responseA = await callA;
    const bodyA = await responseA.json() as { result: { content: Array<{ text: string }> } };
    const resultA = JSON.parse(bodyA.result.content[0]!.text) as {
      label: string;
      aborted: boolean;
    };
    assertEquals(resultA, { label: "a", aborted: true });

    const sessionBAborted = await Promise.race([
      abortB.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
    ]);
    assertEquals(sessionBAborted, false);

    resolveCallB();
    const responseB = await callB;
    const bodyB = await responseB.json() as { result: { content: Array<{ text: string }> } };
    const resultB = JSON.parse(bodyB.result.content[0]!.text) as {
      label: string;
      aborted: boolean;
    };
    assertEquals(resultB, { label: "b", aborted: false });
  });

  it("rejects duplicate in-flight request IDs without replacing cancellation state", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let calls = 0;
    let resolveStarted!: () => void;
    let resolveFirst!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });

    registerTool(
      "test:duplicate-request",
      dynamicTool({
        id: "test:duplicate-request",
        description: "Detect duplicate requests",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => {
          calls++;
          if (calls > 1) return { duplicateRan: true };
          resolveStarted();
          return new Promise((resolve) => {
            resolveFirst = () => resolve({ duplicateRan: false });
          });
        },
      }),
    );

    const first = server.handleRequest({
      jsonrpc: "2.0",
      id: 91,
      method: "tools/call",
      params: { name: "test:duplicate-request", arguments: {} },
    });
    await started;
    const duplicate = await server.handleRequest({
      jsonrpc: "2.0",
      id: 91,
      method: "tools/call",
      params: { name: "test:duplicate-request", arguments: {} },
    });
    resolveFirst();
    await first;

    assertEquals(duplicate.error?.code, -32600);
    assertEquals(calls, 1);
  });

  it("does not partially implement logging/setLevel validation", async () => {
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
    assertEquals(result.error?.code, -32601);
  });

  it("rejects malformed task augmentation metadata", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:task-validation",
      dynamicTool({
        id: "test:task-validation",
        description: "Task validation tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => ({ ok: true }),
      }),
    );

    for (
      const task of [
        "task",
        [],
        { ttl: 0 },
        { ttl: -1 },
        { ttl: 1.5 },
        { ttl: Number.NaN },
        { ttl: Number.POSITIVE_INFINITY },
        { ttl: "60000" },
      ]
    ) {
      const result = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "test:task-validation", arguments: {}, task },
      });
      assertEquals(result.error?.code, -32602);
    }
  });

  it("reports task admission pressure as a bounded server error", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:task-capacity",
      dynamicTool({
        id: "test:task-capacity",
        description: "Keeps task slots active for admission testing",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: (_input, context) =>
          new Promise((resolve) => {
            const finish = () => resolve({ stopped: true });
            if (context?.abortSignal?.aborted) {
              finish();
            } else {
              context?.abortSignal?.addEventListener("abort", finish, {
                once: true,
              });
            }
          }),
      }),
    );
    const handler = server.createHTTPHandler();
    const sessionId = await initSession(handler);
    const headers = {
      ...JSON_HEADERS,
      "MCP-Session-Id": sessionId,
      "MCP-Protocol-Version": "2025-11-25",
    };

    for (let index = 0; index < 100; index++) {
      const accepted = await handler(jsonRpcRequest({
        jsonrpc: "2.0",
        id: index,
        method: "tools/call",
        params: {
          name: "test:task-capacity",
          arguments: {},
          task: { ttl: 60_000 },
        },
      }, headers));
      assertEquals(accepted.status, 200);
    }

    const rejected = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: {
        name: "test:task-capacity",
        arguments: {},
        task: { ttl: 60_000 },
      },
    }, headers));
    const body = await rejected.json() as {
      error: { code: number; message: string };
    };
    assertEquals(body.error.code, -32000);
    assertEquals(body.error.message, "Task capacity reached");

    await handler(deleteSessionRequest(sessionId, {
      "MCP-Protocol-Version": "2025-11-25",
    }));
    await server.waitForPendingTasks();
  });

  it("keeps a task running when its originating HTTP request disconnects", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    registerTool(
      "test:task-disconnect",
      dynamicTool({
        id: "test:task-disconnect",
        description: "Task disconnect isolation",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: (_input, context) =>
          new Promise((resolve) => {
            context?.abortSignal?.addEventListener("abort", () => {
              aborted.resolve();
              resolve({ stopped: true });
            }, { once: true });
            started.resolve();
          }),
      }),
    );
    const handler = server.createHTTPHandler();
    const sessionId = await initSession(handler);
    const headers = {
      ...JSON_HEADERS,
      "MCP-Session-Id": sessionId,
      "MCP-Protocol-Version": "2025-11-25",
    };
    const controller = new AbortController();
    const taskResponse = await handler(
      new Request(MCP_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "test:task-disconnect",
            arguments: {},
            task: { ttl: 60_000 },
          },
        }),
        signal: controller.signal,
      }),
    );
    const taskBody = await taskResponse.json() as {
      result: { task: { taskId: string } };
    };
    await started.promise;
    controller.abort();

    const abortedOnDisconnect = await Promise.race([
      aborted.promise.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    assertEquals(abortedOnDisconnect, false);

    const cancelResponse = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/cancel",
      params: { taskId: taskBody.result.task.taskId },
    }, headers));
    assertEquals(cancelResponse.status, 200);
    await aborted.promise;
    await server.waitForPendingTasks();
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

  it("tasks/cancel aborts the in-flight async tool", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let resolveAbort!: () => void;
    const abortObserved = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });
    registerTool(
      "test:abortable",
      dynamicTool({
        id: "test:abortable",
        description: "Abortable tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: (_input, context) =>
          new Promise((resolve) => {
            const fallbackTimer = setTimeout(
              () => resolve({ aborted: false }),
              200,
            );
            context?.abortSignal?.addEventListener("abort", () => {
              clearTimeout(fallbackTimer);
              resolveAbort();
              resolve({ aborted: true });
            });
          }),
      }),
    );
    const createResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:abortable", arguments: {}, task: { ttl: 60000 } },
    });
    const taskId = (createResult.result as { task: { taskId: string } }).task.taskId;

    await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/cancel",
      params: { taskId },
    });

    let timeout: number | undefined;
    try {
      await Promise.race([
        abortObserved,
        new Promise((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("cancel did not abort tool execution")),
            50,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    await server.waitForPendingTasks();

    const getResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tasks/get",
      params: { taskId },
    });
    assertEquals((getResult.result as Record<string, unknown>).status, "cancelled");
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
    const payload = resultResp.result as {
      content: { text: string }[];
      isError: boolean;
      _meta: Record<string, unknown>;
    };
    assertEquals(payload.isError, false);
    assertExists(payload.content);
    assertEquals(payload._meta["io.modelcontextprotocol/related-task"], {
      taskId,
    });
  });

  it("tasks/result blocks until the task reaches a terminal state", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let finish!: () => void;
    registerTool(
      "test:slow4",
      dynamicTool({
        id: "test:slow4",
        description: "Slow tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () =>
          new Promise((resolve) => {
            finish = () => resolve({ done: true });
          }),
      }),
    );
    const createResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "test:slow4", arguments: {}, task: { ttl: 60000 } },
    });
    const taskId = (createResult.result as { task: { taskId: string } }).task.taskId;
    const pendingResult = server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/result",
      params: { taskId },
    });

    const settledEarly = await Promise.race([
      pendingResult.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    assertEquals(settledEarly, false);

    finish();
    const resultResp = await pendingResult;
    assertEquals(resultResp.error, undefined);
    assertEquals(
      (resultResp.result as {
        _meta: Record<string, unknown>;
      })._meta["io.modelcontextprotocol/related-task"],
      { taskId },
    );
    await server.waitForPendingTasks();
  });

  it("cancels a blocked tasks/result request without cancelling its task", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    let finish!: () => void;
    registerTool(
      "test:cancel-result-wait",
      dynamicTool({
        id: "test:cancel-result-wait",
        description: "Cancelable result waiter",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () =>
          new Promise((resolve) => {
            finish = () => resolve({ done: true });
          }),
      }),
    );
    const createResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "test:cancel-result-wait",
        arguments: {},
        task: { ttl: 60_000 },
      },
    });
    const taskId = (createResult.result as { task: { taskId: string } }).task.taskId;
    const waiting = server.handleRequest({
      jsonrpc: "2.0",
      id: 77,
      method: "tasks/result",
      params: { taskId },
    });
    await Promise.resolve();
    await server.handleRequest({
      jsonrpc: "2.0",
      method: "notifications/cancelled",
      params: { requestId: 77 },
    });

    const cancelledWait = await waiting;
    assertEquals(cancelledWait.error?.code, -32603);

    const status = await server.handleRequest({
      jsonrpc: "2.0",
      id: 78,
      method: "tasks/get",
      params: { taskId },
    });
    assertEquals((status.result as { status: string }).status, "working");

    finish();
    await server.waitForPendingTasks();
    const completed = await server.handleRequest({
      jsonrpc: "2.0",
      id: 79,
      method: "tasks/result",
      params: { taskId },
    });
    assertEquals(completed.error, undefined);
  });

  it("async tool failure preserves a retrievable tool error result", async () => {
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

    const resultResponse = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tasks/result",
      params: { taskId },
    });
    const failedResult = resultResponse.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
      _meta: Record<string, unknown>;
    };
    assertEquals(failedResult.isError, true);
    assertEquals(failedResult.content, [
      { type: "text", text: "tool broke" },
    ]);
    assertEquals(failedResult._meta["io.modelcontextprotocol/related-task"], {
      taskId,
    });
  });

  it("bounds and sanitizes async tool failures before task storage", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    const secret = "mcp-secret";
    registerTool(
      "test:oversized-failure",
      dynamicTool({
        id: "test:oversized-failure",
        description: "Oversized failing tool",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => {
          throw new Error(
            `https://user:${secret}@example.com/${"x".repeat(1_100_000)}`,
          );
        },
      }),
    );

    const createResult = await server.handleRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "test:oversized-failure",
        arguments: {},
        task: { ttl: 60_000 },
      },
    });
    const taskId = (createResult.result as { task: { taskId: string } }).task.taskId;
    await server.waitForPendingTasks();

    const statusResponse = await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/get",
      params: { taskId },
    });
    const task = statusResponse.result as {
      status: string;
      statusMessage: string;
    };
    assertEquals(task.status, "failed");
    assertEquals(task.statusMessage.includes(secret), false);
    assertEquals(task.statusMessage.length < 10_000, true);

    const resultResponse = await server.handleRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tasks/result",
      params: { taskId },
    });
    const failedResult = resultResponse.result as {
      content: Array<{ type: string; text: string }>;
      isError: boolean;
    };
    assertEquals(failedResult.isError, true);
    assertEquals(failedResult.content[0]?.text.includes(secret), false);
    assertEquals((failedResult.content[0]?.text.length ?? 10_000) < 10_000, true);
  });

  it("isolates task access and listings between HTTP sessions", async () => {
    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    registerTool(
      "test:scoped-task",
      dynamicTool({
        id: "test:scoped-task",
        description: "Session-scoped task",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: async () => ({ ok: true }),
      }),
    );
    const handler = server.createHTTPHandler();
    const sessionA = await initSession(handler);
    const sessionB = await initSession(handler);
    const headersA = { ...JSON_HEADERS, "MCP-Session-Id": sessionA };
    const headersB = { ...JSON_HEADERS, "MCP-Session-Id": sessionB };

    const createResponse = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "test:scoped-task",
        arguments: {},
        task: { ttl: 60_000 },
      },
    }, headersA));
    const createBody = await createResponse.json() as {
      result: { task: { taskId: string } };
    };
    const taskId = createBody.result.task.taskId;
    await server.waitForPendingTasks();

    const crossSessionGet = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/get",
      params: { taskId },
    }, headersB));
    const crossSessionBody = await crossSessionGet.json() as {
      error?: { code: number };
    };
    assertEquals(crossSessionBody.error?.code, -32602);

    const listA = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tasks/list",
    }, headersA));
    const listB = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tasks/list",
    }, headersB));
    assertEquals(
      (await listA.json() as { result: { tasks: Array<{ taskId: string }> } })
        .result.tasks.map((task) => task.taskId),
      [taskId],
    );
    assertEquals(
      (await listB.json() as { result: { tasks: unknown[] } }).result.tasks,
      [],
    );
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
      assertEquals(notifications[0]!.method, "notifications/tools/list_changed");
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
      assertEquals(notifications[0]!.method, "notifications/resources/list_changed");
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
      assertEquals(notifications[0]!.method, "notifications/prompts/list_changed");
    });

    it("does not throw when onNotification is not set", () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      server.notifyToolsChanged(); // should not throw
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

    it("rejects a non-function bearer validator at construction", () => {
      assertThrows(
        () =>
          createMCPServer({
            enabled: true,
            auth: { type: "bearer", validate: "yes" },
          } as never),
        Error,
        "MCP bearer auth validate must be a function",
      );
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

    it("binds an HTTP session to the bearer credential that created it", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: {
          type: "bearer",
          validate: async (token: string) => token === "token-a" || token === "token-b",
        },
      });
      const handler = server.createHTTPHandler();
      const initialized = await handler(jsonRpcRequest(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test", version: "1.0" },
          },
        },
        { ...JSON_HEADERS, Authorization: "Bearer token-a" },
      ));
      const sessionId = initialized.headers.get("MCP-Session-Id");
      assertExists(sessionId);

      const wrongCredential = await handler(jsonRpcRequest(
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        {
          ...JSON_HEADERS,
          Authorization: "Bearer token-b",
          "MCP-Session-Id": sessionId,
        },
      ));
      assertEquals(wrongCredential.status, 404);

      const originalCredential = await handler(jsonRpcRequest(
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        {
          ...JSON_HEADERS,
          Authorization: "Bearer token-a",
          "MCP-Session-Id": sessionId,
        },
      ));
      assertEquals(originalCredential.status, 200);
    });

    it("http-transport: none + allowUnauthenticated accepts requests", async () => {
      const server = createMCPServer({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const handler = server.createHTTPHandler();
      const res = await handler(
        jsonRpcRequest(initializePayload(1)),
      );
      assertEquals(res.status, 200);
    });
  });

  describe("server configuration boundary", () => {
    it("snapshots auth and CORS configuration at construction", async () => {
      const origins = ["https://allowed.example"];
      const auth = {
        type: "bearer" as const,
        validate: async (token: string) => token === "valid",
      };
      const server = createMCPServer({
        enabled: true,
        auth,
        cors: { enabled: true, origins },
      });

      auth.validate = async () => true;
      origins[0] = "https://attacker.example";
      const handler = server.createHTTPHandler();

      const allowed = await handler(jsonRpcRequest(
        initializePayload(1),
        {
          ...JSON_HEADERS,
          Origin: "https://allowed.example",
          Authorization: "Bearer valid",
        },
      ));
      assertEquals(allowed.status, 200);

      const mutatedOrigin = await handler(jsonRpcRequest(
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        {
          ...JSON_HEADERS,
          Origin: "https://attacker.example",
          Authorization: "Bearer valid",
        },
      ));
      assertEquals(mutatedOrigin.status, 403);

      const mutatedValidator = await handler(jsonRpcRequest(
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        {
          ...JSON_HEADERS,
          Origin: "https://allowed.example",
          Authorization: "Bearer invalid",
        },
      ));
      assertEquals(mutatedValidator.status, 401);
    });

    it("rejects malformed runtime configuration", () => {
      for (
        const config of [
          {
            enabled: "yes",
            auth: { type: "none", allowUnauthenticated: true },
          },
          {
            enabled: true,
            auth: { type: "none", allowUnauthenticated: true },
            cors: { enabled: "yes" },
          },
          {
            enabled: true,
            auth: { type: "none", allowUnauthenticated: true },
            port: 65_536,
          },
        ]
      ) {
        assertThrows(
          () => createMCPServer(config as never),
          Error,
          "MCP",
        );
      }
    });

    it("keeps a disabled server off both direct and HTTP surfaces", async () => {
      const server = createMCPServer({
        enabled: false,
        auth: { type: "none", allowUnauthenticated: true },
      });
      const direct = await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      assertEquals(direct.error?.code, -32601);

      const response = await server.createHTTPHandler()(jsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }));
      assertEquals(response.status, 404);
    });
  });
});
