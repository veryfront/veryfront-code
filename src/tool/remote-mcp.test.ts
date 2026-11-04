import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  HEADER_METHODS,
  installCredentialProbes,
} from "#veryfront/security/http/credential-probes.test-helpers.ts";
import {
  createRemoteMCPToolSource,
  createRemoteMCPToolSourceFactoryWithTransport,
  MAX_REMOTE_MCP_CALL_RESPONSE_BYTES,
  MAX_REMOTE_MCP_TOOL_DEFINITIONS,
  MAX_REMOTE_MCP_TOOL_LIST_PAGES,
  MAX_REMOTE_MCP_TOOL_LIST_RESPONSE_BYTES,
  shareRemoteMCPProtocolState,
} from "./remote-mcp.ts";
import { getToolResultError } from "./result.ts";
import { VERSION } from "#veryfront/utils/version-constant.ts";
import { FakeTime } from "#std/testing/time";

const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientInfo": { name: "veryfront", version: VERSION },
  "io.modelcontextprotocol/clientCapabilities": {},
};

function ownHeaderValue(headers: HeadersInit | undefined, name: string): string | undefined {
  if (
    headers === undefined || typeof headers !== "object" || Array.isArray(headers) ||
    headers instanceof Headers || !Object.hasOwn(headers, name)
  ) {
    return undefined;
  }
  return headers[name];
}

