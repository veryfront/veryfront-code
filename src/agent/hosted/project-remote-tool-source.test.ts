import { assertEquals, assertRejects } from "@std/assert";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool";
import {
  createHostedProjectRemoteToolSource,
  createHostedProjectRemoteToolSources,
} from "./project-remote-tool-source.ts";

function projectFileTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: {
      type: "object",
      properties: {
        project_reference: { type: "string" },
        path: { type: "string" },
      },
      required: ["project_reference", "path"],
    },
  };
}

function navigationTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: {
      type: "object",
      properties: {
        project_id: { type: "string" },
      },
      required: ["project_id"],
    },
  };
}

function simpleTool(name: string): ToolDefinition {
  return {
    name,
    description: `${name} description`,
    parameters: { type: "object", properties: {} },
  };
}

function createRemoteSource(input: {
  id?: string;
  tools: ToolDefinition[];
  execute?: (
    toolName: string,
    args: unknown,
    context?: ToolExecutionContext,
  ) => Promise<unknown> | unknown;
}): RemoteToolSource {
  return {
    id: input.id ?? "source-1",
    listTools: () => Promise.resolve(input.tools),
    executeTool: async (toolName, args, context) =>
      input.execute?.(toolName, args, context) ?? { ok: true },
  };
}

async function resolveTestHeaders(
  headers: RemoteMCPToolSourceConfig["headers"],
): Promise<HeadersInit | undefined> {
  return typeof headers === "function" ? await headers() : headers;
}

Deno.test("createHostedProjectRemoteToolSource scopes tool listings and hydrates project inputs", async () => {
  const executeCalls: Array<{ toolName: string; args: unknown; context?: ToolExecutionContext }> =
    [];
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("update_file"), navigationTool("studio_open_project")],
      execute: (toolName, args, context) => {
        executeCalls.push({ toolName, args, context });
        return { ok: true };
      },
    }),
    defaultProjectId: () => "project-1",
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: ["studio_open_project"],
    },
  });

  assertEquals(
    (await source.listTools()).map((tool) => tool.name),
    ["update_file", "studio_open_project"],
  );

  await source.executeTool("update_file", { path: "AGENTS.md" });

  assertEquals(executeCalls, [
    {
      toolName: "update_file",
      args: { path: "AGENTS.md", project_reference: "project-1" },
      context: { projectId: "project-1" },
    },
  ]);
});

Deno.test("createHostedProjectRemoteToolSource applies local input preparation before execution", async () => {
  let executedArgs: unknown;
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("create_file")],
      execute: (_toolName, args) => {
        executedArgs = args;
        return { ok: true };
      },
    }),
    defaultProjectId: "project-1",
    prepareToolInput: ({ toolInput }) => ({
      ...toolInput,
      path: "research/report.md",
    }),
  });

  await source.executeTool("create_file", { content: "hello" });

  assertEquals(executedArgs, {
    content: "hello",
    path: "research/report.md",
    project_reference: "project-1",
  });
});

Deno.test("createHostedProjectRemoteToolSource retries configured write collisions with the fallback tool", async () => {
  const executeCalls: string[] = [];
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("create_file"), projectFileTool("update_file")],
      execute: (toolName) => {
        executeCalls.push(toolName);
        return toolName === "create_file"
          ? { isError: true, message: "file already exists" }
          : { ok: true };
      },
    }),
    defaultProjectId: "project-1",
    shouldRetryWithTool: ({ error }) => {
      if (typeof error !== "object" || error === null) {
        return false;
      }
      return Reflect.get(error, "message") === "file already exists";
    },
  });

  assertEquals(await source.executeTool("create_file", { path: "report.md" }), { ok: true });
  assertEquals(executeCalls, ["create_file", "update_file"]);
});

