import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool";
import { defineSchema } from "../../schemas/define.ts";
import {
  augmentVeryfrontApiMcpServerPolicy,
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

describe("structured system messages", () => {
  it("preserves cache metadata while adding tool inventory", async () => {
    const staticMessage = {
      role: "system" as const,
      content: "Shared prompt",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    };
    const dynamicMessage = {
      role: "system" as const,
      content: '<project_context>\nproject_reference: "project-1"\n</project_context>',
    };

    const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      taskContext: {
        authToken: "token",
        projectId: "project-1",
        model: "anthropic/claude-sonnet-4-6",
      },
      instructions: [staticMessage, dynamicMessage],
      localTools: {},
      apiUrl: "https://api.example.com",
      apiMcpUrl: "https://api.example.com/mcp",
      allowedToolNames: [],
      createRemoteToolSource: remoteSourceFromConfig,
      preloadLatestConversationUserText: false,
    });

    assertExists(toolAssembly.systemMessages);
    assertEquals(toolAssembly.systemMessages[0], staticMessage);
    assertEquals(toolAssembly.systemMessages[1], dynamicMessage);
    assertStringIncludes(
      toolAssembly.systemMessages.at(-1)?.content ?? "",
      "Current run tool inventory:",
    );
  });
});

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

  assertEquals(toolAssembly.toolLoadingMode, "eager");
  assertEquals(toolAssembly.localToolNames, []);
  assertEquals(taskContext.availableToolNames, []);
});

Deno.test("prepareHostedChatRuntimeToolAssembly defers an omitted allowed tools catalog", async () => {
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
      form_input: localTool("Form input"),
      load_skill: localTool("Load skill"),
      sleep: localTool("Sleep"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.toolLoadingMode, "deferred");
  assertEquals(toolAssembly.availableToolNames, [
    "create_file",
    "form_input",
    "load_skill",
    "sleep",
  ]);
  assertEquals(taskContext.availableToolNames, ["load_skill", "tool_search"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly defers an unrestricted tools true catalog", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "anthropic/claude-sonnet-4-6",
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: { sleep: localTool("Sleep") },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: null,
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.toolLoadingMode, "deferred");
  assertEquals(taskContext.availableToolNames, ["tool_search"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly preserves the full deferred OpenAI catalog", async () => {
  const remoteTools = [
    ...Array.from(
      { length: 132 },
      (_, index) => remoteTool(`catalog_tool_${String(index).padStart(3, "0")}`, "Catalog tool"),
    ),
    remoteTool("write_sandbox_files", "Write sandbox files"),
  ];
  const remoteToolNames = remoteTools.map((tool) => tool.name);
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "openai/gpt-5.5",
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: { load_skill: localTool("Load skill") },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: null,
    createRemoteToolSource: (config) => ({
      id: config.id ?? "api-mcp",
      listTools: () => Promise.resolve(remoteTools),
      executeTool: () => Promise.resolve({ ok: true }),
    }),
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.toolLoadingMode, "deferred");
  assertEquals(toolAssembly.remoteToolNames, remoteToolNames);
  assertEquals(toolAssembly.compatibleRemoteToolNames, remoteToolNames);
  assertEquals(toolAssembly.availableToolNames, ["load_skill", ...remoteToolNames].sort());
  assertEquals(taskContext.availableToolNames, ["load_skill", "tool_search"]);
});

Deno.test("prepareHostedChatRuntimeToolAssembly enforces the host authorization ceiling before discovery", async () => {
  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    hostToolPolicy: { allow: ["load_skill"] },
    taskContext: {
      authToken: "token",
      projectId: "project-1",
      model: "anthropic/claude-sonnet-4-6",
      availableSkillIds: ["deploy"],
    },
    instructions: "Base instructions",
    localTools: {
      load_skill: localTool("Load skill"),
      sandbox_read_file: localTool("Read sandbox file"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: null,
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.availableToolNames.includes("load_skill"), true);
  assertEquals(toolAssembly.availableToolNames.includes("sandbox_read_file"), false);
  assertEquals(Object.hasOwn(toolAssembly.runtimeTools, "sandbox_read_file"), false);
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

Deno.test("prepareHostedChatRuntimeToolAssembly removes skill infrastructure for known empty skill runs", async () => {
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

  assertEquals(toolAssembly.localToolNames, []);
  assertEquals(taskContext.availableToolNames, []);
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

Deno.test("prepareHostedChatRuntimeToolAssembly widens the veryfront-api allowlist with server-resolved integration tools", async () => {
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
    mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: ["get_integration"] } }],
    serverResolvedIntegrationToolNames: ["outlook__list_emails"],
    allowedToolNames: ["get_integration", "outlook__list_emails", "outlook__send_email"],
    createRemoteToolSource: (config) => ({
      id: config.id ?? "api-mcp",
      listTools: () =>
        Promise.resolve([
          remoteTool("outlook__list_emails", "List Outlook emails"),
          remoteTool("outlook__send_email", "Send an Outlook email"),
          remoteTool("get_integration", "Get an integration"),
        ]),
      executeTool: () => Promise.resolve({ ok: true }),
    }),
    preloadLatestConversationUserText: false,
  });

  assertEquals(
    toolAssembly.remoteToolNames,
    ["get_integration", "outlook__list_emails"],
    "the integration grant must widen the veryfront-api allowlist for exactly the resolved names",
  );
});

Deno.test("prepareHostedChatRuntimeToolAssembly keeps the veryfront-api allowlist unchanged without an integration grant", async () => {
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
    mcpServers: [{ kind: "veryfront-api", toolPolicy: { allow: ["get_integration"] } }],
    allowedToolNames: ["get_integration", "outlook__list_emails"],
    createRemoteToolSource: (config) => ({
      id: config.id ?? "api-mcp",
      listTools: () =>
        Promise.resolve([
          remoteTool("outlook__list_emails", "List Outlook emails"),
          remoteTool("get_integration", "Get an integration"),
        ]),
      executeTool: () => Promise.resolve({ ok: true }),
    }),
    preloadLatestConversationUserText: false,
  });

  assertEquals(
    toolAssembly.remoteToolNames,
    ["get_integration"],
    "without a grant the static allowlist must keep denying integration tools",
  );
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

Deno.test("prepareHostedChatRuntimeToolAssembly falls back to local web_fetch when OpenAI lacks provider-native web_fetch", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "openai/gpt-5.4-nano",
  };

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools: {
      sleep: localTool("Sleep"),
      web_fetch: localTool("Fetch a URL"),
      write_file: localTool("Write a file"),
    },
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: ["sleep", "write_file"],
    allowedProviderToolNames: ["web_fetch"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["sleep", "web_fetch", "write_file"]);
  assertEquals(toolAssembly.providerToolNames, []);
  assertEquals(taskContext.availableToolNames, ["sleep", "web_fetch", "write_file"]);
  assertExists(toolAssembly.runtimeTools.web_fetch);
  assertStringIncludes(toolAssembly.systemInstructions, "- web_fetch");
});

