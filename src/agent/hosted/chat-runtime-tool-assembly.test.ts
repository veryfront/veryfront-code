import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool";
import { defineSchema } from "../../schemas/define.ts";
import {
  filterHostedChatRuntimeLocalTools,
  type HostedChatRuntimeToolAssemblyContext,
  prepareHostedChatRuntimeToolAssembly,
} from "./chat-runtime-tool-assembly.ts";

const unrestrictedSourceIntegrationPolicy = {
  schemaVersion: 1,
  mode: "unrestricted",
} as const;

function localTool(description: string) {
  return {
    description,
    inputSchema: defineSchema((v) => v.object({}))(),
    execute: () => ({ ok: true }),
  };
}

function remoteTool(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: "object", properties: {} },
  };
}

function remoteSourceFromConfig(config: RemoteMCPToolSourceConfig): RemoteToolSource {
  const sourceId = config.id ?? "source";
  const tools = sourceId === "studio-mcp"
    ? [remoteTool("studio_open_project", "Open a project")]
    : [remoteTool("create_file", "Create a file")];

  return {
    id: sourceId,
    listTools: () => Promise.resolve(tools),
    executeTool: (_toolName: string, _args: unknown, _context?: ToolExecutionContext) =>
      Promise.resolve({ ok: true }),
  };
}

