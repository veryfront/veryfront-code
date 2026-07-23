import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMCPHTTPHandler } from "./http-transport.ts";
import { SessionManager } from "./session.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

function jsonRpcRequest(
  payload: Record<string, unknown>,
  headers: HeadersInit = JSON_HEADERS,
): Request {
  return new Request("http://localhost/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
}

describe("mcp/http-transport", () => {
  it("continues requiring MCP-Session-Id after issued sessions expire", async () => {
    let clock = 1_000;
    let handledRequests = 0;
    const sessionManager = new SessionManager({ ttlMs: 5_000, now: () => clock });
    const handler = createMCPHTTPHandler({
      authEnabled: false,
      getCORSHeaders: () => ({}),
      validateAuth: async () => true,
      handleRequest: async (request) => {
        handledRequests++;
        return { jsonrpc: "2.0", id: request.id, result: {} };
      },
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager,
    });

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

  it("rejects malformed JSON-RPC values before dispatch", async () => {
    let handledRequests = 0;
    const handler = createMCPHTTPHandler({
      authEnabled: false,
      getCORSHeaders: () => ({}),
      validateAuth: async () => true,
      handleRequest: async () => {
        handledRequests++;
        return { jsonrpc: "2.0", id: 1, result: {} };
      },
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager: new SessionManager(),
    });

    for (
      const payload of [
        null,
        [],
        { jsonrpc: "1.0", id: 1, method: "tools/list" },
        { jsonrpc: "2.0", id: null, method: "tools/list" },
        { jsonrpc: "2.0", id: 1, method: "" },
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: "invalid" },
      ]
    ) {
      const response = await handler(
        new Request("http://localhost/mcp", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify(payload),
        }),
      );
      assertEquals(response.status, 400);
      const body = await response.json();
      assertEquals(body.error.code, -32600);
    }
    assertEquals(handledRequests, 0);
  });

  it("rejects MCP request methods sent as id-less notifications", async () => {
    let handledRequests = 0;
    const handler = createMCPHTTPHandler({
      authEnabled: false,
      getCORSHeaders: () => ({}),
      validateAuth: async () => true,
      handleRequest: async (request) => {
        handledRequests++;
        return { jsonrpc: "2.0", id: request.id, result: {} };
      },
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager: new SessionManager(),
    });

    const response = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "dangerous", arguments: {} },
    }));

    assertEquals(response.status, 400);
    assertEquals((await response.json()).error.code, -32600);
    assertEquals(handledRequests, 0);
  });

  it("rejects oversized string request IDs before dispatch", async () => {
    let handledRequests = 0;
    const handler = createMCPHTTPHandler({
      authEnabled: false,
      getCORSHeaders: () => ({}),
      validateAuth: async () => true,
      handleRequest: async (request) => {
        handledRequests++;
        return { jsonrpc: "2.0", id: request.id, result: {} };
      },
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager: new SessionManager(),
    });

    const response = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: "x".repeat(8_193),
      method: "tools/list",
    }));

    assertEquals(response.status, 400);
    assertEquals(handledRequests, 0);
  });

  it("does not create a session for a failed initialize request", async () => {
    const sessionManager = new SessionManager();
    const handler = createMCPHTTPHandler({
      authEnabled: false,
      getCORSHeaders: () => ({}),
      validateAuth: async () => true,
      handleRequest: async (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32602, message: "Invalid initialize parameters" },
      }),
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager,
    });

    const response = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }));
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("MCP-Session-Id"), null);
    assertEquals(sessionManager.size, 0);
  });

  it("fails closed when the auth validator throws", async () => {
    const handler = createMCPHTTPHandler({
      authEnabled: true,
      getCORSHeaders: () => ({ "Access-Control-Allow-Origin": "https://example.com" }),
      validateAuth: () => Promise.reject(new Error("validator unavailable")),
      handleRequest: async (request) => ({ jsonrpc: "2.0", id: request.id, result: {} }),
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager: new SessionManager(),
    });

    const response = await handler(jsonRpcRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { ...JSON_HEADERS, Origin: "https://example.com" },
    ));
    assertEquals(response.status, 401);
    assertEquals(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://example.com",
    );
  });

  it("validates DELETE session identifiers", async () => {
    const handler = createMCPHTTPHandler({
      authEnabled: false,
      getCORSHeaders: () => ({}),
      validateAuth: async () => true,
      handleRequest: async (request) => ({ jsonrpc: "2.0", id: request.id, result: {} }),
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager: new SessionManager(),
    });

    assertEquals(
      (await handler(new Request("http://localhost/mcp", { method: "DELETE" }))).status,
      400,
    );
    assertEquals(
      (await handler(
        new Request("http://localhost/mcp", {
          method: "DELETE",
          headers: { "MCP-Session-Id": "unknown" },
        }),
      )).status,
      404,
    );
  });

  it("validates an explicit protocol version against the negotiated session", async () => {
    const handler = createMCPHTTPHandler({
      authEnabled: false,
      getCORSHeaders: () => ({}),
      validateAuth: async () => true,
      handleRequest: async (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: request.method === "initialize" ? { protocolVersion: "2025-11-25" } : {},
      }),
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager: new SessionManager(),
    });
    const initialized = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    }));
    const sessionId = initialized.headers.get("MCP-Session-Id")!;

    const rejected = await handler(jsonRpcRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        ...JSON_HEADERS,
        "MCP-Session-Id": sessionId,
        "MCP-Protocol-Version": "2024-11-05",
      },
    ));
    assertEquals(rejected.status, 400);

    const accepted = await handler(jsonRpcRequest(
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      {
        ...JSON_HEADERS,
        "MCP-Session-Id": sessionId,
        "MCP-Protocol-Version": "2025-11-25",
      },
    ));
    assertEquals(accepted.status, 200);
  });

  it("validates the negotiated protocol version before deleting a session", async () => {
    const handler = createMCPHTTPHandler({
      authEnabled: false,
      getCORSHeaders: () => ({}),
      validateAuth: async () => true,
      handleRequest: async (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: request.method === "initialize" ? { protocolVersion: "2025-11-25" } : {},
      }),
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager: new SessionManager(),
    });
    const initialized = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { capabilities: {} },
    }));
    const sessionId = initialized.headers.get("MCP-Session-Id")!;

    const rejected = await handler(
      new Request("http://localhost/mcp", {
        method: "DELETE",
        headers: {
          "MCP-Session-Id": sessionId,
          "MCP-Protocol-Version": "2024-11-05",
        },
      }),
    );
    assertEquals(rejected.status, 400);

    const stillActive = await handler(jsonRpcRequest(
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      {
        ...JSON_HEADERS,
        "MCP-Session-Id": sessionId,
        "MCP-Protocol-Version": "2025-11-25",
      },
    ));
    assertEquals(stillActive.status, 200);
  });

  it("returns a bounded internal error when a response cannot be serialized", async () => {
    const handler = createMCPHTTPHandler({
      authEnabled: false,
      getCORSHeaders: () => ({}),
      validateAuth: async () => true,
      handleRequest: async (request) => ({
        jsonrpc: "2.0",
        id: request.id,
        result: 1n,
      }),
      extractRequestContext: () => undefined,
      isOriginAllowed: () => true,
      sessionCapabilities: new Map(),
      sessionProtocolVersions: new Map(),
      sessionManager: new SessionManager(),
    });

    const response = await handler(jsonRpcRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    }));
    assertEquals(response.status, 500);
    const body = await response.json();
    assertEquals(body.error, { code: -32603, message: "Internal error" });
  });
});
