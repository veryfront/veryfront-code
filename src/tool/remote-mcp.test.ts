import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createRemoteMCPToolSource } from "./remote-mcp.ts";

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
});