Deno.test("prepareHostedChatRuntimeToolAssembly does not re-read selected local web_fetch as OpenAI fallback", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "openai/gpt-5.4-nano",
  };
  const webFetchTool = localTool("Fetch a URL");
  const localTools = {
    sleep: localTool("Sleep"),
  } as Record<string, ReturnType<typeof localTool>>;
  let webFetchAccessCount = 0;
  Object.defineProperty(localTools, "web_fetch", {
    enumerable: true,
    configurable: true,
    get() {
      webFetchAccessCount += 1;
      return webFetchTool;
    },
  });

  const toolAssembly = await prepareHostedChatRuntimeToolAssembly({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    taskContext,
    instructions: "Base instructions",
    localTools,
    apiUrl: "https://api.example.com",
    apiMcpUrl: "https://api.example.com/mcp",
    allowedToolNames: ["sleep", "web_fetch"],
    allowedProviderToolNames: ["web_fetch"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(webFetchAccessCount, 1);
  assertEquals(toolAssembly.localToolNames, ["sleep", "web_fetch"]);
  assertEquals(toolAssembly.providerToolNames, []);
  assertEquals(taskContext.availableToolNames, ["sleep", "web_fetch"]);
  assertExists(toolAssembly.runtimeTools.web_fetch);
});

Deno.test("prepareHostedChatRuntimeToolAssembly denies OpenAI local web_fetch fallback when direct allowed tools exclude it", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "openai/gpt-5.4-nano",
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
    sourceProviderToolNames: ["web_fetch"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["sleep"]);
  assertEquals(toolAssembly.providerToolNames, []);
  assertEquals(taskContext.availableToolNames, ["sleep"]);
  assertEquals(toolAssembly.runtimeTools.web_fetch, undefined);
});

