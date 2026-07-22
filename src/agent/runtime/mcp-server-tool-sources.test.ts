import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool";
import {
  getRequestedUnresolvedBooleanToolNames,
  getRuntimeRemoteToolSources,
  VERYFRONT_API_MCP_SOURCE_ID,
  VERYFRONT_STUDIO_MCP_SOURCE_ID,
} from "./mcp-server-tool-sources.ts";
import { VeryfrontError } from "#veryfront/errors";

Deno.test("getRequestedUnresolvedBooleanToolNames keeps legacy delegation local", () => {
  assertEquals(
    getRequestedUnresolvedBooleanToolNames({
      tools: { get_file: true, invoke_agent: true },
      agentId: "orchestrator",
    }),
    ["get_file"],
  );
});

type FetchCall = {
  url: string;
  init: RequestInit;
};

function createMcpFetch(calls: FetchCall[]): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    const result = body.method === "tools/list"
      ? {
        tools: [
          {
            name: "search_docs",
            description: "Search docs",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "delete_docs",
            description: "Delete docs",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      }
      : {
        content: [{ text: JSON.stringify({ ok: true }) }],
      };

    return Promise.resolve(
      new Response(JSON.stringify({ jsonrpc: "2.0", id: "test", result }), {
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

Deno.test("getRuntimeRemoteToolSources builds MCP sources with bearer auth and allow policy", async () => {
  const calls: FetchCall[] = [];
  const sources = getRuntimeRemoteToolSources({
    system: "Use docs.",
    tools: { search_docs: true },
    mcpServers: [{
      id: "docs",
      transport: { type: "http", url: "https://docs.example.com/mcp" },
      auth: { type: "bearer", token: () => "docs-token" },
      toolPolicy: { allow: ["search_docs"] },
      fetch: createMcpFetch(calls),
    }],
  });

  assertEquals(sources?.length, 1);
  assertEquals(await sources?.[0]?.listTools(), [{
    name: "search_docs",
    description: "Search docs",
    parameters: { type: "object", properties: {} },
  }]);
  assertEquals(new Headers(calls[0]?.init.headers).get("Authorization"), "Bearer docs-token");
});

Deno.test("getRuntimeRemoteToolSources blocks denied MCP tool execution", async () => {
  const calls: FetchCall[] = [];
  const sources = getRuntimeRemoteToolSources({
    system: "Use docs.",
    tools: { delete_docs: true },
    mcpServers: [{
      id: "docs",
      transport: { type: "http", url: "https://docs.example.com/mcp" },
      toolPolicy: { deny: ["delete_docs"] },
      fetch: createMcpFetch(calls),
    }],
  });

  assertThrows(
    () => sources![0]!.executeTool("delete_docs", {}),
    Error,
    'Tool "delete_docs" is not allowed for MCP server "docs"',
  );
  assertEquals(calls.length, 0);
});

Deno.test("getRuntimeRemoteToolSources hydrates a Veryfront API MCP server from server env", async () => {
  let remoteConfig: RemoteMCPToolSourceConfig | undefined;
  const listContexts: Array<ToolExecutionContext | undefined> = [];
  const executeCalls: Array<{
    toolName: string;
    args: unknown;
    context?: ToolExecutionContext;
  }> = [];
  const rawSource: RemoteToolSource = {
    id: "veryfront-api",
    listTools(context) {
      listContexts.push(context);
      return Promise.resolve<ToolDefinition[]>([
        {
          name: "get_file",
          description: "Read a project file",
          parameters: {
            type: "object",
            properties: {
              project_reference: { type: "string" },
              path: { type: "string" },
            },
            required: ["project_reference", "path"],
          },
        },
        {
          name: "delete_file",
          description: "Delete a project file",
          parameters: { type: "object", properties: {} },
        },
      ]);
    },
    executeTool(toolName, args, context) {
      executeCalls.push({ toolName, args, context });
      return Promise.resolve({ ok: true });
    },
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use project files.",
      tools: { get_file: true },
      mcpServers: [{
        kind: "veryfront-api",
        toolPolicy: { allow: ["get_file"] },
      }],
    },
    {
      getVeryfrontBootstrap: () => ({
        apiBaseUrl: "https://api.example/",
        apiToken: "server-token",
        projectSlug: "server-project",
        hasRequestContext: false,
        usesVeryfrontFs: false,
      }),
      createRemoteToolSource(config) {
        remoteConfig = config;
        return rawSource;
      },
    },
  );

  assertEquals(sources?.length, 1);
  assertEquals(remoteConfig?.endpoint, "https://api.example/mcp");
  assertEquals(
    await (remoteConfig?.headers as (context?: ToolExecutionContext) => HeadersInit)?.({
      authToken: "browser-token",
    }),
    { Authorization: "Bearer server-token" },
  );
  assertEquals(
    (await sources?.[0]?.listTools({ projectId: "browser-project" }))?.map((tool) => tool.name),
    ["get_file"],
  );
  await sources?.[0]?.executeTool(
    "get_file",
    { path: "AGENTS.md", project_reference: "browser-project" },
    { projectId: "browser-project" },
  );

  assertEquals(listContexts, [
    { projectId: "server-project" },
  ]);
  assertEquals(executeCalls, [{
    toolName: "get_file",
    args: { path: "AGENTS.md", project_reference: "server-project" },
    context: { projectId: "server-project" },
  }]);
});

Deno.test("getRuntimeRemoteToolSources does not synthesize tools missing from remote discovery", async () => {
  const executeCalls: Array<{ toolName: string; args: unknown; context?: ToolExecutionContext }> =
    [];
  const rawSource: RemoteToolSource = {
    id: "veryfront-api",
    listTools() {
      return Promise.resolve<ToolDefinition[]>([
        {
          name: "outlook__list_emails",
          description: "List emails",
          parameters: { type: "object", properties: {} },
        },
      ]);
    },
    executeTool(toolName, args, context) {
      executeCalls.push({ toolName, args, context });
      return Promise.resolve({ ok: true });
    },
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use project files.",
      tools: { get_file: true },
      mcpServers: [{
        kind: "veryfront-api",
        toolPolicy: { allow: ["get_file"] },
      }],
    },
    {
      getVeryfrontBootstrap: () => ({
        apiBaseUrl: "https://api.example/",
        apiToken: "server-token",
        projectSlug: "server-project",
        hasRequestContext: false,
        usesVeryfrontFs: false,
      }),
      createRemoteToolSource() {
        return rawSource;
      },
    },
  );
  assertEquals(await sources?.[0]?.listTools(), []);
  await assertRejects(
    () => sources![0]!.executeTool("get_file", { path: "AGENTS.md" }),
    Error,
    'Tool "get_file" is not advertised by remote source "veryfront-api"',
  );
  assertEquals(executeCalls, []);
});

Deno.test("getRuntimeRemoteToolSources keeps unknown missing tools unavailable", async () => {
  const rawSource: RemoteToolSource = {
    id: "veryfront-api",
    listTools() {
      return Promise.resolve<ToolDefinition[]>([]);
    },
    executeTool() {
      return Promise.resolve({ ok: true });
    },
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use a custom tool.",
      tools: { custom_project_tool: true },
      mcpServers: [{
        kind: "veryfront-api",
        toolPolicy: { allow: ["custom_project_tool"] },
      }],
    },
    {
      getVeryfrontBootstrap: () => ({
        apiBaseUrl: "https://api.example/",
        apiToken: "server-token",
        projectSlug: "server-project",
        hasRequestContext: false,
        usesVeryfrontFs: false,
      }),
      createRemoteToolSource() {
        return rawSource;
      },
    },
  );
  assertEquals(await sources?.[0]?.listTools(), []);
  await assertRejects(
    () => sources![0]!.executeTool("custom_project_tool", {}),
    Error,
    'Tool "custom_project_tool" is not advertised by remote source "veryfront-api"',
  );
});

Deno.test("getRuntimeRemoteToolSources implicitly connects unresolved named tools to Veryfront API", async () => {
  let remoteConfig: RemoteMCPToolSourceConfig | undefined;
  const rawSource: RemoteToolSource = {
    id: VERYFRONT_API_MCP_SOURCE_ID,
    listTools: () =>
      Promise.resolve([{
        name: "get_file",
        description: "Read a project file",
        parameters: { type: "object", properties: {} },
      }]),
    executeTool: () => Promise.resolve({ ok: true }),
  };

  const sources = getRuntimeRemoteToolSources(
    {
      id: "local-agent",
      system: "Use project files.",
      tools: { get_file: true },
    },
    {
      getVeryfrontBootstrap: () => ({
        apiBaseUrl: "https://api.example/",
        apiToken: "server-token",
        projectSlug: "server-project",
        hasRequestContext: false,
        usesVeryfrontFs: false,
      }),
      createRemoteToolSource(config) {
        remoteConfig = config;
        return rawSource;
      },
    },
  );

  assertEquals(remoteConfig?.endpoint, "https://api.example/mcp");
  assertEquals((await sources?.[0]?.listTools())?.map((tool) => tool.name), ["get_file"]);
});

Deno.test("getRuntimeRemoteToolSources preserves explicit MCP opt-out", () => {
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use project files only when explicitly connected.",
      tools: { get_file: true },
      mcpServers: [],
    },
    {
      getVeryfrontBootstrap() {
        throw new Error("bootstrap must not be read after explicit opt-out");
      },
    },
  );

  assertEquals(sources, undefined);
});