describe("tool/remote-mcp", () => {
  it("preserves discovery metadata on every page without adding it to calls", async () => {
    const config = {
      id: "naming",
      endpoint: "https://93.184.216.34/mcp",
      listMeta: { "veryfront/tool-names": "legacy" },
    };
    const source = createRemoteMCPToolSource(config);
    const requests: Record<string, unknown>[] = [];
    await withMockFetch(async (_url, init) => {
      const body = JSON.parse(String(observeFetchRequestInit(init).body));
      requests.push(body.params);
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: body.method === "tools/list"
          ? {
            tools: [{
              name: body.params?.cursor ? "gmail__list_emails" : "get_file",
              description: "Read",
              inputSchema: {},
            }],
            ...(body.params?.cursor ? {} : { nextCursor: "page-2" }),
          }
          : { content: [{ type: "text", text: "ok" }] },
      });
    }, async () => {
      assertEquals((await source.listTools()).map((tool) => tool.name), [
        "get_file",
        "gmail__list_emails",
      ]);
      await source.executeTool("get_file", {});
    });
    assertEquals(requests, [
      { _meta: { ...config.listMeta, ...modernMeta } },
      { cursor: "page-2", _meta: { ...config.listMeta, ...modernMeta } },
      { name: "get_file", arguments: {}, _meta: modernMeta },
    ]);
  });

  it("uses host transport only for an exact trusted endpoint", async () => {
    let transportCalls = 0;
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: ["http://veryfront-api/mcp"],
      requestFetch: async (_input, init) => {
        transportCalls++;
        const body = JSON.parse(String(init && "body" in init ? init.body : undefined)) as {
          id: string;
        };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [] },
        });
      },
    });
    const source = createSource({
      id: "control-plane",
      endpoint: "http://veryfront-api/mcp",
    });

    assertEquals(await source.listTools(), []);
    assertEquals(transportCalls, 1);
  });

  it("normalizes default ports before matching exact trusted endpoints", async () => {
    let transportCalls = 0;
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: ["http://veryfront-api:80/mcp"],
      requestFetch: async (_input, init) => {
        transportCalls++;
        const body = JSON.parse(String(init && "body" in init ? init.body : undefined)) as {
          id: string;
        };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [] },
        });
      },
    });

    await createSource({ endpoint: "http://veryfront-api/mcp" }).listTools();
    assertEquals(transportCalls, 1);
  });

  it("normalizes empty fragment markers before matching trusted endpoints", async () => {
    let transportCalls = 0;
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: ["http://veryfront-api/mcp#"],
      requestFetch: async (_input, init) => {
        transportCalls++;
        const body = JSON.parse(
          String(init && "body" in init ? init.body : undefined),
        ) as { id: string };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [] },
        });
      },
    });

    await createSource({ endpoint: "http://veryfront-api/mcp#" }).listTools();
    assertEquals(transportCalls, 1);
  });

  it("pins trusted transport endpoints against mutable URL globals", async () => {
    const trustedEndpoint = "http://veryfront-api/mcp";
    let requestedEndpoint: RequestInfo | URL | undefined;
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: [trustedEndpoint],
      requestFetch: async (input, init) => {
        requestedEndpoint = input;
        const body = JSON.parse(
          String(init && "body" in init ? init.body : undefined),
        ) as { id: string };
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: [] },
        });
      },
    });
    const originalURL = globalThis.URL;

    try {
      globalThis.URL = class extends originalURL {
        constructor(_value: string | URL, base?: string | URL) {
          super("http://attacker.example/exfil", base);
        }
      };
      const source = createSource({ endpoint: trustedEndpoint });

      assertEquals(await source.listTools(), []);
      assertEquals(requestedEndpoint, trustedEndpoint);
    } finally {
      globalThis.URL = originalURL;
    }
  });

  it("keeps trailing-slash mismatches guarded and snapshots the allowlist", async () => {
    let transportCalls = 0;
    const trustedEndpoints = ["http://169.254.169.254/latest/meta-data/"];
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints,
      requestFetch: async () => {
        transportCalls++;
        return Response.json({});
      },
    });
    trustedEndpoints.push("http://169.254.169.254/latest/meta-data");

    const source = createSource({
      endpoint: "http://169.254.169.254/latest/meta-data",
    });
    await assertRejects(
      () => source.listTools(),
      Error,
      "Outbound network egress blocked",
    );
    assertEquals(transportCalls, 0);
  });

  it("keeps unmatched endpoints on guarded transport", async () => {
    let transportCalls = 0;
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: ["http://veryfront-api/mcp"],
      requestFetch: async () => {
        transportCalls++;
        return Response.json({});
      },
    });

    for (
      const endpoint of [
        "http://169.254.169.254/latest/meta-data",
        () => "http://169.254.169.254/latest/meta-data",
      ]
    ) {
      const source = createSource({ id: "untrusted", endpoint });
      await assertRejects(
        () => source.listTools(),
        Error,
        "Outbound network egress blocked",
      );
    }
    assertEquals(transportCalls, 0);
  });

  // The probes pin what Deno's own Headers and init processing call; Node's
  // undici takes different internal paths.
  it("keeps a source's bearer away from patched Headers members and inherited getters", {
    ignore: !isDeno,
  }, async () => {
    const BEARER = "Bearer vf-remote-mcp-run-token-canary-4b8e";
    const authorizations: (string | undefined)[] = [];
    const writerTokens: (string | undefined)[] = [];
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: ["http://veryfront-api/mcp"],
      // Stands in for the native send: it reads the null-prototype record.
      requestFetch: (_input, init) => {
        const observed = observeFetchRequestInit(init);
        authorizations.push(ownHeaderValue(observed.headers, "authorization"));
        writerTokens.push(ownHeaderValue(observed.headers, "x-veryfront-run-event-writer-token"));
        const body = JSON.parse(String(observed.body)) as { id: string };
        return Promise.resolve(
          Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } }),
        );
      },
    });
    const source = createSource({
      endpoint: "http://veryfront-api/mcp",
      headers: {
        Authorization: BEARER,
        "X-Veryfront-Run-Event-Writer-Token": "caller-supplied-writer-token",
      },
    });
    // Project code loaded in the isolate: every Headers member native fetch
    // does not call itself, and the init getters, are replaced.
    const probes = installCredentialProbes({
      headerMethods: HEADER_METHODS.filter((name) => name !== "has" && name !== "append"),
    });
    try {
      assertEquals(await source.listTools(), []);
    } finally {
      probes.restore();
    }

    assertEquals(authorizations, [BEARER]);
    assertEquals(writerTokens, [undefined]);
    assertEquals(probes.saw(BEARER), false);
  });

  it("uses host transport for dynamic project-scoped endpoints with query parameters", async () => {
    let transportCalls = 0;
    const requestUrls: string[] = [];
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: ["http://veryfront-api/mcp"],
      requestFetch: async (input, init) => {
        transportCalls++;
        requestUrls.push(String(input));
        const body = JSON.parse(String(init && "body" in init ? init.body : undefined)) as {
          id: string;
        };
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
      },
    });
    let projectId = "project-1";
    const source = createSource({
      endpoint: () => `http://veryfront-api/projects/${projectId}/mcp?environment=staging`,
    });

    assertEquals(await source.listTools(), []);
    projectId = "project-2";
    assertEquals(await source.listTools(), []);
    assertEquals(transportCalls, 2);
    assertEquals(requestUrls, [
      "http://veryfront-api/projects/project-1/mcp?environment=staging",
      "http://veryfront-api/projects/project-2/mcp?environment=staging",
    ]);
  });

  it("uses the request URL's origin and path, not query values, for trusted transport", async () => {
    let transportCalls = 0;
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: ["http://veryfront-api/mcp"],
      requestFetch: async (_input, init) => {
        transportCalls++;
        const body = JSON.parse(String(init && "body" in init ? init.body : undefined)) as {
          id: string;
        };
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
      },
    });

    await createSource({
      endpoint: "http://veryfront-api/mcp?redirect=http://169.254.169.254/latest/meta-data",
    }).listTools();
    assertEquals(transportCalls, 1);

    for (
      const endpoint of [
        "http://veryfront-api.evil.com/mcp?target=http://veryfront-api/mcp",
        "http://veryfront-api/mcp/../../../admin?target=/mcp",
      ]
    ) {
      await assertRejects(
        () => createSource({ endpoint }).listTools(),
        Error,
        "Outbound network egress blocked",
      );
    }
    assertEquals(transportCalls, 1);
  });

  it("rejects invalid trusted endpoints when the factory is created", () => {
    const error = assertThrows(
      () =>
        createRemoteMCPToolSourceFactoryWithTransport({
          trustedEndpoints: ["https://user:secret@example.com/mcp"],
          requestFetch: fetch,
        }),
      TypeError,
      "trusted endpoint",
    );
    assertInstanceOf(error, TypeError);
    assertEquals(error.message, "Invalid trusted endpoint");
  });

  it("rejects an already-aborted caller without invoking transport", async () => {
    let transportCalls = 0;
    const controller = new AbortController();
    controller.abort("caller stopped");
    const createSource = createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: ["https://93.184.216.34"],
      requestFetch: async () => {
        transportCalls++;
        throw new Error("transport should not run");
      },
    });
    const source = createSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
    });

    await assertRejects(
      () => source.listTools({ abortSignal: controller.signal }),
      Error,
      "Remote MCP request was aborted",
    );
    assertEquals(transportCalls, 0);
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
              _meta: {
                "veryfront/tool-discovery": {
                  version: 1,
                  type: "integration",
                  domain: "docs",
                  operation: "search",
                  ignored: true,
                },
              },
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
      params: { _meta: modernMeta },
    });
    assertEquals(tools, [{
      name: "search_docs",
      description: "Search documentation",
      parameters: { type: "object", properties: {} },
      discovery: { version: 1, type: "integration", domain: "docs", operation: "search" },
      title: "Search docs",
      annotations: { readOnlyHint: true },
    }]);
  });

  it("sends one argument string over 1 MiB within the request bound", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
      headers: { Authorization: "Bearer remote-token" },
    });
    const content = "A".repeat(2 * 1024 * 1024);
    let sent: unknown;

    await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      sent = await request.json();
      return Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:call:upload",
        result: { content: [{ type: "text", text: "ok" }] },
      });
    }, async () => await source.executeTool("upload", { content }));

    assertEquals(
      (sent as { params: { arguments: { content: string } } }).params.arguments.content,
      content,
    );
  });

  for (
    const [shape, result] of [
      ["structured", (content: string) => ({ content: [], structuredContent: { content } })],
      [
        "text",
        (content: string) => ({ content: [{ type: "text", text: JSON.stringify({ content }) }] }),
      ],
    ] as const
  ) {
    it(`returns one ${shape} result string over 1 MiB within the response bound`, async () => {
      const source = createRemoteMCPToolSource({
        id: "docs",
        endpoint: "https://93.184.216.34",
        headers: { Authorization: "Bearer remote-token" },
      });
      const content = "A".repeat(2 * 1024 * 1024);

      const output = await withMockFetch(
        async () =>
          Response.json({
            jsonrpc: "2.0",
            id: "docs:tools:call:download",
            result: result(content),
          }),
        async () => await source.executeTool("download", {}),
      );

      assertEquals(output, { content });
    });
  }

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
          ...modernMeta,
          run_id: "run-1",
          agent_id: "gmail-agent",
        },
      },
    });
  });

  it("omits non-binding run ids from MCP call metadata", async () => {
    let requestBody: Record<string, unknown> | undefined;
    await withEnv({ VERYFRONT_API_BASE_URL: "https://93.184.216.34" }, async () => {
      const source = createRemoteMCPToolSource({
        id: "veryfront-mcp",
        endpoint: "https://93.184.216.34/mcp",
      });

      await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          requestBody = await request.json();
          return Response.json({
            jsonrpc: "2.0",
            id: "veryfront-mcp:tools:call:gmail__get_profile",
            result: { content: [], structuredContent: { ok: true } },
          });
        },
        async () =>
          await source.executeTool("gmail__get_profile", {}, {
            runId: "run-local",
            runIdBindsToolAuthorization: false,
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
          _meta: { ...modernMeta, agent_id: "gmail-agent" },
        },
      });
    });
  });

  it("omits non-binding run ids from project-scoped control-plane MCP metadata", async () => {
    let requestBody: Record<string, unknown> | undefined;
    await withEnv({ VERYFRONT_API_BASE_URL: "https://93.184.216.34" }, async () => {
      const source = createRemoteMCPToolSource({
        id: "veryfront-mcp",
        endpoint: "https://93.184.216.34/projects/project-1/mcp?environment=staging",
      });

      await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          requestBody = await request.json();
          return Response.json({
            jsonrpc: "2.0",
            id: "veryfront-mcp:tools:call:gmail__get_profile",
            result: { content: [], structuredContent: { ok: true } },
          });
        },
        async () =>
          await source.executeTool("gmail__get_profile", {}, {
            runId: "run-local",
            runIdBindsToolAuthorization: false,
            agentId: "gmail-agent",
          }),
      );

      assertEquals(
        (requestBody as { params?: { _meta?: Record<string, unknown> } }).params?._meta,
        { ...modernMeta, agent_id: "gmail-agent" },
      );
    });
  });

  it("pins control-plane metadata classification against mutable URL globals", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const originalURL = globalThis.URL;

    await withEnv({ VERYFRONT_API_BASE_URL: "https://93.184.216.34" }, async () => {
      const source = createRemoteMCPToolSource({
        id: "veryfront-mcp",
        endpoint: "https://93.184.216.34/projects/project-1/mcp",
      });

      try {
        globalThis.URL = class extends originalURL {
          constructor(_value: string | URL, base?: string | URL) {
            super("https://attacker.example/mcp", base);
          }
        };
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            requestBody = await request.json();
            return Response.json({
              jsonrpc: "2.0",
              id: "veryfront-mcp:tools:call:gmail__get_profile",
              result: { content: [], structuredContent: { ok: true } },
            });
          },
          async () =>
            await source.executeTool("gmail__get_profile", {}, {
              runId: "run-local",
              runIdBindsToolAuthorization: false,
              agentId: "gmail-agent",
            }),
        );
      } finally {
        globalThis.URL = originalURL;
      }
    });

    assertEquals(
      (requestBody as { params?: { _meta?: Record<string, unknown> } }).params?._meta,
      { ...modernMeta, agent_id: "gmail-agent" },
    );
  });

  it("keeps run ids for same-origin MCP servers outside the control-plane path", async () => {
    let requestBody: Record<string, unknown> | undefined;
    await withEnv({ VERYFRONT_API_BASE_URL: "https://93.184.216.34" }, async () => {
      const source = createRemoteMCPToolSource({
        id: "third-party-mcp",
        endpoint: "https://93.184.216.34/custom-mcp",
      });

      await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          requestBody = await request.json();
          return Response.json({
            jsonrpc: "2.0",
            id: "third-party-mcp:tools:call:search",
            result: { content: [], structuredContent: { ok: true } },
          });
        },
        async () =>
          await source.executeTool("search", {}, {
            runId: "run-local",
            runIdBindsToolAuthorization: false,
            agentId: "gmail-agent",
          }),
      );

      // The marker means "not a Veryfront authorization binding", not "secret".
      // Third-party servers still get the id for correlation.
      assertEquals(
        (requestBody as { params?: { _meta?: Record<string, unknown> } }).params?._meta,
        { ...modernMeta, run_id: "run-local", agent_id: "gmail-agent" },
      );
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

  it("passes successful MCP tool results that mention OAuth failure tokens through untouched", async () => {
    const source = createRemoteMCPToolSource({
      id: "docs",
      endpoint: "https://93.184.216.34",
    });

    const textResult = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:call:search_docs",
        result: {
          content: [{
            type: "text",
            text: "The invalid_grant error means the refresh token expired.",
          }],
        },
      }), async () => await source.executeTool("search_docs", { query: "invalid_grant" }));

    assertEquals(
      textResult,
      "The invalid_grant error means the refresh token expired.",
      "successful tool text mentioning invalid_grant must pass through untouched",
    );

    const structuredResult = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "docs:tools:call:search_docs",
        result: { structuredContent: { doc: "expired_token appears in this doc" } },
      }), async () => await source.executeTool("search_docs", { query: "expired_token" }));

    assertEquals(
      structuredResult,
      { doc: "expired_token appears in this doc" },
      "successful structuredContent mentioning expired_token must pass through untouched",
    );
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

  it("falls back to MCP text diagnostics when structuredContent is empty", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "veryfront-mcp:tools:call:create_agent",
        result: {
          isError: true,
          structuredContent: {},
          content: [{
            text: "[already_exists] Agent already exists",
          }],
        },
      }), async () =>
      await source.executeTool("create_agent", { id: "writer" }, {
        toolCallId: "tool-call-123",
      }));

    assertEquals(result, {
      error: "already_exists",
      code: "already_exists",
      message: "[already_exists] Agent already exists",
      correlation_id: "tool-call-123",
    });
    assertEquals(getToolResultError(result), "[already_exists] Agent already exists");
  });

  it("bounds local tool-call correlation ids in text error results", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
    });
    const oversizedToolCallId = `tool-${"x".repeat(252)}`;

    const result = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "veryfront-mcp:tools:call:create_agent",
        result: {
          isError: true,
          content: [{ text: "Agent already exists" }],
        },
      }), async () =>
      await source.executeTool("create_agent", { id: "writer" }, {
        toolCallId: oversizedToolCallId,
      }));

    assertEquals(result, {
      error: "tool_error",
      code: "tool_error",
      message: "Agent already exists",
      correlation_id: oversizedToolCallId.slice(0, 256),
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
      error: "rate_limited",
      code: "rate_limited",
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
      connectUrl:
        "https://93.184.216.34/oauth/connect/calendar?project_reference=project-1&scope=user",
      message: "Calendar needs to be reconnected before this tool can run.",
    });
  });

  it("keeps tool error details with one string over 1 MiB", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
    });
    const detail = "A".repeat(2 * 1024 * 1024);

    const result = await withMockFetch(
      async () =>
        Response.json({
          jsonrpc: "2.0",
          id: "veryfront-mcp:tools:call:outlook__get_attachment",
          result: {
            isError: true,
            content: [{ text: JSON.stringify({ error: "attachment_failed", detail }) }],
          },
        }),
      async () => await source.executeTool("outlook__get_attachment", {}),
    ) as Record<string, unknown>;

    assertEquals([result.error, result.detail === detail], ["attachment_failed", true]);
  });

  it("normalizes invalid_grant structured errors with one string over 1 MiB", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
    });

    const result = await withMockFetch(
      async () =>
        Response.json({
          jsonrpc: "2.0",
          id: "veryfront-mcp:tools:call:calendar__list_events",
          result: {
            isError: true,
            content: [],
            structuredContent: { error: "invalid_grant", detail: "A".repeat(2 * 1024 * 1024) },
          },
        }),
      async () => await source.executeTool("calendar__list_events", {}),
    ) as Record<string, unknown>;

    assertEquals(result.error, "reconnect_required");
  });

  it("normalizes invalid_grant JSON-RPC error data with one string over 1 MiB", async () => {
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
            code: -32000,
            message: "Tool failed",
            data: { code: "invalid_grant", detail: "A".repeat(2 * 1024 * 1024) },
          },
        }),
      async () => await source.executeTool("calendar__list_events", {}),
    ) as Record<string, unknown>;

    assertEquals(result.error, "reconnect_required");
  });

  it("detects invalid_grant in error text that fills the response bound", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
    });
    const text = "invalid_grant " + "A".repeat(MAX_REMOTE_MCP_CALL_RESPONSE_BYTES - 256);

    const result = await withMockFetch(
      async () =>
        Response.json({
          jsonrpc: "2.0",
          id: "veryfront-mcp:tools:call:calendar__list_events",
          result: { isError: true, content: [{ text }] },
        }),
      async () =>
        await source.executeTool("calendar__list_events", {}, { toolCallId: "c".repeat(256) }),
    ) as Record<string, unknown>;

    assertEquals(result.error, "reconnect_required");
  });

  it("keeps the scope on reconnect links built without a project", async () => {
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
      async () => await source.executeTool("calendar__list_events", {}),
    );

    assertEquals(result, {
      error: "reconnect_required",
      code: "OAUTH_TOKEN_EXPIRED",
      integration: "calendar",
      connectUrl: "https://93.184.216.34/oauth/connect/calendar?scope=user",
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
      connectUrl:
        "https://93.184.216.34/oauth/connect/calendar?project_reference=project-1&scope=user",
      message: "Calendar needs to be reconnected before this tool can run.",
    });
  });

  it("returns structured JSON-RPC tool errors with correlation context", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        jsonrpc: "2.0",
        id: "veryfront-mcp:tools:call:update_skill",
        error: {
          code: -32602,
          message: "Skill validation failed",
          data: {
            code: "invalid_skill",
            request_id: "request-123",
            field: "instructions",
          },
        },
      }), async () => await source.executeTool("update_skill", { skill_id: "writer" }));

    assertEquals(result, {
      error: "invalid_skill",
      code: "invalid_skill",
      message: "Skill validation failed",
      request_id: "request-123",
      json_rpc_code: -32602,
    });
    assertEquals(getToolResultError(result), "Skill validation failed");
  });

  it("rejects malformed JSON-RPC tool error envelopes", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
    });

    for (
      const error of [
        null,
        "failed",
        { message: "Missing error code" },
        { code: -32603, message: " " },
      ]
    ) {
      await assertRejects(
        () =>
          withMockFetch(
            async () =>
              Response.json({
                jsonrpc: "2.0",
                id: "veryfront-mcp:tools:call:update_skill",
                error,
              }),
            async () => await source.executeTool("update_skill", {}),
          ),
        Error,
        "malformed JSON-RPC error object",
      );
    }
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
      connectUrl:
        "https://93.184.216.34/oauth/connect/calendar?project_reference=project-1&scope=user",
      message: "Calendar needs to be reconnected before this tool can run.",
    });
  });

  it("pins reconnect metadata URL construction against mutable URL globals", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
    });
    const originalURL = globalThis.URL;
    const originalSearchParams = Object.getOwnPropertyDescriptor(
      originalURL.prototype,
      "searchParams",
    );

    try {
      globalThis.URL = class extends originalURL {
        constructor(_value: string | URL, base?: string | URL) {
          super("https://attacker.example/oauth/connect/forged", base);
        }
      };
      Object.defineProperty(originalURL.prototype, "searchParams", {
        configurable: true,
        get() {
          return {
            set() {
              throw new Error("URLSearchParams hook must not run");
            },
          };
        },
      });

      const result = await withMockFetch(
        () =>
          Promise.resolve(
            new Response('{ "error": "invalid_grant" }', {
              status: 400,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        async () =>
          await source.executeTool("calendar__list_events", {}, { projectId: "project-1" }),
      );

      assertEquals(result, {
        error: "reconnect_required",
        code: "OAUTH_TOKEN_EXPIRED",
        integration: "calendar",
        connectUrl:
          "https://93.184.216.34/oauth/connect/calendar?project_reference=project-1&scope=user",
        message: "Calendar needs to be reconnected before this tool can run.",
      });
    } finally {
      globalThis.URL = originalURL;
      if (originalSearchParams) {
        Object.defineProperty(originalURL.prototype, "searchParams", originalSearchParams);
      }
    }
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

  it("keeps unexpected tool transport failures on the exception path", async () => {
    const source = createRemoteMCPToolSource({
      id: "veryfront-mcp",
      endpoint: "https://93.184.216.34/mcp",
    });

    const error = await assertRejects(
      () =>
        withMockFetch(
          async () => new Response("private payload <TOKEN>", { status: 503 }),
          async () => await source.executeTool("create_agent", { id: "writer" }),
        ),
      Error,
    );

    assertInstanceOf(error, Error);
    assertEquals(error.message, "Remote MCP request failed (503)");
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

// Remote MCP HTTP session behavior (formerly tests/integration/tool/remote-mcp-protocol.test.ts).
{
  const ENDPOINT = "https://93.184.216.34/mcp";
  const TOOL = { name: "ping", description: "Ping", inputSchema: { type: "object" } };
  type RequestBody = { id?: string; method: string; params?: Record<string, unknown> };
  interface ObservedRequest {
    endpoint: string;
    method: string;
    headers: Headers;
    body?: RequestBody;
  }
  const observe = (input: RequestInfo | URL, init?: RequestInit): ObservedRequest => {
    const request = observeFetchRequestInit(init);
    return {
      endpoint: String(input),
      method: request.method ?? "GET",
      headers: new Headers(request.headers),
      body: request.body ? JSON.parse(String(request.body)) : undefined,
    };
  };
  const success = (body: RequestBody): Response => {
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      result: body.method === "tools/list"
        ? { tools: [TOOL] }
        : { content: [{ type: "text", text: "pong" }] },
    });
  };
  const legacyFixture = () => {
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
  };

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
          if (body.method === "notifications/initialized") {
            return new Response(null, { status: 202 });
          }
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
          assertEquals(observeFetchRequestInit(init).signal?.aborted, false);
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
          const signal = observeFetchRequestInit(init).signal!;
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
        assertEquals(
          await source.executeTool("ping", {}, { userId: "modern", runId: "r" }),
          "pong",
        );
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
}

// Remote MCP HTTP session behavior (formerly tests/integration/tool/remote-mcp-session-security.test.ts).
{
  const ENDPOINT = "https://93.184.216.34/mcp";
  const fixture = (failNotification = false) => {
    const live = new Map<string, string>();
    const deleted: string[] = [];
    let next = 0;
    const requestFetch: typeof fetch = (async (_input, init) => {
      const request = observeFetchRequestInit(init);
      const headers = new Headers(request.headers);
      const identity = headers.get("authorization") ?? "anonymous";
      const sessionId = headers.get("Mcp-Session-Id");
      if (request.method === "DELETE") {
        assertEquals(live.get(sessionId!), identity);
        deleted.push(sessionId!);
        live.delete(sessionId!);
        return new Response(null, { status: 204 });
      }
      const body = JSON.parse(String(request.body));
      if (body.method === "initialize") {
        const session = `test-session-${++next}`;
        live.set(session, identity);
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            serverInfo: { name: "fixture", version: "1" },
          },
        }, { headers: { "Mcp-Session-Id": session } });
      }
      if (body.method === "notifications/initialized") {
        return new Response(null, { status: failNotification ? 503 : 202 });
      }
      if (!sessionId) return new Response("initialize first", { status: 400 });
      assertEquals(live.get(sessionId), identity);
      return Response.json({ jsonrpc: "2.0", id: body.id, result: { tools: [] } });
    }) as typeof fetch;
    return { requestFetch, live, deleted };
  };

  describe("remote MCP session security", () => {
    for (const failure of ["malformed", "oversized", "interrupted", "unsupported-version"]) {
      it(`retains the minted session when initialize is ${failure}`, async () => {
        const deleted: string[] = [];
        await withMockFetch(async (_input, init) => {
          const request = observeFetchRequestInit(init);
          const headers = new Headers(request.headers);
          if (request.method === "DELETE") {
            assertEquals(headers.get("authorization"), "Bearer original-credential");
            deleted.push(headers.get("Mcp-Session-Id")!);
            return new Response(null, { status: 204 });
          }
          const body = JSON.parse(String(request.body));
          if (body.method !== "initialize") {
            return new Response("initialize first", { status: 400 });
          }
          const responseHeaders = { "Mcp-Session-Id": "minted-before-parse" };
          if (failure === "malformed") return new Response("{", { headers: responseHeaders });
          if (failure === "oversized") {
            return new Response("x".repeat(MAX_REMOTE_MCP_CALL_RESPONSE_BYTES + 1), {
              headers: responseHeaders,
            });
          }
          if (failure === "interrupted") {
            return new Response(
              new ReadableStream({
                pull(controller) {
                  controller.error(new Error("initialize body interrupted"));
                },
              }),
              { headers: responseHeaders },
            );
          }
          return Response.json({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "unsupported" },
          }, { headers: responseHeaders });
        }, async () => {
          const source = createRemoteMCPToolSource({
            endpoint: ENDPOINT,
            headers: { Authorization: "Bearer original-credential" },
          });
          await assertRejects(() => source.listTools({ runId: "owning-run" }));
          await source.dispose?.({ runId: "other-run" });
          assertEquals(deleted, []);
          await source.dispose?.({ runId: "owning-run" });
          assertEquals(deleted, ["minted-before-parse"]);
          await source.dispose?.();
          assertEquals(deleted.length, 1);
        });
      });
    }

    it("keeps credential keys distinct when project code patches Array.from", async () => {
      const server = fixture();
      await withMockFetch(server.requestFetch, async () => {
        let credential = "Bearer fixture-one";
        const source = createRemoteMCPToolSource({
          endpoint: ENDPOINT,
          headers: () => ({ Authorization: credential }),
        });
        const original = Array.from;
        Array.from = ((...args: unknown[]) => {
          if (args[0] instanceof Uint8Array && args[0].length === 32) return ["constant-key"];
          return Reflect.apply(original, Array, args);
        }) as typeof Array.from;
        try {
          await source.listTools();
          credential = "Bearer fixture-two";
          await source.listTools();
        } finally {
          Array.from = original;
        }
        assertEquals(server.live.size, 2);
        await source.dispose?.();
      });
    });

    it("keeps cleanup credentials away from a patched Array iterator", async () => {
      const server = fixture();
      await withMockFetch(server.requestFetch, async () => {
        const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
        await source.listTools();
        const original = Array.prototype[Symbol.iterator];
        let leaked = false;
        Array.prototype[Symbol.iterator] = function () {
          if (this.length === 2 && typeof this[1] === "object" && this[1]?.sessionId) leaked = true;
          return Reflect.apply(original, this, []);
        };
        try {
          await source.dispose?.();
        } finally {
          Array.prototype[Symbol.iterator] = original;
        }
        assertEquals(leaked, false);
        assertEquals(server.live.size, 0);
      });
    });

    it("deletes a minted session when the initialized notification fails", async () => {
      const server = fixture(true);
      await withMockFetch(server.requestFetch, async () => {
        const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
        await assertRejects(() => source.listTools());
        assertEquals(server.live.size, 1);
        await source.dispose?.();
        assertEquals(server.live.size, 0);
      });
    });

    it("retains every minted session across repeated failed initialization", async () => {
      const server = fixture(true);
      await withMockFetch(server.requestFetch, async () => {
        const source = createRemoteMCPToolSource({ endpoint: ENDPOINT });
        await assertRejects(() => source.listTools());
        await assertRejects(() => source.listTools());
        assertEquals(server.live.size, 2);
        await source.dispose?.();
        assertEquals(server.live.size, 0);
        assertEquals(server.deleted.length, 2);
      });
    });

    it("cleans every retained credential for a run without resolving rotated credentials", async () => {
      const server = fixture();
      await withMockFetch(server.requestFetch, async () => {
        let credential = "Bearer fixture-one";
        let stopped = false;
        const source = createRemoteMCPToolSource({
          endpoint: ENDPOINT,
          headers: () => {
            if (stopped) throw new Error("resolver unavailable after abort");
            return { Authorization: credential };
          },
        });
        await source.listTools({ runId: "run-one" });
        credential = "Bearer fixture-two";
        await source.listTools({ runId: "run-one" });
        await source.listTools({ runId: "run-two" });
        stopped = true;
        await source.dispose?.({ runId: "run-one" });
        assertEquals(server.live.size, 1);
        assertEquals(server.deleted.length, 2);
        await source.dispose?.();
        assertEquals(server.live.size, 0);
      });
    });
  });
}

