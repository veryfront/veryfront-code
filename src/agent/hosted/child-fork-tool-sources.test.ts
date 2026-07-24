import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import type {
  AgentServiceSandboxToolsOptions,
  AgentServiceSandboxToolsResult,
  BackgroundCommand,
  BackgroundCommandOutput,
  CreateSandboxBashTool,
} from "#veryfront/sandbox";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool";
import { dynamicTool } from "#veryfront/tool";
import { defineSchema } from "../../schemas/define.ts";
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

const passthroughToolSchema = defineSchema((v) => v.object({}).passthrough())();

function remoteTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
  };
}

function toToolInputRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
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
        return Promise.resolve({
          success: true,
          project_id: "project-2",
          slug: args.project_reference,
        });
      },
    };
  };

  return { createdConfigs, executeCalls, createRemoteToolSource };
}

function commandPayload(status: BackgroundCommand["status"]): BackgroundCommand {
  return {
    id: "command-1",
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

function commandPayloadOutput(): BackgroundCommandOutput {
  return {
    ...commandPayload("completed"),
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
      startBackgroundCommand: () => Promise.resolve(commandPayload("running")),
      getBackgroundCommand: () => Promise.resolve(commandPayload("completed")),
      getBackgroundCommandOutput: () => Promise.resolve(commandPayloadOutput()),
      cancelBackgroundCommand: () => Promise.resolve(commandPayload("canceled")),
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

  await result.forkTools.studio_open_project?.execute?.({ project_reference: "project-two" });

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
      args: { project_reference: "project-two" },
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

Deno.test("prepareDefaultHostedChildForkToolSources enforces API MCP tool policy at listing and execution", async () => {
  const executed: string[] = [];
  let listedDefinitions: string[] = [];
  const result = await prepareDefaultHostedChildForkToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{
      kind: "veryfront-api",
      toolPolicy: { allow: ["update_file"], deny: ["delete_file"] },
    }],
    getProjectId: () => "project-1",
    createRemoteToolSource: (config) => ({
      id: config.id ?? "source",
      listTools: () => Promise.resolve([remoteTool("update_file"), remoteTool("delete_file")]),
      executeTool: (toolName) => {
        executed.push(toolName);
        return Promise.resolve({ ok: true });
      },
    }),
    createToolsFromRemoteDefinitions: (source, definitions) => {
      listedDefinitions = definitions.map((definition) => definition.name);
      return {
        ...Object.fromEntries(
          definitions.map((definition) => [
            definition.name,
            dynamicTool({
              id: definition.name,
              description: definition.description,
              inputSchema: passthroughToolSchema,
              execute: (input: unknown, context?: ToolExecutionContext) =>
                source.executeTool(definition.name, toToolInputRecord(input), context),
            }),
          ]),
        ),
        delete_file: dynamicTool({
          id: "delete_file",
          description: "hostile materialized denied tool",
          inputSchema: passthroughToolSchema,
          execute: (input: unknown, context?: ToolExecutionContext) =>
            source.executeTool("delete_file", toToolInputRecord(input), context),
        }),
      };
    },
  });

  assertEquals(result.ok, true);
  if (!result.ok) {
    return;
  }

  assertEquals(listedDefinitions, ["update_file"]);
  assertEquals(Object.keys(result.forkTools), ["delete_file", "update_file"]);
  await result.forkTools.update_file?.execute?.({});
  await assertRejects(
    async () => await result.forkTools.delete_file!.execute!({}),
    Error,
    'Tool "delete_file" is not allowed for this MCP server',
  );
  assertEquals(executed, ["get_tool_access_profile", "update_file"]);
});

Deno.test("prepareDefaultHostedChildForkToolSources enforces generic MCP tool policy at listing and execution", async () => {
  const executed: string[] = [];
  let listedDefinitions: string[] = [];
  const result = await prepareDefaultHostedChildForkToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{
      id: "docs",
      endpoint: "https://docs.example/mcp",
      toolPolicy: { allow: ["search_docs"], deny: ["delete_docs"] },
    }],
    getProjectId: () => "project-1",
    createRemoteToolSource: (config) => ({
      id: config.id ?? "source",
      listTools: () => Promise.resolve([remoteTool("search_docs"), remoteTool("delete_docs")]),
      executeTool: (toolName) => {
        executed.push(toolName);
        return Promise.resolve({ ok: true });
      },
    }),
    createToolsFromRemoteDefinitions: (source, definitions) => {
      listedDefinitions = definitions.map((definition) => definition.name);
      return {
        ...Object.fromEntries(
          definitions.map((definition) => [
            definition.name,
            dynamicTool({
              id: definition.name,
              description: definition.description,
              inputSchema: passthroughToolSchema,
              execute: (input: unknown, context?: ToolExecutionContext) =>
                source.executeTool(definition.name, toToolInputRecord(input), context),
            }),
          ]),
        ),
        delete_docs: dynamicTool({
          id: "delete_docs",
          description: "hostile materialized denied tool",
          inputSchema: passthroughToolSchema,
          execute: (input: unknown, context?: ToolExecutionContext) =>
            source.executeTool("delete_docs", toToolInputRecord(input), context),
        }),
      };
    },
  });

  assertEquals(result.ok, true);
  if (!result.ok) {
    return;
  }

  assertEquals(listedDefinitions, ["search_docs"]);
  assertEquals(Object.keys(result.forkTools), ["delete_docs", "search_docs"]);
  await result.forkTools.search_docs?.execute?.({});
  await assertRejects(
    async () => await result.forkTools.delete_docs!.execute!({}),
    Error,
    'Tool "delete_docs" is not allowed for this MCP server',
  );
  assertEquals(executed, ["search_docs"]);
});

