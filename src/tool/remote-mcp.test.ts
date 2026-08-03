import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertInstanceOf, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  createRemoteMCPToolSource,
  createRemoteMCPToolSourceWithTransportCapability,
  MAX_REMOTE_MCP_CALL_RESPONSE_BYTES,
  MAX_REMOTE_MCP_TOOL_DEFINITIONS,
  MAX_REMOTE_MCP_TOOL_LIST_PAGES,
  MAX_REMOTE_MCP_TOOL_LIST_RESPONSE_BYTES,
} from "./remote-mcp.ts";
import { createHostedControlPlaneMCPToolSourceFactory } from "#veryfront/agent/hosted/internal/control-plane-mcp-source.ts";
import {
  type AgentServiceMcpServerConfig,
  resolveAgentServiceRemoteMcpConfig,
} from "#veryfront/agent/service/mcp-server-config.ts";

describe("tool/remote-mcp", () => {
  it("uses the exact trusted control-plane endpoint for first-party list and call", async () => {
    const seenRequests: string[] = [];
    const hostFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = String(input);
      assertEquals(init?.redirect, "error");
      const body = JSON.parse(String(init?.body)) as { id: string; method: string };
      seenRequests.push(`${endpoint}:${body.method}`);
      const toolName = endpoint.includes("studio") ? "studio_suggestions" : "list_skills";
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: body.method === "tools/list"
          ? {
            tools: [{
              name: toolName,
              description: "List project skills",
              inputSchema: { type: "object" },
            }],
          }
          : { content: [{ type: "text", text: '{"skills":[]}' }] },
      });
    };
    const createSource = createHostedControlPlaneMCPToolSourceFactory(
      {
        apiMcpUrl: "http://veryfront-api:80/mcp",
        studioMcpUrl: "http://veryfront-studio:80/mcp",
      },
      { hostFetch },
    );
    const apiSource = createSource({
      id: "veryfront-mcp",
      endpoint: "http://veryfront-api:80/mcp",
      headers: { Authorization: "Bearer test-token" },
    }, "veryfront-api");
    const studioSource = createSource({
      id: "studio-mcp",
      endpoint: "http://veryfront-studio:80/mcp",
      headers: { Authorization: "Bearer test-token" },
    }, "veryfront-studio");

    assertEquals((await apiSource.listTools()).map((tool) => tool.name), ["list_skills"]);
    assertEquals(await apiSource.executeTool("list_skills", {}), { skills: [] });
    assertEquals((await studioSource.listTools()).map((tool) => tool.name), [
      "studio_suggestions",
    ]);

    assertEquals(seenRequests, [
      "http://veryfront-api/mcp:tools/list",
      "http://veryfront-api/mcp:tools/call",
      "http://veryfront-studio/mcp:tools/list",
    ]);
  });

  it("keeps trusted host transport captured when the ambient fetch changes", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        new URL("./remote-mcp-captured-host-fetch.fixture.ts", import.meta.url).pathname,
      ],
      cwd: Deno.cwd(),
      env: { DENO_TESTING: "1" },
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.success, true, stderr);
    assertEquals(JSON.parse(new TextDecoder().decode(output.stdout)), {
      attackerCalls: 0,
      capturedCalls: 1,
      toolNames: ["captured_transport"],
    });
  });

  it("keeps untrusted endpoints guarded when the host trusts first-party MCP", async () => {
    const createSource = createHostedControlPlaneMCPToolSourceFactory({
      apiMcpUrl: "http://veryfront-api:80/mcp",
      studioMcpUrl: "http://veryfront-studio:80/mcp",
    });
    const source = createSource({
      id: "custom-mcp",
      endpoint: "http://tenant-mcp:80/mcp",
    });

    await assertRejects(
      () => source.listTools(),
      Error,
      "Outbound network egress blocked",
    );
  });

  it("keeps a generic server guarded when its endpoint matches a trusted endpoint", async () => {
    let transportCalls = 0;

    await withMockFetch(() => {
      transportCalls++;
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: "response-1",
        result: { tools: [] },
      }));
    }, async () => {
      const createSource = createHostedControlPlaneMCPToolSourceFactory({
        apiMcpUrl: "http://veryfront-api:80/mcp",
      });
      const source = createSource({
        id: "generic-mcp",
        endpoint: "http://veryfront-api:80/mcp",
      });

      await assertRejects(
        () => source.listTools(),
        Error,
        "Outbound network egress blocked",
      );
    });

    assertEquals(transportCalls, 0);
  });

  it("does not trust a server kind accessor that changes after config resolution", async () => {
    let kindReads = 0;
    let transportCalls = 0;
    const endpoint = "http://veryfront-api:80/mcp";
    const server = {
      endpoint,
      headers: { Authorization: "Bearer attacker-controlled" },
      listMethod: "attacker/list",
    } as Record<string, unknown>;
    Object.defineProperty(server, "kind", {
      configurable: true,
      enumerable: true,
      get: () => kindReads++ === 0 ? "generic" : "veryfront-api",
    });

    await withMockFetch(() => {
      transportCalls++;
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: "response-1",
        result: { tools: [] },
      }));
    }, async () => {
      const resolved = resolveAgentServiceRemoteMcpConfig({
        server: server as AgentServiceMcpServerConfig,
        authToken: "host-token",
        apiMcpUrl: endpoint,
      });
      if (!resolved.config) {
        throw new Error("Expected generic MCP config");
      }
      const createSource = createHostedControlPlaneMCPToolSourceFactory({ apiMcpUrl: endpoint });
      const source = createSource(resolved.config, resolved.trustedKind);

      await assertRejects(
        () => source.listTools(),
        Error,
        "Outbound network egress blocked",
      );
    });

    assertEquals(transportCalls, 0);
  });

  it("ignores an inherited first-party kind when selecting trusted transport", async () => {
    const output = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--quiet",
        new URL("./remote-mcp-inherited-kind.fixture.ts", import.meta.url).pathname,
      ],
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    }).output();

    const stderr = new TextDecoder().decode(output.stderr);
    assertEquals(output.success, true, stderr);
    assertEquals(JSON.parse(new TextDecoder().decode(output.stdout)), {
      blocked: true,
      transportCalls: 0,
    });
  });

  it("falls back to guarded egress when an operator endpoint is unsafe", async () => {
    const warnings: Array<{ message: string; metadata: unknown }> = [];
    const createSource = createHostedControlPlaneMCPToolSourceFactory(
      { apiMcpUrl: "http://localhost/mcp" },
      {
        logger: {
          warn: (message, metadata) => warnings.push({ message, metadata }),
        },
      },
    );
    const source = createSource({
      id: "local-api-mcp",
      endpoint: "http://localhost/mcp",
    }, "veryfront-api");

    await assertRejects(
      () => source.listTools(),
      Error,
      "Outbound network egress blocked",
    );
    assertEquals(warnings, [{
      message: "Ignored invalid control-plane MCP endpoint configuration",
      metadata: { kind: "veryfront-api" },
    }]);
  });

  it("rejects forged host transport authority before invoking caller-controlled fetch", async () => {
    let transportCalls = 0;
    const source = createRemoteMCPToolSourceWithTransportCapability(
      {
        id: "forged-host-transport",
        endpoint: "https://93.184.216.34/mcp",
      },
      () => {
        transportCalls++;
        return Promise.resolve(Response.json({}));
      },
      {},
    );

    await assertRejects(
      () => source.listTools(),
      TypeError,
      "Remote MCP host transport authority required",
    );
    assertEquals(transportCalls, 0);
  });

  for (const hostilePrimordial of ["object-freeze", "promise-then"] as const) {
    it(`rejects forged authority with hostile ${hostilePrimordial}`, async () => {
      const output = await new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--quiet",
          new URL("./remote-mcp-hostile-primordial.fixture.ts", import.meta.url).pathname,
          hostilePrimordial,
        ],
        cwd: Deno.cwd(),
        stdout: "piped",
        stderr: "piped",
      }).output();

      const stderr = new TextDecoder().decode(output.stderr);
      assertEquals(output.success, true, stderr);
      assertEquals(
        JSON.parse(new TextDecoder().decode(output.stdout)),
        {
          error: "Remote MCP host transport authority required",
          transportCalls: 0,
        },
      );
    });
  }

  it("normalizes non-Error caller abort reasons", async () => {
    const controller = new AbortController();
    controller.abort("caller stopped");
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
    });

    await assertRejects(
      () => source.listTools({ abortSignal: controller.signal }),
      Error,
      "Remote MCP request was aborted",
    );
  });

  it("rejects internal MCP endpoints before invoking the configured transport", async () => {
    let calls = 0;
    const source = createRemoteMCPToolSource({
      id: "private",
      endpoint: "http://169.254.169.254/latest/meta-data",
    });

    await withMockFetch(() => {
      calls++;
      return Promise.resolve(Response.json({}));
    }, async () => {
      await assertRejects(
        () => source.listTools(),
        Error,
        "internal host",
      );
    });
    assertEquals(calls, 0);
  });

  it("lists tools from a remote MCP server using the standard JSON-RPC contract", async () => {
    let requestUrl = "";
    let requestMethod = "";
    let projectHeader = "";
    let acceptHeader = "";
    let requestBody: Record<string, unknown> | undefined;

    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: (context) => `https://93.184.216.34/${context?.projectId ?? "default"}`,
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

    assertEquals(requestUrl, "https://93.184.216.34/proj_123");
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34/mcp",
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
      connectUrl: "https://93.184.216.34/oauth/connect/calendar?projectId=project-1",
      message: "Calendar needs to be reconnected before this tool can run.",
    });
  });

  it("normalizes JSON-RPC invalid_grant errors into reconnect-required tool output", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
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
      connectUrl: "https://93.184.216.34/oauth/connect/calendar?projectId=project-1",
      message: "Calendar needs to be reconnected before this tool can run.",
    });
  });

  it("normalizes HTTP invalid_grant failures into reconnect-required tool output", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
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
      connectUrl: "https://93.184.216.34/oauth/connect/calendar?projectId=project-1",
      message: "Calendar needs to be reconnected before this tool can run.",
    });
  });

  it("does not surface remote HTTP error bodies", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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

  it("applies the tools/list response limit to SSE catalogs", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
    });
    const padding = "x".repeat(MAX_REMOTE_MCP_CALL_RESPONSE_BYTES + 1_024);

    const tools = await withMockFetch(
      async () =>
        new Response(
          `data: ${
            JSON.stringify({
              jsonrpc: "2.0",
              id: "docs:tools:list",
              result: { tools: [], padding },
            })
          }\n\n`,
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      async () => await source.listTools(),
    );

    assertEquals(tools, []);
  });

  it("throws when the remote MCP server responds with a JSON-RPC error", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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

  it("enforces UTF-8 byte budgets for remote tool identity fields", async () => {
    const cases = [
      { name: "💥".repeat(33), description: "Tool", inputSchema: {} },
      { name: "tool", description: "💥".repeat(257), inputSchema: {} },
      { name: "tool", description: "Tool", title: "💥".repeat(257), inputSchema: {} },
    ];

    for (const tool of cases) {
      const source = createRemoteMCPToolSource({
        id: "docs",
        endpoint: "https://93.184.216.34",
      });
      await assertRejects(
        () =>
          withMockFetch(
            async () =>
              Response.json({
                jsonrpc: "2.0",
                id: "docs:tools:list",
                result: { tools: [tool] },
              }),
            async () => await source.listTools(),
          ),
        Error,
        "malformed",
      );
    }
  });

  it("rejects compact remote schemas above the structural node budget", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
    });
    const emptyValue: unknown[] = [];
    const inputSchema = { enum: new Array(4_096).fill(emptyValue) };

    await assertRejects(
      () =>
        withMockFetch(
          async () =>
            Response.json({
              jsonrpc: "2.0",
              id: "docs:tools:list",
              result: {
                tools: [{ name: "wide", description: "Tool", inputSchema }],
              },
            }),
          async () => await source.listTools(),
        ),
      Error,
      "malformed input schema",
    );
  });

  it("rejects duplicate tool names and repeated pagination cursors", async () => {
    let callCount = 0;
    const duplicateSource = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://93.184.216.34",
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
      endpoint: "https://user:secret@93.184.216.34",
    });
    await assertRejects(
      () => credentialEndpointSource.listTools(),
      TypeError,
      "must not include credentials",
    );

    let redirectMode: RequestRedirect | undefined;
    const redirectSafeSource = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
      headers: { Authorization: "Bearer remote-token" },
    });

    await withMockFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
      redirectMode = init?.redirect;
      return Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:list",
        result: { tools: [] },
      });
    }, async () => await redirectSafeSource.listTools());
    // The guarded transport must observe redirects itself so it can reject the
    // destination before fetch follows it. The caller-visible mode remains
    // `error`: any redirect response is rejected by guardedOutboundFetch.
    assertEquals(redirectMode, "manual");
  });

  it("rejects cyclic outbound arguments before invoking the remote fetch", async () => {
    let fetchCalled = false;
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
    });
    await withMockFetch(async () => {
      fetchCalled = true;
      return Response.json({});
    }, async () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      await assertRejects(
        () => source.executeTool("search_docs", cyclic),
        TypeError,
        "bounded JSON object",
      );
    });
    assertEquals(fetchCalled, false);
  });
});
