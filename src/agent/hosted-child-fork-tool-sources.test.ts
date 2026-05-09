import { assertEquals, assertRejects } from "@std/assert";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool";
import { prepareDefaultHostedChildForkToolSources } from "./hosted-child-fork-tool-sources.ts";
import type { RuntimeClientProfile } from "./runtime-client-profile.ts";

const trustedStudioProfile: RuntimeClientProfile = {
  id: "veryfront-studio",
  type: "web",
  trusted: true,
  capabilities: ["ui_panels"],
};

function remoteTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
  };
}

function createRemoteSourceFixtures() {
  const createdConfigs: RemoteMCPToolSourceConfig[] = [];
  const executeCalls: Array<{
    sourceId: string;
    toolName: string;
    args: Record<string, unknown>;
    context?: ToolExecutionContext;
  }> = [];

  const createRemoteToolSource = (config: RemoteMCPToolSourceConfig): RemoteToolSource => {
    createdConfigs.push(config);
    const sourceId = config.id ?? "source";

    return {
      id: sourceId,
      listTools: () =>
        Promise.resolve(
          sourceId === "studio-mcp-live-tools"
            ? [remoteTool("studio_open_project")]
            : [remoteTool("update_file"), remoteTool("studio_panel_control")],
        ),
      executeTool: (toolName, args, context) => {
        executeCalls.push({ sourceId, toolName, args, context });
        return Promise.resolve({ success: true, project_id: args.project_id });
      },
    };
  };

  return { createdConfigs, executeCalls, createRemoteToolSource };
}

Deno.test("prepareDefaultHostedChildForkToolSources loads API, live Studio, and global tools", async () => {
  const fixtures = createRemoteSourceFixtures();
  const switchedProjects: string[] = [];

  const result = await prepareDefaultHostedChildForkToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    studioMcpUrl: "https://studio.example/mcp",
    clientProfile: trustedStudioProfile,
    getProjectId: () => "project-1",
    conversationId: "conversation-1",
    globalTools: {
      sleep: {
        description: "sleep",
        execute: () => ({ ok: true }),
      },
    },
    onConfirmedStudioProjectSwitch: (projectId) => {
      switchedProjects.push(projectId);
    },
    createRemoteToolSource: fixtures.createRemoteToolSource,
  });

  assertEquals(result.ok, true);
  if (!result.ok) {
    return;
  }

  assertEquals(Object.keys(result.forkTools), ["sleep", "studio_open_project", "update_file"]);
  assertEquals(
    fixtures.createdConfigs.map((config) => [config.id, config.endpoint]),
    [
      ["studio-mcp-live-tools", "https://studio.example/mcp"],
      ["veryfront-mcp-fork", "https://api.example/mcp"],
    ],
  );

  await result.forkTools.studio_open_project?.execute?.({ project_id: "project-2" });

  assertEquals(switchedProjects, ["project-2"]);
  assertEquals(fixtures.executeCalls, [
    {
      sourceId: "studio-mcp-live-tools",
      toolName: "studio_open_project",
      args: { project_id: "project-2" },
      context: undefined,
    },
  ]);

  await result.closeStudioMcpTools?.();
});

Deno.test("prepareDefaultHostedChildForkToolSources reports Studio setup failures", async () => {
  const logged: Array<{ message: string; metadata?: Record<string, unknown> }> = [];

  const result = await prepareDefaultHostedChildForkToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    getProjectId: () => "project-1",
    createLiveStudioTools: () => {
      throw new Error("studio unavailable");
    },
    logger: {
      error: (message, metadata) => {
        logged.push({ message, metadata });
      },
    },
  });

  assertEquals(result, {
    ok: false,
    errorMessage: "MCP tool setup failed: studio unavailable",
  });
  assertEquals(logged.length, 1);
});

Deno.test("prepareDefaultHostedChildForkToolSources rethrows abort errors", async () => {
  const abortController = new AbortController();
  abortController.abort(new Error("fork aborted"));

  await assertRejects(
    () =>
      prepareDefaultHostedChildForkToolSources({
        authToken: "token-1",
        apiMcpUrl: "https://api.example/mcp",
        getProjectId: () => "project-1",
        abortSignal: abortController.signal,
        createLiveStudioTools: () =>
          Promise.resolve({
            tools: {},
            close: () => Promise.resolve(),
          }),
      }),
    Error,
    "fork aborted",
  );
});