Deno.test("prepareDefaultHostedChildForkToolSources enforces Studio MCP tool policy at listing and execution", async () => {
  const executed: string[] = [];
  const studioPolicy = {
    allow: ["studio_open_project"],
    deny: ["studio_delete_project"],
  };
  const result = await prepareDefaultHostedChildForkToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{
      kind: "veryfront-studio",
      toolPolicy: studioPolicy,
    }],
    studioMcpUrl: "https://studio.example/mcp",
    clientProfile: trustedStudioProfile,
    getProjectId: () => "project-1",
    createLiveStudioTools: () =>
      Promise.resolve({
        tools: {
          studio_open_project: {
            description: "Open project",
            execute: () => {
              executed.push("studio_open_project");
              return { ok: true };
            },
          },
          studio_delete_project: {
            description: "Delete project",
            execute: () => {
              executed.push("studio_delete_project");
              return { ok: true };
            },
          },
        },
        close: () => Promise.resolve(),
      }),
  });

  assertEquals(result.ok, true);
  if (!result.ok) {
    return;
  }

  assertEquals(Object.keys(result.forkTools), ["studio_open_project"]);
  assertEquals(result.forkTools.studio_delete_project, undefined);
  studioPolicy.allow = [];
  assertThrows(
    () => result.forkTools.studio_open_project?.execute?.({}),
    Error,
    'Tool "studio_open_project" is not allowed for this MCP server',
  );
  assertEquals(executed, []);
});

Deno.test("prepareDefaultHostedChildForkToolSources preserves explicit MCP opt-out", async () => {
  const result = await prepareDefaultHostedChildForkToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [],
    getProjectId: () => "project-1",
    createRemoteToolSource: () => {
      throw new Error("remote MCP source must not be created");
    },
    createLiveStudioTools: () => {
      throw new Error("Studio tools must not be created");
    },
  });

  assertEquals(result.ok, true);
  if (!result.ok) {
    return;
  }

  assertEquals(result.forkTools, {});
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

Deno.test("prepareDefaultHostedChildForkSandboxToolSources sanitizes cleanup failures", async () => {
  let closeCalls = 0;
  const logged: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
  const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });

  const result = await prepareDefaultHostedChildForkSandboxToolSources({
    authToken: "<TOKEN>",
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
            closeCalls++;
            return Promise.reject(new Error("cleanup exposed <TOKEN> at <LOCAL_PATH>"));
          },
        }),
      ),
    logger: {
      error: (message, metadata) => logged.push({ message, metadata }),
    },
  });

  assertEquals(result, {
    ok: false,
    errorMessage: "MCP tool setup failed: studio unavailable",
  });
  assertEquals(closeCalls, 1);
  assertEquals(
    logged.find((entry) => entry.message.includes("close sandbox"))?.metadata,
    { errorName: "Error" },
  );
});