Deno.test("getRuntimeRemoteToolSources does not leak injected sources after explicit MCP opt-out", () => {
  const injectedApiSource: RemoteToolSource = {
    id: VERYFRONT_API_MCP_SOURCE_ID,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const injectedStudioSource: RemoteToolSource = {
    id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "No remote MCP tools.",
      mcpServers: [],
      __vfRemoteToolSources: [injectedApiSource, injectedStudioSource],
    } as Parameters<typeof getRuntimeRemoteToolSources>[0],
  );

  assertEquals(sources, undefined);
});

Deno.test("getRuntimeRemoteToolSources skips the implicit source without server identity", () => {
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use project files when a local Studio identity is available.",
      tools: { get_file: true },
    },
    {
      getVeryfrontBootstrap: () => ({
        apiBaseUrl: "https://api.veryfront.com",
        hasRequestContext: false,
        usesVeryfrontFs: false,
      }),
    },
  );

  assertEquals(sources, undefined);
});

Deno.test("getRuntimeRemoteToolSources does not attach project_reference to incompatible tools", async () => {
  const executeCalls: unknown[] = [];
  const rawSource: RemoteToolSource = {
    id: VERYFRONT_API_MCP_SOURCE_ID,
    listTools() {
      return Promise.resolve([{
        name: "health_check",
        description: "Check API health",
        parameters: { type: "object", properties: {} },
      }]);
    },
    executeTool(_toolName, args) {
      executeCalls.push(args);
      return Promise.resolve({ ok: true });
    },
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Check service health.",
      tools: { health_check: true },
      mcpServers: [{
        kind: "veryfront-api",
        toolPolicy: { allow: ["health_check"] },
      }],
    },
    {
      getVeryfrontBootstrap: () => ({
        apiBaseUrl: "https://api.example",
        apiToken: "server-token",
        projectSlug: "server-project",
        hasRequestContext: false,
        usesVeryfrontFs: false,
      }),
      createRemoteToolSource() {
        return rawSource;
      },
    },
  );

  await sources?.[0]?.executeTool(
    "health_check",
    { project_reference: "untrusted-project" },
    { projectId: "untrusted-project" },
  );

  assertEquals(executeCalls, [{}]);
});

