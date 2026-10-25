import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createRemoteMCPToolSource } from "./remote-mcp.ts";

const ENDPOINT = "https://93.184.216.34/mcp";
const TOOL = { name: "ping", description: "Ping", inputSchema: { type: "object" } };
type RequestBody = { id?: string; method: string; params?: Record<string, unknown> };
interface ObservedRequest {
  endpoint: string;
  method: string;
  headers: Headers;
  body?: RequestBody;
}
function observe(input: RequestInfo | URL, init?: RequestInit): ObservedRequest {
  const request = observeFetchRequestInit(init);
  return {
    endpoint: String(input),
    method: request.method ?? "GET",
    headers: new Headers(request.headers),
    body: request.body ? JSON.parse(String(request.body)) : undefined,
  };
}
function success(body: RequestBody): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: body.id,
    result: body.method === "tools/list"
      ? { tools: [TOOL] }
      : { content: [{ type: "text", text: "pong" }] },
  });
}
function legacyFixture() {
  const requests: ObservedRequest[] = [];
  const sessions = new Map<string, { identity: string; ready: boolean }>();
  let nextSession = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = observe(input, init);
    requests.push(request);
    const identity = `${request.endpoint}:${request.headers.get("authorization") ?? "anonymous"}`;
    const sessionId = request.headers.get("Mcp-Session-Id");
    if (request.method === "DELETE") {
      assertEquals(sessions.get(sessionId ?? "")?.identity, identity);
      sessions.delete(sessionId!);
      return new Response(null, { status: 204 });
    }
    const body = request.body!;
    if (body.method === "initialize") {
      const session = `fixture-session-${++nextSession}`;
      sessions.set(session, { identity, ready: false });
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: { tools: {} },
          serverInfo: { name: "strict-fixture", version: "1" },
        },
      }, { headers: { "Mcp-Session-Id": session } });
    }
    const session = sessions.get(sessionId ?? "");
    if (body.method === "notifications/initialized" && session?.identity === identity) {
      session.ready = true;
      return new Response(null, { status: 202 });
    }
    if (!session || session.identity !== identity || !session.ready) {
      return new Response("missing session ID", { status: sessionId ? 404 : 400 });
    }
    assertEquals(request.headers.get("MCP-Protocol-Version"), "2025-11-25");
    return success(body);
  };
  return { fetch, requests, sessions };
}

