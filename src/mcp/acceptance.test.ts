import "#veryfront/schemas/_test-setup.ts";
/**
 * Acceptance criteria tests for Streamable HTTP transport (issue #839).
 * Tests the framework MCPServer HTTP handler against all acceptance criteria.
 */
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMCPServer } from "./server.ts";
import { formatSSEEvent } from "./sse.ts";

const MCP_INIT = {
  jsonrpc: "2.0" as const,
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "acceptance-test", version: "1.0" },
  },
};

function post(
  handler: (r: Request) => Promise<Response>,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return handler(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function initSession(
  handler: (r: Request) => Promise<Response>,
): Promise<string> {
  const res = await post(handler, MCP_INIT);
  const sid = res.headers.get("MCP-Session-Id");
  if (!sid) throw new Error("No MCP-Session-Id in initialize response");
  return sid;
}

describe("Acceptance Criteria — Streamable HTTP Transport (#839)", () => {
  it("POST with request returns application/json", async () => {
    const handler = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    }).createHTTPHandler();
    const res = await post(handler, MCP_INIT);
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("Content-Type"), "application/json");
    const body = await res.json();
    assertEquals(body.result.protocolVersion, "2025-11-25");
  });

  it("Server assigns MCP-Session-Id in initialize response", async () => {
    const handler = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    }).createHTTPHandler();
    const res = await post(handler, MCP_INIT);
    const sessionId = res.headers.get("MCP-Session-Id");
    assertExists(sessionId);
    assertEquals(sessionId!.length > 0, true);
  });

  it("POST with notification returns 202 Accepted with no body", async () => {
    const handler = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    }).createHTTPHandler();
    const sid = await initSession(handler);
    const res = await post(
      handler,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { "MCP-Session-Id": sid },
    );
    assertEquals(res.status, 202);
    const body = await res.text();
    assertEquals(body, "");
  });

  it("Missing session ID on post-init requests returns 400 Bad Request", async () => {
    const handler = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    }).createHTTPHandler();
    await initSession(handler);
    const res = await post(handler, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    assertEquals(res.status, 400);
  });

  it("Unknown session IDs return 404 Not Found", async () => {
    const handler = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    }).createHTTPHandler();
    await initSession(handler);
    const res = await post(
      handler,
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { "MCP-Session-Id": "nonexistent-session" },
    );
    assertEquals(res.status, 404);
  });

  it("DELETE with session ID terminates the session", async () => {
    const handler = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    }).createHTTPHandler();
    const sidA = await initSession(handler);
    await initSession(handler); // sidB keeps session check active

    const delRes = await handler(
      new Request("http://localhost/mcp", {
        method: "DELETE",
        headers: { "MCP-Session-Id": sidA },
      }),
    );
    assertEquals(delRes.status, 200);

    // Terminated session returns 404 (sidB keeps session check active)
    const res = await post(
      handler,
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      { "MCP-Session-Id": sidA },
    );
    assertEquals(res.status, 404);
  });

  it("OPTIONS returns 204", async () => {
    const handler = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    }).createHTTPHandler();
    const res = await handler(
      new Request("http://localhost/mcp", { method: "OPTIONS" }),
    );
    assertEquals(res.status, 204);
  });

  it("Origin validation returns 403 Forbidden if present and invalid", async () => {
    const handler = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
      cors: { enabled: true, origins: ["https://allowed.com"] },
    }).createHTTPHandler();

    const res = await handler(
      new Request("http://localhost/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://evil.com",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );
    assertEquals(res.status, 403);
  });

  it("Unsupported HTTP method returns 405", async () => {
    const handler = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    }).createHTTPHandler();
    const res = await handler(
      new Request("http://localhost/mcp", { method: "PUT" }),
    );
    assertEquals(res.status, 405);
  });

  it("SSE events include id field for resumability", () => {
    const event = formatSSEEvent({ jsonrpc: "2.0", id: 1, result: {} }, "evt-42");
    assertEquals(event.startsWith("id: evt-42\n"), true);
    assertEquals(event.includes("data: "), true);
  });

  it("Existing stdio transport unchanged (handleRequest works directly)", async () => {
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
    assertEquals(res.error, undefined);
    const result = res.result as Record<string, unknown>;
    assertEquals(result.protocolVersion, "2025-11-25");
  });
});
