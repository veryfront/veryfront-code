import { assertEquals, assertRejects } from "@std/assert";
import type {
  AgentServiceSandboxToolsOptions,
  AgentServiceSandboxToolsResult,
  CommandJob,
  CommandJobOutput,
  CreateSandboxBashTool,
} from "#veryfront/sandbox";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool";
import {
  prepareDefaultHostedChildForkSandboxToolSources,
  prepareDefaultHostedChildForkToolSources,
} from "./child-fork-tool-sources.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";

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

function commandJob(status: CommandJob["status"]): CommandJob {
  return {
    id: "job-1",
    status,
    exitCode: null,
    signal: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    heartbeatStatus: "healthy",
    lastHeartbeatAt: null,
    lastHeartbeatError: null,
    heartbeatFailureCount: 0,
  };
}

function commandJobOutput(): CommandJobOutput {
  return {
    ...commandJob("completed"),
    exitCode: 0,
    finishedAt: "2026-01-01T00:00:01.000Z",
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
  };
}

function createSandboxToolsResult(input: {
  tools?: AgentServiceSandboxToolsResult["tools"];
  closeSandbox: () => Promise<void>;
}): AgentServiceSandboxToolsResult {
  return {
    tools: input.tools ?? {},
    sandbox: {
      ensure: () => Promise.resolve(),
      close: () => Promise.resolve(),
      executeCommand: () => Promise.resolve({ stdout: "", stderr: "", exitCode: 0 }),
      startCommandJob: () => Promise.resolve(commandJob("running")),
      getCommandJob: () => Promise.resolve(commandJob("completed")),
      getCommandJobOutput: () => Promise.resolve(commandJobOutput()),
      cancelCommandJob: () => Promise.resolve(commandJob("canceled")),
      isActive: true,
      id: "sandbox-1",
      url: "https://sandbox.example",
    },
    closeSandbox: input.closeSandbox,
  };
}

Deno.test("prepareDefaultHostedChildForkToolSources loads API, live Studio, and global tools", async () => {
  const fixtures = createRemoteSourceFixtures();
  const switchedProjects: string[] = [];

  const result = await prepareDefaultHostedChildForkToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{ kind: "veryfront-api" }, { kind: "veryfront-studio" }],
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
      ["veryfront-mcp-fork", "https://api.example/mcp"],
      ["studio-mcp-live-tools", "https://studio.example/mcp"],
    ],
  );

  await result.forkTools.studio_open_project?.execute?.({ project_id: "project-2" });

  assertEquals(switchedProjects, ["project-2"]);
  assertEquals(fixtures.executeCalls, [
    {
      sourceId: "veryfront-mcp-fork",
      toolName: "get_tool_access_profile",
      args: { project_reference: "project-1" },
      context: undefined,
    },
    {
      sourceId: "studio-mcp-live-tools",
      toolName: "studio_open_project",
      args: { project_id: "project-2" },
      context: undefined,
    },
  ]);

  await result.closeStudioMcpTools?.();
});

Deno.test("prepareDefaultHostedChildForkToolSources filters API MCP tools with the tool access profile", async () => {
  const createRemoteToolSource = (config: RemoteMCPToolSourceConfig): RemoteToolSource => ({
    id: config.id ?? "source",
    listTools: () =>
      Promise.resolve([
        remoteTool("create_server"),
        remoteTool("delete_server"),
        remoteTool("update_file"),
      ]),
    executeTool: (toolName, args) => {
      if (toolName === "get_tool_access_profile") {
        return Promise.resolve({
          version: 1,
          freshness: {
            resolved_at: "2999-01-01T00:00:00.000Z",
            valid_for_ms: 60_000,
            fail_closed_on_expiry: true,
          },
          families: [
            {
              family: "runtime",
              default_decision: {
                visibility: "hidden",
                reason_code: "billing_plan_restriction",
              },
              action_overrides: [
                {
                  action: "delete_server",
                  decision: { visibility: "visible", reason_code: "allowed" },
                },
              ],
            },
          ],
        });
      }

      return Promise.resolve({ success: true, project_id: args.project_id });
    },
  });

  const result = await prepareDefaultHostedChildForkToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{ kind: "veryfront-api" }],
    getProjectId: () => "project-1",
    createRemoteToolSource,
  });

  assertEquals(result.ok, true);
  if (!result.ok) {
    return;
  }

  assertEquals(Object.keys(result.forkTools), ["delete_server", "update_file"]);
});

Deno.test("prepareDefaultHostedChildForkToolSources reports Studio setup failures", async () => {
  const logged: Array<{ message: string; metadata?: Record<string, unknown> }> = [];

  const result = await prepareDefaultHostedChildForkToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{ kind: "veryfront-studio" }],
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

Deno.test("prepareDefaultHostedChildForkSandboxToolSources merges sandbox tools and returns runtime cleanup", async () => {
  const fixtures = createRemoteSourceFixtures();
  const sandboxToolInputs: AgentServiceSandboxToolsOptions[] = [];
  let sandboxClosed = false;
  const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });

  const result = await prepareDefaultHostedChildForkSandboxToolSources({
    authToken: "token-1",
    apiUrl: "https://api.example",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{ kind: "veryfront-api" }, { kind: "veryfront-studio" }],
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
    createBashTool,
    createRemoteToolSource: fixtures.createRemoteToolSource,
    createAgentServiceSandboxTools: (sandboxInput) => {
      sandboxToolInputs.push(sandboxInput);
      return Promise.resolve(
        createSandboxToolsResult({
          tools: {
            bash: {
              description: "bash",
              execute: () => ({ ok: true }),
            },
          },
          closeSandbox: () => {
            sandboxClosed = true;
            return Promise.resolve();
          },
        }),
      );
    },
  });

  assertEquals(result.ok, true);
  if (!result.ok) {
    return;
  }

  assertEquals(Object.keys(result.forkTools), [
    "bash",
    "sleep",
    "studio_open_project",
    "update_file",
  ]);
  assertEquals(sandboxToolInputs.map((input) => [input.apiUrl, input.getProjectId?.()]), [
    ["https://api.example", "project-1"],
  ]);

  await result.closeRuntime?.();
  assertEquals(sandboxClosed, true);
  await result.closeTooling?.();
});

Deno.test("prepareDefaultHostedChildForkSandboxToolSources closes sandbox when source setup fails", async () => {
  let sandboxClosed = false;
  const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });

  const result = await prepareDefaultHostedChildForkSandboxToolSources({
    authToken: "token-1",
    apiUrl: "https://api.example",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{ kind: "veryfront-studio" }],
    getProjectId: () => "project-1",
    createBashTool,
    createLiveStudioTools: () => {
      throw new Error("studio unavailable");
    },
    createAgentServiceSandboxTools: () =>
      Promise.resolve(
        createSandboxToolsResult({
          closeSandbox: () => {
            sandboxClosed = true;
            return Promise.resolve();
          },
        }),
      ),
  });

  assertEquals(result, {
    ok: false,
    errorMessage: "MCP tool setup failed: studio unavailable",
  });
  assertEquals(sandboxClosed, true);
});
