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
});