Deno.test("getRuntimeRemoteToolSources reuses an injected Veryfront API source", () => {
  const injectedSource: RemoteToolSource = {
    id: VERYFRONT_API_MCP_SOURCE_ID,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use project files.",
      mcpServers: [{ kind: "veryfront-api" }],
      __vfRemoteToolSources: [injectedSource],
    } as Parameters<typeof getRuntimeRemoteToolSources>[0],
    {
      getVeryfrontBootstrap() {
        throw new Error("bootstrap must not be read when the source is already injected");
      },
    },
  );

  assertEquals(sources, [injectedSource]);
});

Deno.test("getRuntimeRemoteToolSources keeps only matching injected API source for explicit API-only config", () => {
  const injectedApiSource: RemoteToolSource = {
    id: VERYFRONT_API_MCP_SOURCE_ID,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const injectedStudioSource: RemoteToolSource = {
    id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use API tools.",
      mcpServers: [{ kind: "veryfront-api" }],
      __vfRemoteToolSources: [injectedApiSource, injectedStudioSource],
    } as Parameters<typeof getRuntimeRemoteToolSources>[0],
    {
      getVeryfrontBootstrap() {
        throw new Error("bootstrap must not be read when matching API source is injected");
      },
    },
  );

  assertEquals(sources, [injectedApiSource]);
});

Deno.test("getRuntimeRemoteToolSources keeps only matching injected Studio source for explicit Studio-only config", () => {
  const injectedApiSource: RemoteToolSource = {
    id: VERYFRONT_API_MCP_SOURCE_ID,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const injectedStudioSource: RemoteToolSource = {
    id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use Studio tools.",
      mcpServers: [{ kind: "veryfront-studio" }],
      __vfRemoteToolSources: [injectedApiSource, injectedStudioSource],
    } as Parameters<typeof getRuntimeRemoteToolSources>[0],
  );

  assertEquals(sources, [injectedStudioSource]);
});