Deno.test("createHostedProjectRemoteToolSource retries thrown errors and rethrows non-retry errors", async () => {
  const executeCalls: string[] = [];
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("create_file"), projectFileTool("update_file")],
      execute: (toolName) => {
        executeCalls.push(toolName);
        if (toolName === "create_file") {
          throw new Error("file already exists");
        }
        return { ok: true };
      },
    }),
    defaultProjectId: "project-1",
    shouldRetryWithTool: ({ error }) =>
      error instanceof Error && error.message === "file already exists",
  });

  assertEquals(await source.executeTool("create_file", { path: "report.md" }), { ok: true });
  assertEquals(executeCalls, ["create_file", "update_file"]);

  const failingSource = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("create_file")],
      execute: () => {
        throw new Error("permission denied");
      },
    }),
    defaultProjectId: "project-1",
    shouldRetryWithTool: () => false,
  });

  await assertRejects(
    () => failingSource.executeTool("create_file", { path: "report.md" }),
    Error,
    "permission denied",
  );
});

Deno.test("createHostedProjectRemoteToolSource reports project navigation and steering mutations", async () => {
  const switchedProjects: string[] = [];
  const mutations: Array<{ instructionsChanged: boolean; skillsChanged: boolean }> = [];
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [navigationTool("studio_open_project"), projectFileTool("update_file")],
      execute: (toolName) => {
        if (toolName === "studio_open_project") {
          return { success: true, project_id: "project-2" };
        }
        return { success: true };
      },
    }),
    defaultProjectId: () => "project-1",
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: ["studio_open_project"],
    },
    onProjectSwitch: (projectId) => {
      switchedProjects.push(projectId);
    },
    onSteeringMutation: (mutation) => {
      mutations.push({
        instructionsChanged: mutation.instructionsChanged,
        skillsChanged: mutation.skillsChanged,
      });
    },
  });

  await source.executeTool("studio_open_project", { project_id: "project-2" });
  await source.executeTool("update_file", { path: "AGENTS.md" });

  assertEquals(switchedProjects, ["project-2"]);
  assertEquals(mutations, [{ instructionsChanged: true, skillsChanged: false }]);
});

Deno.test("createHostedProjectRemoteToolSource skips mutation callbacks for failed results", async () => {
  let mutationCount = 0;
  const source = createHostedProjectRemoteToolSource({
    source: createRemoteSource({
      tools: [projectFileTool("update_file")],
      execute: () => ({ isError: true }),
    }),
    defaultProjectId: "project-1",
    onSteeringMutation: () => {
      mutationCount += 1;
    },
  });

  assertEquals(await source.executeTool("update_file", { path: "AGENTS.md" }), { isError: true });
  assertEquals(mutationCount, 0);
});

Deno.test("createHostedProjectRemoteToolSources defaults to the Veryfront API MCP server", async () => {
  const configs: RemoteMCPToolSourceConfig[] = [];
  const sources = createHostedProjectRemoteToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    studioMcpUrl: "https://studio.example/mcp",
    clientProfile: {
      id: "veryfront-studio",
      type: "web",
      trusted: true,
      capabilities: ["ui_panels"],
    },
    getProjectId: () => "project-1",
    createRemoteToolSource: (config) => {
      configs.push(config);
      return createRemoteSource({ id: config.id, tools: [projectFileTool("update_file")] });
    },
  });

  assertEquals(sources.map((source) => source.id), ["veryfront-mcp"]);
  assertEquals(configs.map((config) => config.endpoint), ["https://api.example/mcp"]);
});

Deno.test("createHostedProjectRemoteToolSources injects end_user_id for Veryfront API integration tools", async () => {
  const executed: Array<{ toolName: string; args: unknown; context?: ToolExecutionContext }> = [];
  const sources = createHostedProjectRemoteToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{ kind: "veryfront-api" }],
    getProjectId: () => "project-1",
    getEndUserId: () => "user-123",
    createRemoteToolSource: (config) =>
      createRemoteSource({
        id: config.id,
        tools: [simpleTool("github__list_issues")],
        execute: (toolName, args, context) => {
          executed.push({ toolName, args, context });
          return { ok: true };
        },
      }),
  });

  await sources[0]?.executeTool("github__list_issues", { repo: "veryfront" });

  assertEquals(executed, [
    {
      toolName: "github__list_issues",
      args: { repo: "veryfront", end_user_id: "user-123" },
      context: undefined,
    },
  ]);
});

