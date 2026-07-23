import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createRemoteMCPToolSource } from "./remote-mcp.ts";

describe("tool/remote-mcp", () => {
  it("lists tools from a remote MCP server using the standard JSON-RPC contract", async () => {
    let requestUrl = "";
    let requestMethod = "";
    let projectHeader = "";
    let acceptHeader = "";
    let requestRedirect = "";
    let requestBody: Record<string, unknown> | undefined;

    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: (context) => `https://mcp.test/${context?.projectId ?? "default"}`,
      headers: (context) => ({
        Authorization: "Bearer remote-token",
        "x-project-id": String(context?.projectId ?? ""),
      }),
    });

    const tools = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestUrl = request.url;
        requestMethod = request.method;
        projectHeader = request.headers.get("x-project-id") ?? "";
        acceptHeader = request.headers.get("accept") ?? "";
        requestRedirect = request.redirect;
        requestBody = await request.json();

        return Response.json({
          jsonrpc: "2.0",
          id: "docs:tools:list",
          result: {
            tools: [{
              name: "search_docs",
              description: "Search documentation",
              inputSchema: {},
              title: "Search docs",
              annotations: { readOnlyHint: true },
            }],
          },
        });
      },
      async () => await source.listTools({ projectId: "proj_123" }),
    );

    assertEquals(requestUrl, "https://mcp.test/proj_123");
    assertEquals(requestMethod, "POST");
    assertEquals(projectHeader, "proj_123");
    assertEquals(acceptHeader, "application/json, text/event-stream");
    assertEquals(requestRedirect, "error");
    assertEquals(requestBody, {
      jsonrpc: "2.0",
      id: "docs:tools:list",
      method: "tools/list",
    });
    assertEquals(tools, [{
      name: "search_docs",
      description: "Search documentation",
      parameters: { type: "object", properties: {} },
      title: "Search docs",
      annotations: { readOnlyHint: true },
    }]);
  });

  it("uses a stable fallback when a remote tool omits its optional description", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    const tools = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:list",
        result: {
          tools: [{
            name: "search_docs",
            annotations: {
              title: "Search docs",
              readOnlyHint: true,
            },
            inputSchema: { type: "object" },
          }],
        },
      }), async () => await source.listTools());

    assertEquals(tools, [{
      name: "search_docs",
      description: "Search docs",
      parameters: { type: "object" },
      title: "Search docs",
      annotations: { readOnlyHint: true },
    }]);
  });

  it("rejects non-formatting control characters in remote descriptions", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    await assertRejects(
      () =>
        withMockFetch(
          async () =>
            Response.json({
              jsonrpc: "2.0",
              id: "docs:tools:list",
              result: {
                tools: [{
                  name: "search_docs",
                  description: "Search\vdocs",
                  inputSchema: { type: "object" },
                }],
              },
            }),
          async () => await source.listTools(),
        ),
      Error,
      "invalid description",
    );
  });

  it("returns structured MCP tool errors instead of throwing for callTool isError results", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      headers: { Authorization: "Bearer remote-token" },
    });

    const result = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:call:search_docs",
        result: {
          isError: true,
          content: [{
            text: JSON.stringify({
              error: "authentication_required",
              connectUrl: "/oauth/docs",
            }),
          }],
        },
      }), async () => await source.executeTool("search_docs", { query: "auth" }));

    assertEquals(result, {
      error: "authentication_required",
      connectUrl: "/oauth/docs",
    });
  });

  it("sends run-scoped execution context as MCP call metadata", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://mcp.test",
      headers: { Authorization: "Bearer remote-token" },
    });

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestBody = await request.json();

        return Response.json({
          jsonrpc: "2.0",
          id: "veryfront-mcp:tools:call:gmail__get_profile",
          result: {
            content: [],
            structuredContent: { ok: true },
          },
        });
      },
      async () =>
        await source.executeTool("gmail__get_profile", {}, {
          projectId: "project-1",
          runId: "run-1",
          agentId: "gmail-agent",
        }),
    );

    assertEquals(requestBody, {
      jsonrpc: "2.0",
      id: "veryfront-mcp:tools:call:gmail__get_profile",
      method: "tools/call",
      params: {
        name: "gmail__get_profile",
        arguments: {},
        _meta: {
          run_id: "run-1",
          agent_id: "gmail-agent",
        },
      },
    });
  });

  it("prefers structuredContent for MCP isError tool results", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      headers: { Authorization: "Bearer remote-token" },
    });

    const result = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:call:search_docs",
        result: {
          isError: true,
          structuredContent: {
            error: "authentication_required",
            integration: "github",
            connectUrl: "/oauth/github",
            message: "Authenticate GitHub to continue.",
          },
          content: [],
        },
      }), async () => await source.executeTool("search_docs", { query: "auth" }));

    assertEquals(result, {
      error: "authentication_required",
      integration: "github",
      connectUrl: "/oauth/github",
      message: "Authenticate GitHub to continue.",
    });
  });

  it("preserves MCP isError when structuredContent lacks an error field", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:call:search_docs",
        result: {
          isError: true,
          structuredContent: {
            message: "Remote search failed",
            retryable: true,
          },
          content: [],
        },
      }), async () => await source.executeTool("search_docs", { query: "auth" }));

    assertEquals(result, {
      isError: true,
      message: "Remote search failed",
      retryable: true,
    });
  });

  it("wraps non-object structured MCP errors with a canonical marker", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:call:search_docs",
        result: {
          isError: true,
          structuredContent: "Remote search failed",
          content: [],
        },
      }), async () => await source.executeTool("search_docs", { query: "auth" }));

    assertEquals(result, {
      isError: true,
      message: "Remote search failed",
      output: "Remote search failed",
    });
  });

  it("normalizes remote MCP tool responses with generic error markers", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:call:search_docs",
        result: {
          error: "rate_limited",
          content: [{
            text: "Try again later",
          }],
        },
      }), async () => await source.executeTool("search_docs", { query: "auth" }));

    assertEquals(result, {
      error: "tool_error",
      message: "Try again later",
    });
  });

  it("preserves non-text and mixed MCP content instead of discarding it", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });
    const content = [
      { type: "text", text: "Generated diagram" },
      { type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
    ];

    const result = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:call:render_docs",
        result: { content },
      }), async () => await source.executeTool("render_docs", {}));

    assertEquals(result, content);
  });

  it("normalizes OAuth invalid_grant refresh failures into reconnect-required tool output", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer remote-token" },
    });

    const result = await withMockFetch(
      async () =>
        Response.json({
          jsonrpc: "2.0",
          id: "veryfront-mcp:tools:call:calendar__list_events",
          result: {
            isError: true,
            content: [{
              text: JSON.stringify({
                error: "tool_error",
                message:
                  'Token refresh failed (400): { "error": "invalid_grant", "error_description": "Token has been expired or revoked." }',
              }),
            }],
          },
        }),
      async () => await source.executeTool("calendar__list_events", {}, { projectId: "project-1" }),
    );

    assertEquals(result, {
      error: "reconnect_required",
      code: "OAUTH_TOKEN_EXPIRED",
      integration: "calendar",
      connectUrl: "https://api.example.com/oauth/connect/calendar?projectId=project-1",
      message: "Calendar needs to be reconnected before this tool can run.",
    });
  });

  it("normalizes JSON-RPC invalid_grant errors into reconnect-required tool output", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://api.example.com/mcp",
    });

    const result = await withMockFetch(
      async () =>
        Response.json({
          jsonrpc: "2.0",
          id: "veryfront-mcp:tools:call:calendar__list_events",
          error: {
            code: -32603,
            message: 'Token refresh failed (400): { "error": "invalid_grant" }',
          },
        }),
      async () => await source.executeTool("calendar__list_events", {}, { projectId: "project-1" }),
    );

    assertEquals(result, {
      error: "reconnect_required",
      code: "OAUTH_TOKEN_EXPIRED",
      integration: "calendar",
      connectUrl: "https://api.example.com/oauth/connect/calendar?projectId=project-1",
      message: "Calendar needs to be reconnected before this tool can run.",
    });
  });

  it("normalizes HTTP invalid_grant failures into reconnect-required tool output", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://api.example.com/mcp",
    });

    const result = await withMockFetch(
      async () =>
        new Response('{ "error": "invalid_grant" }', {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      async () => await source.executeTool("calendar__list_events", {}, { projectId: "project-1" }),
    );

    assertEquals(result, {
      error: "reconnect_required",
      code: "OAUTH_TOKEN_EXPIRED",
      integration: "calendar",
      connectUrl: "https://api.example.com/oauth/connect/calendar?projectId=project-1",
      message: "Calendar needs to be reconnected before this tool can run.",
    });
  });

  it("does not surface remote HTTP error bodies", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    const error = await assertRejects(
      () =>
        withMockFetch(
          async () => new Response("private payload <TOKEN> at <LOCAL_PATH>", { status: 500 }),
          async () => await source.listTools(),
        ),
      Error,
    );

    assertInstanceOf(error, Error);
    assertEquals(error.message, "Remote MCP request failed (500)");
  });

  it("preserves caller accept types while adding the MCP-required media types", async () => {
    let acceptHeader = "";

    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      headers: {
        Accept: "application/vnd.custom+json",
      },
    });

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        acceptHeader = request.headers.get("accept") ?? "";

        return Response.json({
          jsonrpc: "2.0",
          id: "docs:tools:list",
          result: {
            tools: [],
          },
        });
      },
      async () => await source.listTools(),
    );

    assertEquals(
      acceptHeader,
      "application/vnd.custom+json, application/json, text/event-stream",
    );
  });

  it("parses JSON-RPC results from SSE responses when the MCP server negotiates text/event-stream", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    const tools = await withMockFetch(
      async () =>
        new Response(
          [
            "event: message",
            'data: {"jsonrpc":"2.0","id":"docs:tools:list","result":{"tools":[{"name":"search_docs","description":"Search documentation","inputSchema":{}}]}}',
            "",
            "",
          ].join("\n"),
          {
            headers: {
              "Content-Type": "text/event-stream; charset=utf-8",
            },
          },
        ),
      async () => await source.listTools(),
    );

    assertEquals(tools, [{
      name: "search_docs",
      description: "Search documentation",
      parameters: { type: "object", properties: {} },
    }]);
  });

  it("throws when the remote MCP server responds with a JSON-RPC error", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    await assertRejects(
      () =>
        withMockFetch(async () =>
          Response.json({
            jsonrpc: "2.0",
            id: "docs:tools:list",
            error: {
              code: -32603,
              message: "upstream unavailable",
            },
          }), async () => await source.listTools()),
      Error,
      "upstream unavailable",
    );
  });

  it("rejects a JSON-RPC response for a different request", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    await assertRejects(
      () =>
        withMockFetch(async () =>
          Response.json({
            jsonrpc: "2.0",
            id: "different-request",
            result: { tools: [] },
          }), async () => await source.listTools()),
      Error,
      "response id did not match the request",
    );
  });

  it("rejects malformed tool input schemas", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    await assertRejects(
      () =>
        withMockFetch(async () =>
          Response.json({
            jsonrpc: "2.0",
            id: "docs:tools:list",
            result: {
              tools: [{
                name: "search_docs",
                description: "Search documentation",
                inputSchema: { type: "string" },
              }],
            },
          }), async () => await source.listTools()),
      Error,
      "inputSchema must describe an object",
    );
  });

  it("rejects repeated pagination cursors", async () => {
    let calls = 0;
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    await assertRejects(
      () =>
        withMockFetch(async () => {
          calls += 1;
          return Response.json({
            jsonrpc: "2.0",
            id: "docs:tools:list",
            result: { tools: [], nextCursor: "same-cursor" },
          });
        }, async () => await source.listTools()),
      Error,
      "repeated pagination cursor",
    );
    assertEquals(calls, 2);
  });

  it("bounds successful response bodies", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      maxResponseBytes: 128,
    });

    await assertRejects(
      () =>
        withMockFetch(async () =>
          Response.json({
            jsonrpc: "2.0",
            id: "docs:tools:list",
            result: {
              tools: [{
                name: "search_docs",
                description: "x".repeat(256),
                inputSchema: {},
              }],
            },
          }), async () => await source.listTools()),
      Error,
      "response exceeded 128 bytes",
    );
  });

  it("bounds outbound JSON-RPC request bodies", async () => {
    let fetchCalls = 0;
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      maxRequestBytes: 256,
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({
          jsonrpc: "2.0",
          id: "docs:tools:call:search_docs",
          result: {},
        });
      },
    });

    await assertRejects(
      () => source.executeTool("search_docs", { query: "x".repeat(512) }),
      Error,
      "request exceeded 256 bytes",
    );
    assertEquals(fetchCalls, 0);
  });

  it("rejects accessor-backed request arguments without invoking getters", async () => {
    let getterCalled = false;
    let fetchCalls = 0;
    const args = Object.defineProperty({}, "query", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "secret";
      },
    });
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({});
      },
    });

    await assertRejects(
      () => source.executeTool("search_docs", args),
      Error,
      "data properties",
    );
    assertEquals(getterCalled, false);
    assertEquals(fetchCalls, 0);
  });

  it("does not start a request after caller cancellation", async () => {
    let fetchCalls = 0;
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      fetch: async () => {
        fetchCalls += 1;
        return Response.json({});
      },
    });
    const controller = new AbortController();
    controller.abort(new Error("request cancelled"));

    await assertRejects(
      () => source.listTools({ abortSignal: controller.signal }),
      Error,
      "request cancelled",
    );
    assertEquals(fetchCalls, 0);
  });

  it("does not turn an invalid_grant abort reason into a successful reconnect result", async () => {
    const controller = new AbortController();
    const reason = new Error("invalid_grant");
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      fetch: async () => await new Promise<Response>(() => {}),
    });
    const abortTimer = setTimeout(() => controller.abort(reason), 20);

    try {
      const rejection = await assertRejects(
        () =>
          source.executeTool("calendar__list_events", {}, {
            abortSignal: controller.signal,
          }),
        Error,
        "invalid_grant",
      );
      assertStrictEquals(rejection, reason);
    } finally {
      clearTimeout(abortTimer);
    }
  });

  it("stops waiting for endpoint resolvers after caller cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("resolver cancelled");
    let resolverCalls = 0;
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: async () => {
        resolverCalls += 1;
        return await new Promise<string>(() => {});
      },
    });
    const abortTimer = setTimeout(() => controller.abort(reason), 20);
    const startedAt = Date.now();

    try {
      await assertRejects(
        () => source.listTools({ abortSignal: controller.signal }),
        Error,
        "resolver cancelled",
      );
    } finally {
      clearTimeout(abortTimer);
    }

    assertEquals(resolverCalls, 1);
    assertEquals(Date.now() - startedAt < 150, true);
  });

  it("enforces request timeouts when a fetch implementation ignores abort", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      requestTimeoutMs: 1,
      fetch: () => new Promise<Response>(() => {}),
    });

    await assertRejects(
      () => source.listTools(),
      Error,
      "request timed out after 1ms",
    );
  });

  it("does not invoke an accessor-backed error message from fetch", async () => {
    let messageReads = 0;
    const hostileError = Object.defineProperty(new Error(), "message", {
      configurable: true,
      get() {
        messageReads += 1;
        throw new Error("message getter executed");
      },
    });
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      fetch: () => Promise.reject(hostileError),
    });

    let thrown: unknown;
    try {
      await source.executeTool("search_docs", {});
    } catch (error) {
      thrown = error;
    }

    assertStrictEquals(thrown, hostileError);
    assertEquals(messageReads, 0);
  });

  it("rejects invalid client configuration", () => {
    assertThrows(
      () =>
        createRemoteMCPToolSource({
          endpoint: "https://mcp.test",
          requestTimeoutMs: 0,
        }),
      Error,
      "requestTimeoutMs must be a positive safe integer",
    );
    assertThrows(
      () =>
        createRemoteMCPToolSource({
          endpoint: "file:///tmp/mcp.sock",
        }),
      Error,
      "endpoint must use http or https",
    );

    let endpointReads = 0;
    const accessorConfig = Object.defineProperty({}, "endpoint", {
      enumerable: true,
      get() {
        endpointReads += 1;
        return "https://mcp.test";
      },
    });
    assertThrows(
      () => createRemoteMCPToolSource(accessorConfig as never),
      Error,
      "configuration must use data properties",
    );
    assertEquals(endpointReads, 0);
  });
});
