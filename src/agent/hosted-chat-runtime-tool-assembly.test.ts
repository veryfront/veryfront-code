import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool";
import { z } from "zod";
import {
  filterHostedChatRuntimeLocalTools,
  type HostedChatRuntimeToolAssemblyContext,
  prepareHostedChatRuntimeToolAssembly,
} from "./hosted-chat-runtime-tool-assembly.ts";

function localTool(description: string) {
  return {
    description,
    inputSchema: z.object({}),
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
    studioMcpEnabled: true,
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
  assertEquals(toolAssembly.compatibleRemoteToolNames, ["create_file", "studio_open_project"]);
  assertEquals(taskContext.availableToolNames, ["create_file", "sleep", "studio_open_project"]);
  assertEquals(toolAssembly.systemInstructions.includes("Current run tool inventory:"), true);

  const runtimeSleepTool = toolAssembly.runtimeTools.sleep;
  assertExists(runtimeSleepTool);
  await runtimeSleepTool.execute?.({});
  assertEquals(traceSpans, ["tool.sleep"]);
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