Deno.test("prepareHostedChatRuntimeToolAssembly keeps empty provider allowlist as local web_fetch fallback denial", async () => {
  const taskContext: HostedChatRuntimeToolAssemblyContext = {
    authToken: "token",
    projectId: "project-1",
    model: "openai/gpt-5.4-nano",
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
    allowedProviderToolNames: [],
    sourceProviderToolNames: ["web_fetch"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["sleep"]);
  assertEquals(toolAssembly.providerToolNames, []);
  assertEquals(taskContext.availableToolNames, ["sleep"]);
  assertEquals(toolAssembly.runtimeTools.web_fetch, undefined);
});

Deno.test("prepareHostedChatRuntimeToolAssembly does not duplicate Anthropic provider-native web_fetch with the local fallback", async () => {
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
    allowedProviderToolNames: ["web_fetch"],
    sourceProviderToolNames: ["web_fetch"],
    createRemoteToolSource: remoteSourceFromConfig,
    preloadLatestConversationUserText: false,
  });

  assertEquals(toolAssembly.localToolNames, ["sleep"]);
  assertEquals(toolAssembly.providerToolNames, ["web_fetch"]);
  assertEquals(taskContext.availableToolNames, ["sleep", "web_fetch"]);
  assertEquals(toolAssembly.runtimeTools.web_fetch, undefined);
  assertStringIncludes(toolAssembly.systemInstructions, "- web_fetch");
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

describe("augmentVeryfrontApiMcpServerPolicy", () => {
  it("augmentVeryfrontApiMcpServerPolicy widens only the veryfront-api allowlist", () => {
    const servers = [
      {
        kind: "veryfront-api" as const,
        toolPolicy: { allow: ["get_integration", "outlook__upload_attachment"] },
      },
      {
        kind: "veryfront-studio" as const,
        toolPolicy: { allow: ["studio_read"] },
      },
    ];

    const augmented = augmentVeryfrontApiMcpServerPolicy(servers, [
      "outlook__list_emails",
    ]);

    assertEquals(augmented?.[0]?.toolPolicy?.allow, [
      "get_integration",
      "outlook__upload_attachment",
      "outlook__list_emails",
    ]);
    // The Studio server is untouched.
    assertEquals(augmented?.[1]?.toolPolicy?.allow, ["studio_read"]);
    // The hard-coded attachment helper keeps working.
    assertEquals(
      augmented?.[0]?.toolPolicy?.allow?.includes("outlook__upload_attachment"),
      true,
    );
  });

  it("augmentVeryfrontApiMcpServerPolicy never overrides an explicit deny", () => {
    const servers = [
      {
        kind: "veryfront-api" as const,
        toolPolicy: {
          allow: ["get_integration"],
          deny: ["outlook__send_email"],
        },
      },
    ];

    const augmented = augmentVeryfrontApiMcpServerPolicy(servers, [
      "outlook__list_emails",
      "outlook__send_email",
    ]);

    assertEquals(augmented?.[0]?.toolPolicy?.allow, [
      "get_integration",
      "outlook__list_emails",
    ]);
  });

  it("augmentVeryfrontApiMcpServerPolicy leaves unrestricted veryfront-api servers untouched", () => {
    const servers = [
      { kind: "veryfront-api" as const, toolPolicy: { deny: ["outlook__send_email"] } },
      { kind: "veryfront-api" as const },
    ];

    const augmented = augmentVeryfrontApiMcpServerPolicy(servers, ["outlook__list_emails"]);

    assertStrictEquals(augmented?.[0], servers[0], "a deny-only server has no allowlist to widen");
    assertStrictEquals(
      augmented?.[1],
      servers[1],
      "a server without toolPolicy already permits everything",
    );
    assertEquals(augmented?.[0]?.toolPolicy?.allow, undefined, "no allowlist must be synthesized");
  });

  it("augmentVeryfrontApiMcpServerPolicy leaves servers alone without a grant", () => {
    const servers = [
      { kind: "veryfront-api" as const, toolPolicy: { allow: ["get_integration"] } },
    ];

    assertEquals(augmentVeryfrontApiMcpServerPolicy(servers, []), servers);
    assertEquals(augmentVeryfrontApiMcpServerPolicy(servers, undefined), servers);
  });
});