describe("remote MCP HTTP compatibility", () => {
  it("sends modern metadata on discovery and execution while preserving correlation", async () => {
    const requests: ObservedRequest[] = [];
    await withMockFetch(async (input, init) => {
      const request = observe(input, init);
      requests.push(request);
      const body = request.body!;
      assertEquals(request.headers.get("MCP-Protocol-Version"), "2026-07-28");
      assertEquals(request.headers.get("Mcp-Method"), body.method);
      const meta = body.params?._meta as Record<string, unknown>;
      assertEquals(meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
      assertEquals(typeof meta["io.modelcontextprotocol/clientInfo"], "object");
      assertEquals(meta["io.modelcontextprotocol/clientCapabilities"], {});
      if (body.method === "tools/call") {
        assertEquals(request.headers.get("Mcp-Name"), "ping");
        assertEquals(meta.run_id, "run-a");
      } else assertEquals(meta.custom, "preserved");
      return success(body);
    }, async () => {
      const source = createRemoteMCPToolSource({
        endpoint: ENDPOINT,
        listMeta: { custom: "preserved" },
      });
      assertEquals((await source.listTools()).map((t) => t.name), ["ping"]);
      assertEquals(await source.executeTool("ping", {}, { runId: "run-a" }), "pong");
    });
    assertEquals(requests.length, 2);
  });

  it("initializes once, reuses the legacy session and deletes it on disposal", async () => {
    const server = legacyFixture();
    await withMockFetch(server.fetch, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      assertEquals((await source.listTools()).map((t) => t.name), ["ping"]);
      assertEquals(await source.executeTool("ping", {}), "pong");
      await source.dispose?.();
    });
    assertEquals(server.requests.map((r) => r.body?.method ?? r.method), [
      "tools/list",
      "initialize",
      "notifications/initialized",
      "tools/list",
      "tools/call",
      "DELETE",
    ]);
    assertEquals(server.sessions.size, 0);
  });

  it("isolates sessions across full endpoints, credentials and runs", async () => {
    const server = legacyFixture();
    await withMockFetch(server.fetch, async () => {
      const source = createRemoteMCPToolSource({
        endpoint: (context) => `${ENDPOINT}/${context?.projectId ?? "default"}`,
        headers: (context) => ({
          Authorization: `Bearer fixture-${context?.userId ?? "anonymous"}`,
        }),
      });
      for (
        const context of [
          { projectId: "one", userId: "one", runId: "one" },
          { projectId: "two", userId: "one", runId: "one" },
          { projectId: "one", userId: "two", runId: "one" },
          { projectId: "one", userId: "one", runId: "two" },
        ]
      ) await source.listTools(context);
      assertEquals(server.sessions.size, 4);
      await source.dispose?.({ projectId: "one", userId: "one", runId: "one" });
      assertEquals(server.sessions.size, 1);
    });
  });

  it("serializes concurrent legacy initialization", async () => {
    const server = legacyFixture();
    await withMockFetch(server.fetch, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      const results = await Promise.all([source.listTools(), source.listTools()]);
      assertEquals(results.map((r) => r.length), [1, 1]);
      assertEquals(server.requests.filter((r) => r.body?.method === "initialize").length, 1);
      assertEquals(server.sessions.size, 1);
    });
  });

  it("reinitializes an expired legacy session once before retrying", async () => {
    const server = legacyFixture();
    await withMockFetch(server.fetch, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await source.listTools();
      server.sessions.clear();
      assertEquals(await source.executeTool("ping", {}), "pong");
      assertEquals(server.requests.filter((r) => r.body?.method === "initialize").length, 2);
    });
  });

  it("does not replay a tool call after an ambiguous server failure", async () => {
    const server = legacyFixture();
    let calls = 0;
    await withMockFetch(async (input, init) => {
      if (observe(input, init).body?.method === "tools/call") {
        calls++;
        return new Response("upstream failed after execution", { status: 500 });
      }
      return await server.fetch(input, init);
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await source.listTools();
      await assertRejects(() => source.executeTool("ping", {}), Error, "500");
    });
    assertEquals(calls, 1);
  });

  it("does not fall back on recognized modern errors", async () => {
    const methods: string[] = [];
    await withMockFetch(async (input, init) => {
      const body = observe(input, init).body!;
      methods.push(body.method);
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32021, message: "Missing required client capability" },
      }, { status: 400 });
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await assertRejects(() => source.listTools(), Error);
    });
    assertEquals(methods, ["tools/list"]);
  });

  it("does not treat modern method-not-found 404 as a session expiry", async () => {
    const methods: string[] = [];
    await withMockFetch(async (input, init) => {
      const body = observe(input, init).body!;
      methods.push(body.method);
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32601, message: "Method not found" },
      }, { status: 404 });
    }, async () => {
      await assertRejects(
        () => createRemoteMCPToolSource({ endpoint: ENDPOINT }).listTools(),
        Error,
      );
    });
    assertEquals(methods, ["tools/list"]);
  });

  it("does not fall back or expose credentials on authentication failure", async () => {
    let calls = 0;
    await withMockFetch(async () => {
      calls++;
      return new Response("denied", { status: 401 });
    }, async () => {
      const source = createRemoteMCPToolSource({
        endpoint: ENDPOINT,
        headers: { Authorization: "Bearer fixture-private-key" },
      });
      const error = await assertRejects(() => source.listTools(), Error);
      assertInstanceOf(error, Error);
      assertEquals(error.message.includes("fixture-private-key"), false);
    });
    assertEquals(calls, 1);
  });

  it("encodes tool names and mirrors schema-declared parameter headers", async () => {
    const tool = {
      name: "工具",
      description: "Read",
      inputSchema: {
        type: "object",
        properties: {
          region: { type: "string", "x-mcp-header": "Region" },
          count: { type: "integer", "x-mcp-header": "Count" },
          nested: {
            type: "object",
            properties: {
              enabled: { type: "boolean", "x-mcp-header": "Enabled" },
            },
          },
        },
      },
    };
    await withMockFetch(async (input, init) => {
      const request = observe(input, init);
      const body = request.body!;
      if (body.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [tool] } });
      }
      assertEquals(request.headers.get("Mcp-Name"), "=?base64?5bel5YW3?=");
      assertEquals(request.headers.get("Mcp-Param-Region"), `=?base64?${btoa(" padded ")}?=`);
      assertEquals(request.headers.get("Mcp-Param-Count"), "2");
      assertEquals(request.headers.get("Mcp-Param-Enabled"), "true");
      return success(body);
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await source.listTools();
      assertEquals(
        await source.executeTool(tool.name, {
          region: " padded ",
          count: 2,
          nested: { enabled: true },
        }),
        "pong",
      );
    });
  });

  it("excludes invalid header annotations without excluding valid sibling tools", async () => {
    const invalidSchemas = [
      { type: "object", properties: { value: { type: "number", "x-mcp-header": "Value" } } },
      { type: "object", properties: { value: { type: "string", "x-mcp-header": "bad name" } } },
      {
        type: "object",
        properties: {
          a: { type: "string", "x-mcp-header": "Same" },
          b: { type: "string", "x-mcp-header": "same" },
        },
      },
      {
        type: "object",
        properties: {
          values: { type: "array", items: { type: "string", "x-mcp-header": "Value" } },
        },
      },
      {
        type: "object",
        allOf: [{ properties: { value: { type: "string", "x-mcp-header": "Value" } } }],
      },
    ];
    await withMockFetch(async (input, init) => {
      const body = observe(input, init).body!;
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: [
            TOOL,
            ...invalidSchemas.map((inputSchema, index) => ({
              name: `invalid_${index}`,
              description: "Invalid",
              inputSchema,
            })),
          ],
        },
      });
    }, async () => {
      assertEquals(
        (await createRemoteMCPToolSource({ endpoint: ENDPOINT }).listTools()).map((t) => t.name),
        ["ping"],
      );
    });
  });

  it("bounds session expiry recovery to one retry", async () => {
    const server = legacyFixture();
    let expired = false;
    let calls = 0;
    await withMockFetch(async (input, init) => {
      if (expired && observe(input, init).body?.method === "tools/call") {
        calls++;
        return new Response("expired", { status: 404 });
      }
      return await server.fetch(input, init);
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await source.listTools();
      expired = true;
      await assertRejects(() => source.executeTool("ping", {}), Error, "404");
    });
    assertEquals(calls, 2);
  });

  it("deletes every session even if one cleanup fails and the run was aborted", async () => {
    const server = legacyFixture();
    let deletions = 0;
    await withMockFetch(async (input, init) => {
      const request = observe(input, init);
      if (request.method === "DELETE") {
        deletions++;
        assertEquals(init?.signal?.aborted, false);
        return new Response(null, { status: deletions === 1 ? 500 : 204 });
      }
      return await server.fetch(input, init);
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await source.listTools({ runId: "one" });
      await source.listTools({ runId: "two" });
      await assertRejects(() => source.dispose!(), Error, "500");
      await source.dispose!();
    });
    assertEquals(deletions, 2);
  });
});
