import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool/remote-mcp.ts";
import { FakeTime } from "#std/testing/time";

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

  it("initializes a legacy session before the first call of a run discovered elsewhere", async () => {
    const server = legacyFixture();
    await withMockFetch(server.fetch, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await source.listTools();
      assertEquals(await source.executeTool("ping", {}, { runId: "run-b" }), "pong");
    });
    assertEquals(server.requests.map((r) => r.body?.method ?? r.method), [
      "tools/list",
      "initialize",
      "notifications/initialized",
      "tools/list",
      "initialize",
      "notifications/initialized",
      "tools/call",
    ]);
  });

  for (const discoverFirst of [false, true]) {
    it(`does not negotiate or replay an ambiguous modern HTTP 400 call (discovery: ${discoverFirst})`, async () => {
      const methods: string[] = [];
      await withMockFetch(async (input, init) => {
        const body = observe(input, init).body!;
        methods.push(body.method);
        if (body.method === "tools/list") return success(body);
        if (body.method === "initialize") {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-11-25" },
          });
        }
        if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
        return new Response("failure after applying the effect", { status: 400 });
      }, async () => {
        const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
        if (discoverFirst) await source.listTools();
        await assertRejects(() => source.executeTool("ping", {}), Error, "400");
      });
      assertEquals(methods, discoverFirst ? ["tools/list", "tools/call"] : ["tools/call"]);
    });
  }

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

  it("mirrors parameter headers for a call made under a different run than discovery", async () => {
    const tool = {
      name: "lookup",
      description: "Read",
      inputSchema: {
        type: "object",
        properties: { region: { type: "string", "x-mcp-header": "Region" } },
      },
    };
    const regions: Array<string | null> = [];
    await withMockFetch(async (input, init) => {
      const request = observe(input, init);
      const body = request.body!;
      if (body.method === "tools/list") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [tool] } });
      }
      regions.push(request.headers.get("Mcp-Param-Region"));
      return success(body);
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await source.listTools();
      await source.executeTool(tool.name, { region: "eu" }, { runId: "run-a" });
      await source.dispose?.({ runId: "run-a" });
      await source.executeTool(tool.name, { region: "us" }, { runId: "run-b" });
    });
    assertEquals(regions, ["eu", "us"]);
  });

  it("accepts a legacy server that negotiates MCP 2024-11-05", async () => {
    const versions: Array<string | null> = [];
    await withMockFetch(async (input, init) => {
      const request = observe(input, init);
      const body = request.body!;
      if (body.method === "initialize") {
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2024-11-05" },
        }, { headers: { "Mcp-Session-Id": "session-2024" } });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (request.headers.get("Mcp-Session-Id") !== "session-2024") {
        return new Response("missing session ID", { status: 400 });
      }
      versions.push(request.headers.get("MCP-Protocol-Version"));
      return success(body);
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      assertEquals((await source.listTools()).map((t) => t.name), ["ping"]);
      assertEquals(await source.executeTool("ping", {}), "pong");
    });
    assertEquals(versions, ["2024-11-05", "2024-11-05"]);
  });

  it("restarts paginated discovery from the first page after a session renewal", async () => {
    const server = legacyFixture();
    const cursors: Array<string | undefined> = [];
    let expireOnce = true;
    await withMockFetch(async (input, init) => {
      const request = observe(input, init);
      const body = request.body;
      if (body?.method !== "tools/list" || !request.headers.get("Mcp-Session-Id")) {
        return await server.fetch(input, init);
      }
      const sessionId = request.headers.get("Mcp-Session-Id")!;
      const cursor = body.params?.cursor as string | undefined;
      cursors.push(cursor);
      if (cursor !== undefined && expireOnce) {
        expireOnce = false;
        server.sessions.delete(sessionId);
        return await server.fetch(input, init);
      }
      // Cursors are scoped to the session that issued them.
      if (cursor !== undefined && cursor !== `${sessionId}:page-2`) {
        return new Response("foreign cursor", { status: 400 });
      }
      const page = cursor === undefined
        ? { tools: [TOOL], nextCursor: `${sessionId}:page-2` }
        : { tools: [{ ...TOOL, name: "pong" }] };
      return Response.json({ jsonrpc: "2.0", id: body.id, result: page });
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      assertEquals((await source.listTools()).map((t) => t.name), ["ping", "pong"]);
    });
    assertEquals(cursors, [
      undefined,
      "fixture-session-1:page-2",
      undefined,
      "fixture-session-2:page-2",
    ]);
  });

  it("fails closed when the session is renewed again during restarted pagination", async () => {
    const server = legacyFixture();
    let listCalls = 0;
    await withMockFetch(async (input, init) => {
      const request = observe(input, init);
      const body = request.body;
      if (body?.method !== "tools/list" || !request.headers.get("Mcp-Session-Id")) {
        return await server.fetch(input, init);
      }
      listCalls++;
      const sessionId = request.headers.get("Mcp-Session-Id")!;
      if (body.params?.cursor !== undefined) {
        // Every second page expires the session that issued its cursor.
        server.sessions.delete(sessionId);
        return await server.fetch(input, init);
      }
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [TOOL], nextCursor: `${sessionId}:page-2` },
      });
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await assertRejects(() => source.listTools(), Error, "renewed again");
    });
    assertEquals(listCalls, 4);
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

  it("terminates sessions concurrently under one aggregate cleanup budget", async () => {
    const server = legacyFixture();
    const started: string[] = [];
    let bothStarted: () => void = () => {};
    const allStarted = new Promise<void>((resolve) => bothStarted = resolve);
    await withMockFetch(async (input, init) => {
      const request = observe(input, init);
      if (request.method !== "DELETE") return await server.fetch(input, init);
      started.push(request.headers.get("Mcp-Session-Id")!);
      if (started.length === 2) bothStarted();
      // A server that never completes DELETE: only the cleanup budget ends it.
      return await new Promise<Response>((_resolve, reject) => {
        const signal = init!.signal!;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await source.listTools({ runId: "one" });
      await source.listTools({ runId: "two" });
      using time = new FakeTime();
      const disposal = source.dispose!();
      await allStarted;
      assertEquals(started.length, 2, "deletes must not wait for each other");
      await time.tickAsync(5_000);
      const error = await assertRejects(() => disposal);
      assertEquals((error as DOMException).name, "TimeoutError");
    });
  });

  it("scopes legacy negotiation to the credential identity", async () => {
    const methods: string[] = [];
    await withMockFetch(async (input, init) => {
      const request = observe(input, init);
      const tenant = request.headers.get("authorization");
      methods.push(`${tenant}:${request.body?.method ?? request.method}`);
      if (tenant === "Bearer legacy") {
        const body = request.body!;
        if (body.method === "initialize") {
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2025-11-25" },
          }, { headers: { "Mcp-Session-Id": "legacy-session" } });
        }
        if (body.method === "notifications/initialized") {
          return new Response(null, { status: 202 });
        }
        if (!request.headers.get("Mcp-Session-Id")) {
          return new Response("missing session ID", { status: 400 });
        }
        return success(body);
      }
      // The modern-only tenant rejects session initialization.
      if (request.body?.method === "initialize") return new Response(null, { status: 405 });
      return success(request.body!);
    }, async () => {
      const source = createRemoteMCPToolSource({
        endpoint: ENDPOINT,
        headers: (context) => ({ Authorization: `Bearer ${context?.userId}` }),
      });
      await source.listTools({ userId: "legacy" });
      await source.listTools({ userId: "modern" });
      assertEquals(await source.executeTool("ping", {}, { userId: "modern", runId: "r" }), "pong");
    });
    assertEquals(methods.filter((method) => method.startsWith("Bearer modern")), [
      "Bearer modern:tools/list",
      "Bearer modern:tools/call",
    ]);
  });

  it("counts tools excluded for invalid annotations toward the catalog limit", async () => {
    const invalid = (index: number) => ({
      name: `invalid_${index}`,
      description: "Invalid header annotation",
      inputSchema: {
        type: "object",
        properties: { value: { type: "number", "x-mcp-header": "Value" } },
      },
    });
    await withMockFetch(async (input, init) => {
      const body = observe(input, init).body!;
      const page = Number(body.params?.cursor ?? 0);
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools: Array.from({ length: 600 }, (_, index) => invalid(page * 600 + index)),
          ...(page === 0 ? { nextCursor: "1" } : {}),
        },
      });
    }, async () => {
      const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
      await assertRejects(() => source.listTools(), Error, "cannot contain more than 1000 tools");
    });
  });
});
