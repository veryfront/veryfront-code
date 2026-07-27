import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMCPHTTPHandler, type MCPHTTPTransportDependencies } from "./http-transport.ts";
import { SessionManager } from "./session.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonRpcRequest(
  payload: unknown,
  headers: HeadersInit = JSON_HEADERS,
): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

function transportDependencies(
  overrides: Partial<MCPHTTPTransportDependencies> = {},
): MCPHTTPTransportDependencies {
  return {
    authEnabled: false,
    getCORSHeaders: () => ({}),
    validateAuth: async () => true,
    getAuthBinding: async () => "test-auth-binding",
    handleRequest: async (request) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: request.method === "initialize" ? { protocolVersion: "2025-11-25" } : {},
    }),
    extractRequestContext: () => undefined,
    isOriginAllowed: () => true,
    sessionCapabilities: new Map(),
    sessionAuthBindings: new Map(),
    sessionProtocolVersions: new Map(),
    sessionManager: new SessionManager(),
    ...overrides,
  };
}

describe("mcp/http-transport", () => {
  it("requires initialization before operation requests", async () => {
    let handledRequests = 0;
    const handler = createMCPHTTPHandler(transportDependencies({
      handleRequest: async (request) => {
        handledRequests++;
        return { jsonrpc: "2.0", id: request.id, result: {} };
      },
    }));

    const response = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }));
    assertEquals(response.status, 400);
    assertEquals(handledRequests, 0);
  });

  it("continues requiring MCP-Session-Id after issued sessions expire", async () => {
    let clock = 1_000;
    let handledRequests = 0;
    const sessionManager = new SessionManager({ ttlMs: 5_000, now: () => clock });
    const handler = createMCPHTTPHandler(transportDependencies({
      handleRequest: async (request) => {
        handledRequests++;
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: request.method === "initialize" ? { protocolVersion: "2025-11-25" } : {},
        };
      },
      sessionManager,
    }));

    const initResponse = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    }));
    const sessionId = initResponse.headers.get("MCP-Session-Id");
    assertEquals(initResponse.status, 200);
    assertEquals(typeof sessionId, "string");

    clock += 6_000;
    assertEquals(sessionManager.size, 0);

    const missingHeaderResponse = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }));
    assertEquals(missingHeaderResponse.status, 400);

    const expiredSessionResponse = await handler(jsonRpcRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { ...JSON_HEADERS, "MCP-Session-Id": String(sessionId) },
    ));
    assertEquals(expiredSessionResponse.status, 404);
    assertEquals(handledRequests, 1);
  });

  it("rejects malformed JSON-RPC envelopes before dispatch", async () => {
    let handledRequests = 0;
    const handler = createMCPHTTPHandler(transportDependencies({
      handleRequest: async (request) => {
        handledRequests++;
        return { jsonrpc: "2.0", id: request.id, result: {} };
      },
    }));

    for (
      const payload of [
        null,
        [],
        {},
        { jsonrpc: "1.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: 1, method: 42 },
        { jsonrpc: "2.0", id: {}, method: "tools/list" },
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: "bad" },
      ]
    ) {
      const response = await handler(jsonRpcRequest(payload));
      assertEquals(response.status, 400);
      assertEquals(
        (await response.json() as { error: { code: number } }).error.code,
        -32600,
      );
    }
    assertEquals(handledRequests, 0);
  });

  it("does not allocate a session for a failed initialize response", async () => {
    const sessionManager = new SessionManager();
    const handler = createMCPHTTPHandler(transportDependencies({
      handleRequest: async (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: "Invalid initialization" },
      }),
      sessionManager,
    }));

    const response = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    }));

    assertEquals(response.status, 200);
    assertEquals(response.headers.get("MCP-Session-Id"), null);
    assertEquals(sessionManager.size, 0);
  });

  it("returns a bounded error when session admission is full", async () => {
    const sessionManager = new SessionManager({ maxSessions: 1 });
    const handler = createMCPHTTPHandler(transportDependencies({
      sessionManager,
    }));
    const initialize = () =>
      handler(jsonRpcRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { capabilities: {} },
      }));

    assertEquals((await initialize()).status, 200);
    const rejected = await initialize();
    assertEquals(rejected.status, 503);
    assertEquals(rejected.headers.get("MCP-Session-Id"), null);
    assertEquals(sessionManager.size, 1);
  });

  it("validates the protocol version header against the negotiated session", async () => {
    let handledRequests = 0;
    const handler = createMCPHTTPHandler(transportDependencies({
      handleRequest: async (request) => {
        handledRequests++;
        return {
          jsonrpc: "2.0",
          id: request.id,
          result: request.method === "initialize" ? { protocolVersion: "2025-11-25" } : {},
        };
      },
    }));
    const initialized = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    }));
    const sessionId = initialized.headers.get("MCP-Session-Id");
    assertExists(sessionId);

    for (const protocolVersion of ["not-a-version", "2024-11-05"]) {
      const response = await handler(jsonRpcRequest(
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
        {
          ...JSON_HEADERS,
          "MCP-Session-Id": sessionId,
          "MCP-Protocol-Version": protocolVersion,
        },
      ));
      assertEquals(response.status, 400);
    }

    const accepted = await handler(jsonRpcRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      {
        ...JSON_HEADERS,
        "MCP-Session-Id": sessionId,
        "MCP-Protocol-Version": "2025-11-25",
      },
    ));
    assertEquals(accepted.status, 200);
    assertEquals(handledRequests, 2);
  });

  it("does not refresh a session for a rejected protocol version", async () => {
    let clock = 1_000;
    const sessionManager = new SessionManager({ ttlMs: 5_000, now: () => clock });
    const handler = createMCPHTTPHandler(transportDependencies({
      sessionManager,
    }));
    const initialized = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    }));
    const sessionId = initialized.headers.get("MCP-Session-Id");
    assertExists(sessionId);

    clock += 4_000;
    const rejected = await handler(jsonRpcRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        ...JSON_HEADERS,
        "MCP-Session-Id": sessionId,
        "MCP-Protocol-Version": "2024-11-05",
      },
    ));
    assertEquals(rejected.status, 400);

    clock += 2_000;
    const expired = await handler(jsonRpcRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      {
        ...JSON_HEADERS,
        "MCP-Session-Id": sessionId,
        "MCP-Protocol-Version": "2025-11-25",
      },
    ));
    assertEquals(expired.status, 404);
  });

  it("distinguishes missing, unknown, and live sessions on DELETE", async () => {
    const handler = createMCPHTTPHandler(transportDependencies());

    const missing = await handler(
      new Request("http://localhost/mcp", { method: "DELETE" }),
    );
    assertEquals(missing.status, 400);

    const unknown = await handler(
      new Request("http://localhost/mcp", {
        method: "DELETE",
        headers: { "MCP-Session-Id": "unknown" },
      }),
    );
    assertEquals(unknown.status, 404);

    const initialized = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    }));
    const sessionId = initialized.headers.get("MCP-Session-Id");
    assertExists(sessionId);
    const deleted = await handler(
      new Request("http://localhost/mcp", {
        method: "DELETE",
        headers: { "MCP-Session-Id": sessionId },
      }),
    );
    assertEquals(deleted.status, 200);
  });

  it("fails closed when the authentication validator rejects", async () => {
    const handler = createMCPHTTPHandler(transportDependencies({
      authEnabled: true,
      validateAuth: () => Promise.reject(new Error("identity provider unavailable")),
    }));

    const response = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    }));
    assertEquals(response.status, 401);
  });

  it("accepts only an explicit boolean true from the auth validator", async () => {
    const handler = createMCPHTTPHandler(transportDependencies({
      authEnabled: true,
      validateAuth: async () => "truthy" as never,
    }));

    const response = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    }));
    assertEquals(response.status, 401);
  });

  it("adds no-store and nosniff to transport responses", async () => {
    const handler = createMCPHTTPHandler(transportDependencies());
    const response = await handler(jsonRpcRequest({ invalid: true }));

    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  });
});