Deno.test("createHostedProjectRemoteToolSources filters Veryfront API MCP tools with the tool access profile", async () => {
  const executed: Array<{ toolName: string; args: unknown }> = [];
  const sources = createHostedProjectRemoteToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{ kind: "veryfront-api" }],
    getProjectId: () => "project-1",
    createRemoteToolSource: (config) =>
      createRemoteSource({
        id: config.id,
        tools: [
          simpleTool("create_server"),
          simpleTool("delete_server"),
          simpleTool("update_file"),
        ],
        execute: (toolName, args) => {
          executed.push({ toolName, args });
          if (toolName === "get_tool_access_profile") {
            return {
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
            };
          }
          return { ok: true };
        },
      }),
  });

  assertEquals(
    (await sources[0]?.listTools({ projectId: "project-1" }))?.map((tool) => tool.name),
    ["delete_server", "update_file"],
  );
  assertEquals(executed, [
    {
      toolName: "get_tool_access_profile",
      args: { project_reference: "project-1" },
    },
  ]);
});

Deno.test("createHostedProjectRemoteToolSources fails closed for mapped API tools when profile resolution fails", async () => {
  const sources = createHostedProjectRemoteToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [{ kind: "veryfront-api" }],
    getProjectId: () => "project-1",
    createRemoteToolSource: (config) =>
      createRemoteSource({
        id: config.id,
        tools: [
          simpleTool("create_invite"),
          simpleTool("delete_member"),
          simpleTool("update_file"),
        ],
        execute: (toolName) => {
          if (toolName === "get_tool_access_profile") {
            throw new Error("profile unavailable");
          }
          return { ok: true };
        },
      }),
  });

  assertEquals(
    (await sources[0]?.listTools({ projectId: "project-1" }))?.map((tool) => tool.name),
    ["update_file"],
  );
});

Deno.test("createHostedProjectRemoteToolSources builds API and explicit gated Studio MCP sources", async () => {
  const configs: RemoteMCPToolSourceConfig[] = [];
  let activeProjectId = "project-1";
  const sources = createHostedProjectRemoteToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    studioMcpUrl: "https://studio.example/mcp",
    mcpServers: [{ kind: "veryfront-api" }, { kind: "veryfront-studio" }],
    clientProfile: {
      id: "veryfront-studio",
      type: "web",
      trusted: true,
      capabilities: ["ui_panels"],
    },
    getProjectId: () => activeProjectId,
    conversationId: "conversation-1",
    createRemoteToolSource: (config) => {
      configs.push(config);
      return createRemoteSource({ id: config.id, tools: [projectFileTool("update_file")] });
    },
  });

  assertEquals(sources.map((source) => source.id), ["veryfront-mcp", "studio-mcp"]);
  assertEquals(configs.map((config) => config.endpoint), [
    "https://api.example/mcp",
    "https://studio.example/mcp",
  ]);
  assertEquals(configs[0]?.headers, { Authorization: "Bearer token-1" });

  activeProjectId = "project-2";
  assertEquals(await resolveTestHeaders(configs[1]?.headers), {
    Authorization: "Bearer token-1",
    "x-conversation-id": "conversation-1",
    "x-project-id": "project-2",
  });

  const blockedSources = createHostedProjectRemoteToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    studioMcpUrl: "https://studio.example/mcp",
    mcpServers: [{ kind: "veryfront-api" }, { kind: "veryfront-studio" }],
    clientProfile: {
      id: "veryfront-cli",
      type: "cli",
      trusted: true,
      capabilities: [],
    },
    getProjectId: () => "project-1",
    createRemoteToolSource: (config) =>
      createRemoteSource({ id: config.id, tools: [projectFileTool(config.id ?? "tool")] }),
  });

  assertEquals(blockedSources.map((source) => source.id), ["veryfront-mcp"]);
});

