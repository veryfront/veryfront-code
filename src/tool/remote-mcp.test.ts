import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  createRemoteMCPToolSource,
  MAX_REMOTE_MCP_CALL_RESPONSE_BYTES,
  MAX_REMOTE_MCP_TOOL_DEFINITIONS,
  MAX_REMOTE_MCP_TOOL_LIST_PAGES,
  MAX_REMOTE_MCP_TOOL_LIST_RESPONSE_BYTES,
} from "./remote-mcp.ts";

describe("tool/remote-mcp", () => {
  it("lists tools from a remote MCP server using the standard JSON-RPC contract", async () => {
    let requestUrl = "";
    let requestMethod = "";
    let projectHeader = "";
    let acceptHeader = "";
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

  it("rejects successful list responses whose declared body exceeds the limit", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    await assertRejects(
      () =>
        withMockFetch(
          async () =>
            new Response("{}", {
              headers: {
                "Content-Type": "application/json",
                "Content-Length": String(MAX_REMOTE_MCP_TOOL_LIST_RESPONSE_BYTES + 1),
              },
            }),
          async () => await source.listTools(),
        ),
      Error,
      `exceeds the ${MAX_REMOTE_MCP_TOOL_LIST_RESPONSE_BYTES}-byte response limit`,
    );
  });

  it("cancels successful call response streams that exceed the body limit", async () => {
    let canceled = false;
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_REMOTE_MCP_CALL_RESPONSE_BYTES + 1));
      },
      cancel() {
        canceled = true;
      },
    });

    await assertRejects(
      () =>
        withMockFetch(
          async () =>
            new Response(body, {
              headers: { "Content-Type": "application/json" },
            }),
          async () => await source.executeTool("search_docs", {}),
        ),
      Error,
      `exceeds the ${MAX_REMOTE_MCP_CALL_RESPONSE_BYTES}-byte response limit`,
    );
    assertEquals(canceled, true);
  });

  it("rejects JSON-RPC responses with a mismatched protocol version or request id", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    await assertRejects(
      () =>
        withMockFetch(
          async () =>
            Response.json({
              jsonrpc: "1.0",
              id: "docs:tools:list",
              result: { tools: [] },
            }),
          async () => await source.listTools(),
        ),
      Error,
      'must declare jsonrpc "2.0"',
    );

    await assertRejects(
      () =>
        withMockFetch(
          async () =>
            Response.json({
              jsonrpc: "2.0",
              id: "another-request",
              result: { tools: [] },
            }),
          async () => await source.listTools(),
        ),
      Error,
      "did not match request id",
    );
  });

  it("selects only the matching JSON-RPC response from an SSE stream", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    const tools = await withMockFetch(
      async () =>
        new Response(
          [
            'data: {"jsonrpc":"2.0","id":"unrelated","result":{"tools":[{"name":"wrong","description":"Wrong","inputSchema":{}}]}}',
            "",
            'data: {"jsonrpc":"2.0","id":"docs:tools:list","result":{"tools":[{"name":"right","description":"Right","inputSchema":{}}]}}',
            "",
            "",
          ].join("\n"),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      async () => await source.listTools(),
    );

    assertEquals(tools.map((tool) => tool.name), ["right"]);
  });

  it("rejects malformed tool entries atomically instead of returning a partial catalog", async () => {
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
                tools: [
                  {
                    name: "search_docs",
                    description: "Search documentation",
                    inputSchema: {},
                  },
                  {
                    name: "",
                    description: "Malformed",
                    inputSchema: {},
                  },
                ],
              },
            }),
          async () => await source.listTools(),
        ),
      Error,
      "malformed tool definition",
    );
  });

  it("rejects duplicate tool names and repeated pagination cursors", async () => {
    let callCount = 0;
    const duplicateSource = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });

    await assertRejects(
      () =>
        withMockFetch(
          async () => {
            callCount += 1;
            return Response.json({
              jsonrpc: "2.0",
              id: "docs:tools:list",
              result: {
                tools: [{
                  name: "search_docs",
                  description: "Search documentation",
                  inputSchema: {},
                }],
                ...(callCount === 1 ? { nextCursor: "page-2" } : {}),
              },
            });
          },
          async () => await duplicateSource.listTools(),
        ),
      Error,
      'duplicate tool name "search_docs"',
    );

    callCount = 0;
    const repeatedCursorSource = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });
    await assertRejects(
      () =>
        withMockFetch(
          async () => {
            callCount += 1;
            return Response.json({
              jsonrpc: "2.0",
              id: "docs:tools:list",
              result: {
                tools: [],
                nextCursor: "same-cursor",
              },
            });
          },
          async () => await repeatedCursorSource.listTools(),
        ),
      Error,
      'repeated pagination cursor "same-cursor"',
    );
    assertEquals(callCount, 2);
  });

  it("rejects catalogs above the definition and pagination ceilings", async () => {
    const oversizedCatalogSource = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });
    const tools = Array.from(
      { length: MAX_REMOTE_MCP_TOOL_DEFINITIONS + 1 },
      (_, index) => ({
        name: `tool_${index}`,
        description: "Tool",
        inputSchema: {},
      }),
    );

    await assertRejects(
      () =>
        withMockFetch(
          async () =>
            Response.json({
              jsonrpc: "2.0",
              id: "docs:tools:list",
              result: { tools },
            }),
          async () => await oversizedCatalogSource.listTools(),
        ),
      Error,
      `cannot contain more than ${MAX_REMOTE_MCP_TOOL_DEFINITIONS} tools`,
    );

    let page = 0;
    const endlessSource = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
    });
    await assertRejects(
      () =>
        withMockFetch(
          async () => {
            page += 1;
            return Response.json({
              jsonrpc: "2.0",
              id: "docs:tools:list",
              result: { tools: [], nextCursor: `page-${page}` },
            });
          },
          async () => await endlessSource.listTools(),
        ),
      Error,
      `exceeded ${MAX_REMOTE_MCP_TOOL_LIST_PAGES} pages`,
    );
    assertEquals(page, MAX_REMOTE_MCP_TOOL_LIST_PAGES);
  });

  it("rejects unsafe endpoints and disables redirects for authenticated requests", async () => {
    const credentialEndpointSource = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://user:secret@mcp.test",
    });
    await assertRejects(
      () => credentialEndpointSource.listTools(),
      TypeError,
      "must not include credentials",
    );

    let redirectMode: RequestRedirect | undefined;
    const redirectSafeSource = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      headers: { Authorization: "Bearer remote-token" },
      fetch: (async (_input: RequestInfo | URL, init?: RequestInit) => {
        redirectMode = init?.redirect;
        return Response.json({
          jsonrpc: "2.0",
          id: "docs:tools:list",
          result: { tools: [] },
        });
      }) as typeof fetch,
    });

    await redirectSafeSource.listTools();
    assertEquals(redirectMode, "error");
  });

  it("rejects cyclic outbound arguments before invoking the remote fetch", async () => {
    let fetchCalled = false;
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://mcp.test",
      fetch: (async () => {
        fetchCalled = true;
        return Response.json({});
      }) as typeof fetch,
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await assertRejects(
      () => source.executeTool("search_docs", cyclic),
      TypeError,
      "bounded JSON object",
    );
    assertEquals(fetchCalled, false);
  });
});