// Remote MCP session lifecycle: disposal races, shared protocol state and
// primordial use on credential-bearing paths.
{
  const ENDPOINT = "http://veryfront-api/mcp";
  type Body = { id?: string; method: string; params?: Record<string, unknown> };
  type Seen = { method: string; headers: Headers; body?: Body };
  const deferred = () => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => resolve = done);
    return { promise, resolve };
  };
  const createServer = () => {
    const seen: Seen[] = [];
    const live = new Set<string>();
    let next = 0;
    let mode: "legacy" | "modern" = "legacy";
    let sessionlessGate: Promise<void> | undefined;
    let initializeGate: Promise<void> | undefined;
    const sessionlessReached = deferred();
    const initializeReached = deferred();
    const tool = {
      name: "ping",
      description: "Ping",
      inputSchema: {
        type: "object",
        properties: { region: { type: "string", "x-mcp-header": "Region" } },
      },
    };
    const requestFetch: typeof fetch = async (_input, init) => {
      const request = observeFetchRequestInit(init);
      const headers = new Headers(request.headers);
      if (request.method === "DELETE") {
        seen.push({ method: "DELETE", headers });
        live.delete(headers.get("Mcp-Session-Id")!);
        return new Response(null, { status: 204 });
      }
      const body = JSON.parse(String(request.body)) as Body;
      seen.push({ method: body.method, headers, body });
      const sessionId = headers.get("Mcp-Session-Id");
      if (body.method === "initialize") {
        initializeReached.resolve();
        if (initializeGate) await initializeGate;
        if (mode === "modern") return new Response("initialize unsupported", { status: 400 });
        const id = `lifecycle-session-${++next}`;
        live.add(id);
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            serverInfo: { name: "fixture", version: "1" },
          },
        }, { headers: { "Mcp-Session-Id": id } });
      }
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      if (!sessionId) {
        sessionlessReached.resolve();
        if (sessionlessGate) await sessionlessGate;
        if (mode === "legacy") return new Response("initialize first", { status: 400 });
      } else if (!live.has(sessionId)) {
        return new Response("unknown session", { status: 404 });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: body.method === "tools/list"
          ? { tools: [tool] }
          : { content: [{ type: "text", text: "pong" }] },
      });
    };
    return {
      seen,
      live,
      requestFetch,
      sessionlessReached: sessionlessReached.promise,
      initializeReached: initializeReached.promise,
      setMode: (value: "legacy" | "modern") => mode = value,
      holdSessionless: (gate: Promise<void>) => sessionlessGate = gate,
      holdInitialize: (gate: Promise<void>) => initializeGate = gate,
      methods: () => seen.map((entry) => entry.method),
    };
  };
  const sourceFor = (
    server: ReturnType<typeof createServer>,
    config: Partial<Parameters<typeof createRemoteMCPToolSource>[0]> = {},
  ) =>
    createRemoteMCPToolSourceFactoryWithTransport({
      trustedEndpoints: [ENDPOINT],
      requestFetch: server.requestFetch,
    })({ endpoint: ENDPOINT, ...config });

  describe("remote MCP session lifecycle", () => {
    it("refuses session deletion after project code replaced a Headers member", async () => {
      const server = createServer();
      const source = sourceFor(server, { headers: { Authorization: "Bearer cleanup-canary" } });
      await source.listTools();
      assertEquals(server.live.size, 1);
      const original = Headers.prototype.has;
      Headers.prototype.has = function (this: Headers, name: string) {
        return Reflect.apply(original, this, [name]);
      };
      try {
        await assertRejects(() => source.dispose!(), TypeError, "Refused");
      } finally {
        Headers.prototype.has = original;
      }
      assertEquals(server.methods().includes("DELETE"), false);
    });

    it("awaits in-flight handshakes without a patched Promise.allSettled", async () => {
      const server = createServer();
      const release = deferred();
      server.holdInitialize(release.promise);
      const source = sourceFor(server);
      const listing = source.listTools().catch((error: unknown) => error);
      await server.initializeReached;
      const original = Promise.allSettled;
      let observed = false;
      Promise.allSettled = function (this: PromiseConstructor, values: Iterable<unknown>) {
        observed = true;
        return Reflect.apply(original, this, [values]);
      } as typeof Promise.allSettled;
      let disposing: Promise<void>;
      try {
        disposing = source.dispose!();
      } finally {
        Promise.allSettled = original;
      }
      release.resolve();
      await disposing;
      await listing;
      assertEquals(observed, false);
      assertEquals(server.methods().includes("DELETE"), true);
      assertEquals(server.live.size, 0);
    });

    it("does not negotiate a session after disposal overlapped a sessionless request", async () => {
      const server = createServer();
      const release = deferred();
      server.holdSessionless(release.promise);
      const source = sourceFor(server);
      const listing = source.listTools({ runId: "run-a" });
      await server.sessionlessReached;
      await source.dispose!({ runId: "run-a" });
      release.resolve();
      await assertRejects(() => listing, Error, "disposed");
      assertEquals(server.methods().includes("initialize"), false);
      assertEquals(server.live.size, 0);
    });

    it("stops initializing calls once a sessionless request proves the modern protocol", async () => {
      const server = createServer();
      const source = sourceFor(server);
      await source.listTools({ runId: "run-a" });
      server.setMode("modern");
      await source.listTools({ runId: "run-b" });
      const before = server.seen.length;
      assertEquals(await source.executeTool("ping", {}, { runId: "run-c" }), "pong");
      assertEquals(server.methods().slice(before), ["tools/call"]);
    });

    it("lets credential-specialized sources reuse the ordinary source's legacy discovery", async () => {
      const server = createServer();
      const shared = shareRemoteMCPProtocolState({
        endpoint: ENDPOINT,
        headers: { Authorization: "Bearer ordinary" },
      });
      const ordinary = sourceFor(server, shared);
      const terminal = sourceFor(server, {
        ...shared,
        headers: { Authorization: "Bearer ordinary", "X-Terminal-Token": "terminal" },
      });
      await ordinary.listTools({ runId: "run-a" });
      const before = server.seen.length;
      assertEquals(await terminal.executeTool("ping", {}, { runId: "run-a" }), "pong");
      assertEquals(server.methods().slice(before), [
        "initialize",
        "notifications/initialized",
        "tools/call",
      ]);
      assertEquals(server.seen.at(-1)!.headers.get("X-Terminal-Token"), "terminal");
      await ordinary.dispose!();
      await terminal.dispose!();
      assertEquals(server.live.size, 0);
    });

    it("lets credential-specialized sources send the header annotations discovery recorded", async () => {
      const server = createServer();
      server.setMode("modern");
      const shared = shareRemoteMCPProtocolState({ endpoint: ENDPOINT });
      const ordinary = sourceFor(server, shared);
      const mutation = sourceFor(server, { ...shared, headers: { "X-Event-Token": "event" } });
      await ordinary.listTools();
      assertEquals(await mutation.executeTool("ping", { region: "eu" }), "pong");
      assertEquals(server.seen.at(-1)!.headers.get("Mcp-Param-Region"), "eu");
      // Sources outside the shared scope keep their own discovery state.
      const unrelated = sourceFor(server, { headers: { "X-Event-Token": "event" } });
      assertEquals(await unrelated.executeTool("ping", { region: "eu" }), "pong");
      assertEquals(server.seen.at(-1)!.headers.get("Mcp-Param-Region"), null);
    });

    it("keeps header arguments and session ids off patched String and RegExp members", async () => {
      const legacyServer = createServer();
      const legacy = sourceFor(legacyServer);
      await legacy.listTools({ runId: "run-a" });
      const modernServer = createServer();
      modernServer.setMode("modern");
      const modern = sourceFor(modernServer);
      await modern.listTools();
      const seenValues: unknown[] = [];
      const record = <T extends object, K extends keyof T>(target: T, key: K) => {
        const original = target[key] as (...args: unknown[]) => unknown;
        target[key] = function (this: unknown, ...args: unknown[]) {
          seenValues.push(this, ...args);
          return Reflect.apply(original, this, args);
        } as T[K];
        return () => target[key] = original as T[K];
      };
      const restores = [
        record(String.prototype, "trim"),
        record(String.prototype, "startsWith"),
        record(String.prototype, "endsWith"),
        record(String, "fromCodePoint"),
        record(RegExp.prototype, "test"),
      ];
      try {
        // A new run of a legacy identity initializes and validates a minted id.
        assertEquals(await legacy.executeTool("ping", {}, { runId: "run-b" }), "pong");
        // Modern calls encode schema-declared arguments into headers.
        assertEquals(await modern.executeTool("ping", { region: "ascii-canary" }), "pong");
        assertEquals(await modern.executeTool("ping", { region: "ünicode-canary" }), "pong");
      } finally {
        for (const restore of restores) restore();
      }
      assertEquals(
        modernServer.seen.at(-1)!.headers.get("Mcp-Param-Region")?.startsWith("=?base64?"),
        true,
      );
      const leaked = seenValues.filter((value) =>
        typeof value === "string" &&
        (value.includes("canary") || value.startsWith("lifecycle-session-"))
      );
      assertEquals(leaked, []);
      // Non-ASCII values reach fromCodePoint byte by byte.
      assertEquals(seenValues.includes(new TextEncoder().encode("ü")[0]), false);
    });
  });
}