Deno.test("createHostedProjectRemoteToolSources builds explicit MCP server lists", async () => {
  const configs: RemoteMCPToolSourceConfig[] = [];
  let activeProjectId = "project-1";
  const sources = createHostedProjectRemoteToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    mcpServers: [
      { kind: "veryfront-api" },
      { kind: "veryfront-studio" },
      {
        id: "linear",
        endpoint: "https://linear.example/mcp",
        headers: { Authorization: "Bearer linear-token" },
      },
    ],
    studioMcpUrl: "https://studio.example/mcp",
    clientProfile: {
      id: "veryfront-studio",
      type: "web",
      trusted: true,
      capabilities: ["ui_panels"],
    },
    getProjectId: () => activeProjectId,
    conversationId: "conversation-1",
    createRemoteToolSource: (config) => {
      configs.push(config);
      return createRemoteSource({ id: config.id, tools: [projectFileTool("update_file")] });
    },
  });

  assertEquals(sources.map((source) => source.id), ["veryfront-mcp", "studio-mcp", "linear"]);
  assertEquals(configs.map((config) => config.endpoint), [
    "https://api.example/mcp",
    "https://studio.example/mcp",
    "https://linear.example/mcp",
  ]);
  assertEquals(configs[0]?.headers, { Authorization: "Bearer token-1" });
  assertEquals(configs[2]?.headers, { Authorization: "Bearer linear-token" });

  activeProjectId = "project-2";
  assertEquals(await resolveTestHeaders(configs[1]?.headers), {
    Authorization: "Bearer token-1",
    "x-conversation-id": "conversation-1",
    "x-project-id": "project-2",
  });
});

Deno.test("createHostedProjectRemoteToolSources applies project wrapper policy to created sources", async () => {
  const executed: Array<{ toolName: string; args: unknown; context?: ToolExecutionContext }> = [];
  const switchedProjects: string[] = [];
  const mutations: Array<{ instructionsChanged: boolean; skillsChanged: boolean }> = [];
  const sources = createHostedProjectRemoteToolSources({
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    studioMcpUrl: "https://studio.example/mcp",
    mcpServers: [{ kind: "veryfront-api" }, { kind: "veryfront-studio" }],
    clientProfile: {
      id: "veryfront-studio",
      type: "web",
      trusted: true,
      capabilities: ["ui_panels"],
    },
    defaultProjectId: () => "project-1",
    getProjectId: () => "project-1",
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: ["studio_open_project"],
    },
    prepareToolInput: ({ toolInput }) => ({
      ...toolInput,
      prepared: true,
    }),
    onSteeringMutation: (mutation) => {
      mutations.push({
        instructionsChanged: mutation.instructionsChanged,
        skillsChanged: mutation.skillsChanged,
      });
    },
    onStudioProjectSwitch: (projectId) => {
      switchedProjects.push(projectId);
    },
    createRemoteToolSource: (config) =>
      createRemoteSource({
        id: config.id,
        tools: [projectFileTool("update_file"), navigationTool("studio_open_project")],
        execute: (toolName, args, context) => {
          executed.push({ toolName, args, context });
          if (config.id === "studio-mcp" && toolName === "studio_open_project") {
            return { success: true, project_id: "project-2" };
          }
          return { success: true };
        },
      }),
  });

  await sources[0]?.executeTool("update_file", { path: "AGENTS.md" });
  await sources[1]?.executeTool("studio_open_project", { project_id: "project-2" });

  assertEquals(executed, [
    {
      toolName: "get_tool_access_profile",
      args: { project_reference: "project-1" },
      context: { projectId: "project-1" },
    },
    {
      toolName: "update_file",
      args: { path: "AGENTS.md", prepared: true, project_reference: "project-1" },
      context: { projectId: "project-1" },
    },
    {
      toolName: "studio_open_project",
      args: { prepared: true, project_id: "project-2" },
      context: { projectId: "project-1" },
    },
  ]);
  assertEquals(mutations, [{ instructionsChanged: true, skillsChanged: false }]);
  assertEquals(switchedProjects, ["project-2"]);
});