Deno.test("filterHostedChatRuntimeLocalTools filters and sorts local tools", () => {
  const result = filterHostedChatRuntimeLocalTools({
    tools: {
      sleep: localTool("Sleep"),
      form_input: localTool("Form input"),
      invoke_agent: localTool("Invoke agent"),
    },
    allowedToolNames: new Set(["sleep", "invoke_agent"]),
  });

  assertEquals(Object.keys(result), ["invoke_agent", "sleep"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly preserves runtime-essential skill tools under non-empty allowed tools", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
    availableSkillIds: ["plan"],
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      invoke_agent: localTool("Invoke agent"),
      load_skill: localTool("Load skill"),
      sleep: localTool("Sleep"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: ["sleep"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["invoke_agent", "load_skill", "sleep"]);
  assertEquals(taskContext.availableToolNames, ["invoke_agent", "load_skill", "sleep"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly hides intake tools but keeps delegation after submitted form input", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
    availableSkillIds: ["create-agent"],
    submittedFormInputResult: {
      inputRequestId: "input-1",
      values: { brief: "make me an outlook agent" },
    },
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      form_input: localTool("Form input"),
      invoke_agent: localTool("Invoke agent"),
      load_skill: localTool("Load skill"),
      sleep: localTool("Sleep"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: ["form_input", "invoke_agent", "load_skill", "sleep"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["invoke_agent", "sleep"]);
  assertEquals(taskContext.availableToolNames, ["invoke_agent", "sleep"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly keeps empty allowed tools as explicit deny-all", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
    availableSkillIds: ["plan"],
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      invoke_agent: localTool("Invoke agent"),
      load_skill: localTool("Load skill"),
      sleep: localTool("Sleep"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: [],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, []);
  assertEquals(taskContext.availableToolNames, []);
});

Deno.test("prepareHostedChatRuntimeToolAssembly keeps skill infrastructure for config-derived empty tools", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
    availableSkillIds: ["plan"],
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      invoke_agent: localTool("Invoke agent"),
      load_skill: localTool("Load skill"),
      sleep: localTool("Sleep"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: [],
    includeRuntimeEssentialToolsWhenEmpty: true,
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["invoke_agent", "load_skill"]);
  assertEquals(taskContext.availableToolNames, ["invoke_agent", "load_skill"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly keeps the loader for config-derived empty non-skill runs", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
    availableSkillIds: [],
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      invoke_agent: localTool("Invoke agent"),
      load_skill: localTool("Load skill"),
      sleep: localTool("Sleep"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: [],
    includeRuntimeEssentialToolsWhenEmpty: true,
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["load_skill"]);
  assertEquals(taskContext.availableToolNames, ["load_skill"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly builds provider-compatible runtime inventory", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    branchId: "branch-1",
    model: "openai/gpt-4.1",
    clientProfile: {
      id: "veryfront-studio",
      type: "web",
      trusted: true,
      capabilities: ["ui_panels"],
    },
  };
  const traceSpans: string[] = [];
  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      sleep: localTool("Sleep"),
      form_input: localTool("Form input"),
      invoke_agent: localTool("Invoke agent"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    studioMcpUrl: "https://studio.example.com/mcp",
    mcpServers: [{ kind: "veryfront-api" }, { kind: "veryfront-studio" }],
    conversationId: "conversation-1",
    allowedToolNames: ["sleep", "create_file", "studio_open_project"],
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: ["studio_open_project"],
    },
    createRemoteToolSource: remoteSourceFromConfig,
    traceLocalTools: {
      trace: (spanName, operation) => {
        traceSpans.push(spanName);
        return operation();
      },
    },
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["sleep"]);
  assertEquals(toolAssembly.remoteToolNames, ["create_file", "studio_open_project"]);
  assertEquals(toolAssembly.providerToolNames, []);
  // Configured-binding remote tools ARE in the initial inventory (combined semantics).
  // The full MCP catalog does not flood the union; only the allowedToolNames subset does.
  assertEquals(toolAssembly.compatibleRemoteToolNames, ["create_file", "studio_open_project"]);
  assertEquals(taskContext.availableToolNames, ["create_file", "sleep", "studio_open_project"]);
  assertEquals(toolAssembly.systemInstructions.includes("Current run tool inventory:"), true);

  const runtimeSleepTool = toolAssembly.runtimeTools.sleep;
  assertExists(runtimeSleepTool);
  await runtimeSleepTool.execute?.({});
  assertEquals(traceSpans, ["tool.sleep"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly removes source-denied integration tools from execution and inventory", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
  };
  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {
        confluence: { allowedToolIds: ["search_content"] },
      },
    },
    taskContext,
    instructions: "Base instructions",
    localTools: {
      sleep: localTool("Sleep"),
      confluence__create_page: localTool("Create a Confluence page"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    mcpServers: [{ kind: "veryfront-api" }],
    allowedToolNames: [
      "sleep",
      "confluence__search_content",
      "confluence__create_page",
      "gmail__list_emails",
    ],
    createRemoteToolSource: (config) => ({
      id: config.id ?? "api-mcp",
      listTools: () =>
        Promise.resolve([
          remoteTool("confluence__search_content", "Search Confluence"),
          remoteTool("confluence__create_page", "Create a Confluence page"),
          remoteTool("gmail__list_emails", "List Gmail emails"),
        ]),
      executeTool: () => Promise.resolve({ ok: true }),
    }),
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["sleep"]);
  assertEquals(toolAssembly.remoteToolNames, ["confluence__search_content"]);
  assertEquals(taskContext.availableToolNames, ["confluence__search_content", "sleep"]);
  assertStringIncludes(toolAssembly.systemInstructions, "confluence__search_content");
  assertEquals(toolAssembly.systemInstructions.includes("confluence__create_page"), false);
  assertEquals(toolAssembly.systemInstructions.includes("gmail__list_emails"), false);
});

Deno.test("prepareHostedChatRuntimeToolAssembly honors explicit API-only MCP without granting Studio tools", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "openai/gpt-4.1",
    clientProfile: {
      id: "veryfront-studio",
      type: "web",
      trusted: true,
      capabilities: ["ui_panels"],
    },
  };
  const createdSourceIds: string[] = [];

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {},
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    studioMcpUrl: "https://studio.example.com/mcp",
    mcpServers: [{ kind: "veryfront-api" }],
    allowedToolNames: ["studio_open_project"],
    createRemoteToolSource: (config) => {
      createdSourceIds.push(config.id ?? "source");
      return remoteSourceFromConfig(config);
    },
    preloadLatestConversationUserText: false,
  });

  assertEquals(createdSourceIds, ["veryfront-mcp"]);
  assertEquals(toolAssembly.remoteToolNames, []);
  assertEquals(toolAssembly.compatibleRemoteToolNames, []);
  assertEquals(taskContext.availableToolNames, []);
});

Deno.test("prepareHostedChatRuntimeToolAssembly applies configured tools before the OpenAI cap", async () => {
  const availableConfiguredToolNames = ["get_agent", "get_agent_source", "update_agent"];
  const configuredToolNames = ["bash", ...availableConfiguredToolNames];
  const remoteTools = [
    ...Array.from(
      { length: 250 },
      (_, index) => remoteTool(`catalog_tool_${String(index).padStart(3, "0")}`, "Catalog tool"),
    ),
    ...availableConfiguredToolNames.map((name) => remoteTool(name, `Tool ${name}`)),
  ];
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "openai/gpt-5.4-nano",
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {},
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: configuredToolNames,
    createRemoteToolSource: (config) => ({
      id: config.id ?? "api-mcp",
      listTools: () => Promise.resolve(remoteTools),
      executeTool: () => Promise.resolve({ ok: true }),
    }),
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.remoteToolNames, availableConfiguredToolNames);
  assertEquals(toolAssembly.compatibleRemoteToolNames, availableConfiguredToolNames);
  assertEquals(taskContext.availableToolNames, availableConfiguredToolNames);
  assertEquals(taskContext.availableToolNames?.includes("catalog_tool_000"), false);
});

Deno.test("prepareHostedChatRuntimeToolAssembly resolves an owner's configured short tool name", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    agentId: "researcher",
    projectId: "project-1",
    model: "openai/gpt-5.4-nano",
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      "researcher--fetch-paper": {
        ...localTool("Fetch a paper"),
        id: "researcher--fetch-paper",
        ownerAgentId: "researcher",
        shortName: "fetch-paper",
      },
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: ["fetch-paper"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["researcher--fetch-paper"]);
  assertEquals(taskContext.availableToolNames, ["researcher--fetch-paper"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly separates provider tools from remote MCP tools", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {},
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    mcpServers: [{ kind: "veryfront-api" }],
    allowedToolNames: ["create_file"],
    allowedProviderToolNames: ["web_search"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.remoteToolNames, ["create_file"]);
  // Configured-binding remote tools appear in compatibleRemoteToolNames (combined semantics).
  assertEquals(toolAssembly.compatibleRemoteToolNames, ["create_file"]);
  assertEquals(toolAssembly.providerToolNames, ["web_search"]);
  // Both configured remote tools and provider-native tools seed the initial inventory.
  assertEquals(taskContext.availableToolNames, ["create_file", "web_search"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly separates matching direct and provider bindings", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    agentId: "researcher",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      "researcher--web_search": {
        ...localTool("Search a private corpus"),
        id: "researcher--web_search",
        ownerAgentId: "researcher",
        shortName: "web_search",
      },
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: ["web_search"],
    allowedProviderToolNames: ["web_search"],
    sourceProviderToolNames: ["web_search"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["researcher--web_search"]);
  assertEquals(toolAssembly.providerToolNames, ["web_search"]);
  assertEquals(taskContext.availableToolNames, ["researcher--web_search", "web_search"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly does not let provider bindings authorize direct tools", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    agentId: "researcher",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      "researcher--web_search": {
        ...localTool("Search a private corpus"),
        id: "researcher--web_search",
        ownerAgentId: "researcher",
        shortName: "web_search",
      },
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: [],
    allowedProviderToolNames: ["web_search"],
    sourceProviderToolNames: ["web_search"],
    createRemoteToolSource: (config) => ({
      id: config.id ?? "api-mcp",
      listTools: () => Promise.resolve([remoteTool("web_search", "Remote search")]),
      executeTool: () => Promise.resolve({ ok: true }),
    }),
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, []);
  assertEquals(toolAssembly.remoteToolNames, []);
  assertEquals(toolAssembly.providerToolNames, ["web_search"]);
  assertEquals(taskContext.availableToolNames, ["web_search"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly keeps source provider tools inside forwarded allowed tools", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      sleep: localTool("Sleep"),
      web_fetch: localTool("Fetch a URL"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: ["sleep"],
    sourceProviderToolNames: ["web_search", "web_fetch"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["sleep"]);
  assertEquals(toolAssembly.providerToolNames, []);
  assertEquals(taskContext.availableToolNames, ["sleep"]);
  assertEquals(toolAssembly.runtimeTools.web_fetch, undefined);
  assertStringIncludes(toolAssembly.systemInstructions, "- sleep");
});

Deno.test("prepareHostedChatRuntimeToolAssembly preloads default research artifacts", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          data: [{
            role: "user",
            parts: [{
              type: "text",
              text:
                "/research Research reusable agent runtimes and save the report to the project.",
            }],
          }],
        }),
        { status: 200 },
      ),
    );

  try {
    const taskContext: HostedChatRuntimeToolAssemblyContext = {
      authToken: "token",
      parentRunId: "run-1",
    };
    await prepareHostedChatRuntimeToolAssembly({
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      taskContext,
      instructions: "Base instructions",
      localTools: {},
      apiUrl: "https://api.example.com",
      apiMcpUrl: "https://api.example.com/mcp",
      createRemoteToolSource: remoteSourceFromConfig,
      conversationId: "conversation-1",
    });

    assertEquals(
      taskContext.defaultResearchArtifacts?.currentReportPath,
      "/research/reusable-agent-runtimes/report.md",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