Deno.test("getRuntimeRemoteToolSources enforces policy on injected Veryfront API source", async () => {
  const executeCalls: string[] = [];
  const injectedSource: RemoteToolSource = {
    id: VERYFRONT_API_MCP_SOURCE_ID,
    listTools: () =>
      Promise.resolve([
        {
          name: "get_file",
          description: "Read a file",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "delete_file",
          description: "Delete a file",
          parameters: { type: "object", properties: {} },
        },
      ]),
    executeTool: (toolName) => {
      executeCalls.push(toolName);
      return Promise.resolve({ ok: true });
    },
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use project files.",
      mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: ["get_file"] } }],
      __vfRemoteToolSources: [injectedSource],
    } as Parameters<typeof getRuntimeRemoteToolSources>[0],
  );

  assertEquals((await sources?.[0]?.listTools())?.map((tool) => tool.name), ["get_file"]);
  await sources?.[0]?.executeTool("get_file", {});
  assertThrows(
    () => sources![0]!.executeTool("delete_file", {}),
    Error,
    'Tool "delete_file" is not allowed for MCP server "veryfront-platform-mcp"',
  );
  assertEquals(executeCalls, ["get_file"]);
});

Deno.test("getRuntimeRemoteToolSources requires injected control-plane source for explicit Studio MCP", () => {
  const error = assertThrows(
    () =>
      getRuntimeRemoteToolSources({
        system: "Use Studio tools.",
        tools: { studio_open_project: true },
        mcpServers: [{ kind: "veryfront-studio" }],
      }),
    VeryfrontError,
    "trusted host-injected control-plane source",
  );
  assertEquals(error.slug, "config-invalid");
});

Deno.test("getRuntimeRemoteToolSources reuses injected Studio MCP source for explicit Studio config", () => {
  const studioSource: RemoteToolSource = {
    id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    listTools: () => Promise.resolve([]),
    executeTool: () => Promise.resolve({ ok: true }),
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use Studio tools.",
      tools: { studio_open_project: true },
      mcpServers: [{ kind: "veryfront-studio" }],
      __vfRemoteToolSources: [studioSource],
    } as Parameters<typeof getRuntimeRemoteToolSources>[0],
  );

  assertEquals(sources, [studioSource]);
});

Deno.test("getRuntimeRemoteToolSources enforces policy on injected Studio MCP source", async () => {
  const executeCalls: string[] = [];
  const studioSource: RemoteToolSource = {
    id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    listTools: () =>
      Promise.resolve([
        {
          name: "studio_open_project",
          description: "Open project",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "studio_delete_project",
          description: "Delete project",
          parameters: { type: "object", properties: {} },
        },
      ]),
    executeTool: (toolName) => {
      executeCalls.push(toolName);
      return Promise.resolve({ ok: true });
    },
  };
  const sources = getRuntimeRemoteToolSources(
    {
      system: "Use Studio tools.",
      mcpServers: [{
        kind: "veryfront-studio",
        toolPolicy: { allow: ["studio_open_project"] },
      }],
      __vfRemoteToolSources: [studioSource],
    } as Parameters<typeof getRuntimeRemoteToolSources>[0],
  );

  assertEquals((await sources?.[0]?.listTools())?.map((tool) => tool.name), [
    "studio_open_project",
  ]);
  await sources?.[0]?.executeTool("studio_open_project", {});
  assertThrows(
    () => sources![0]!.executeTool("studio_delete_project", {}),
    Error,
    'Tool "studio_delete_project" is not allowed for MCP server "studio-mcp"',
  );
  assertEquals(executeCalls, ["studio_open_project"]);
});

Deno.test("getRuntimeRemoteToolSources fails closed without Veryfront server identity", () => {
  const error = assertThrows(
    () =>
      getRuntimeRemoteToolSources(
        {
          system: "Use project files.",
          tools: { get_file: true },
          mcpServers: [{ kind: "veryfront-api" }],
        },
        {
          getVeryfrontBootstrap: () => ({
            apiBaseUrl: "https://api.veryfront.com",
            hasRequestContext: false,
            usesVeryfrontFs: false,
          }),
        },
      ),
    VeryfrontError,
    "VERYFRONT_API_TOKEN",
  );
  assertEquals(error.slug, "config-invalid");
});
