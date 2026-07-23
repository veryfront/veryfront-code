import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import { it } from "#veryfront/testing/bdd.ts";
import {
  createProjectScopedRemoteToolCatalog,
  filterProjectScopedRemoteToolDefinitions,
  hydrateProjectScopedRemoteToolInput,
  isProjectNavigationRemoteTool,
  isRemoteToolNameAllowed,
  listProjectScopedRemoteToolNames,
  resolveProjectScopedRemoteToolProjectId,
} from "./project-scoped-remote-tools.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";

function toolDefinition(input: {
  name: string;
  required?: string[];
}): ToolDefinition {
  return {
    name: input.name,
    description: input.name,
    parameters: {
      type: "object",
      properties: {},
      ...(input.required ? { required: input.required } : {}),
    },
  };
}

it("filterProjectScopedRemoteToolDefinitions hides project-bound tools when no active project exists", () => {
  const tools = [
    toolDefinition({ name: "list_projects" }),
    toolDefinition({ name: "list_files", required: ["project_reference"] }),
    toolDefinition({ name: "get_project", required: ["project_id"] }),
  ];

  assertEquals(
    filterProjectScopedRemoteToolDefinitions(tools, null).map((tool) => tool.name),
    ["list_projects"],
  );
});

it("filterProjectScopedRemoteToolDefinitions preserves project-bound tools when an active project exists", () => {
  const tools = [
    toolDefinition({ name: "list_projects" }),
    toolDefinition({ name: "list_files", required: ["project_reference"] }),
  ];

  assertEquals(
    filterProjectScopedRemoteToolDefinitions(tools, "project-1").map((tool) => tool.name),
    ["list_projects", "list_files"],
  );
});

it("filterProjectScopedRemoteToolDefinitions does not infer project scope without required fields", () => {
  const tools = [
    toolDefinition({ name: "list_agents" }),
    toolDefinition({ name: "list_workflows" }),
  ];

  assertEquals(
    filterProjectScopedRemoteToolDefinitions(tools, null).map((tool) => tool.name),
    ["list_agents", "list_workflows"],
  );
});

it("filterProjectScopedRemoteToolDefinitions hides optional project_reference tools without an active project", () => {
  const projectTool = toolDefinition({ name: "generate_agent_avatar" });
  projectTool.parameters = {
    type: "object",
    properties: {
      project_reference: { type: "string" },
      agent_id: { type: "string" },
    },
    required: ["agent_id"],
  };

  assertEquals(
    filterProjectScopedRemoteToolDefinitions([
      toolDefinition({ name: "list_agents" }),
      projectTool,
    ], null).map((tool) => tool.name),
    ["list_agents"],
  );
});

it("filterProjectScopedRemoteToolDefinitions allows configured navigation tools without an active project", () => {
  const tools = [
    toolDefinition({ name: "open_project", required: ["project_id"] }),
    toolDefinition({ name: "delete_project", required: ["project_id"] }),
  ];

  assertEquals(
    filterProjectScopedRemoteToolDefinitions(tools, null, {
      projectNavigationToolNames: ["open_project"],
    }).map((tool) => tool.name),
    ["open_project"],
  );
});

it("isProjectNavigationRemoteTool checks configured navigation tools", () => {
  assertEquals(
    isProjectNavigationRemoteTool("open_project", { projectNavigationToolNames: ["open_project"] }),
    true,
  );
  assertEquals(
    isProjectNavigationRemoteTool("delete_project", {
      projectNavigationToolNames: ["open_project"],
    }),
    false,
  );
  assertEquals(isProjectNavigationRemoteTool("", { projectNavigationToolNames: [""] }), false);
});

it("hydrateProjectScopedRemoteToolInput injects project_reference when required", () => {
  assertEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: toolDefinition({ name: "list_files", required: ["project_reference"] }),
      activeProjectId: "project-1",
      toolInput: { pattern: "src" },
    }),
    { pattern: "src", project_reference: "project-1" },
  );
});

it("hydrateProjectScopedRemoteToolInput injects project_reference when optional but declared", () => {
  const definition = toolDefinition({ name: "generate_agent_avatar" });
  definition.parameters = {
    type: "object",
    properties: {
      project_reference: { type: "string" },
      agent_id: { type: "string" },
      config: { type: "object" },
    },
    required: ["agent_id"],
  };

  assertEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: definition,
      activeProjectId: "project-1",
      toolInput: { agent_id: "harvest-assistant", config: { seed: "harvest-assistant" } },
    }),
    {
      agent_id: "harvest-assistant",
      config: { seed: "harvest-assistant" },
      project_reference: "project-1",
    },
  );
});

it("hydrateProjectScopedRemoteToolInput overrides a conflicting project_reference", () => {
  const toolInput = { project_reference: "explicit-project", pattern: "src" };

  assertEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: toolDefinition({ name: "list_files", required: ["project_reference"] }),
      activeProjectId: "project-1",
      toolInput,
    }),
    { project_reference: "project-1", pattern: "src" },
  );
});

it("hydrateProjectScopedRemoteToolInput leaves non-project-reference tools unchanged", () => {
  const toolInput = { limit: 5 };

  assertStrictEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: toolDefinition({ name: "list_agents" }),
      activeProjectId: "project-1",
      toolInput,
    }),
    toolInput,
  );
});

it("hydrateProjectScopedRemoteToolInput leaves inputs unchanged without active project", () => {
  const toolInput = { pattern: "src" };

  assertStrictEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: toolDefinition({ name: "list_files", required: ["project_reference"] }),
      activeProjectId: null,
      toolInput,
    }),
    toolInput,
  );
});

it("resolveProjectScopedRemoteToolProjectId prefers context project ids", () => {
  assertEquals(
    resolveProjectScopedRemoteToolProjectId({ projectId: "context-project" }, "default-project"),
    "context-project",
  );
  assertEquals(resolveProjectScopedRemoteToolProjectId({}, "default-project"), "default-project");
  assertEquals(resolveProjectScopedRemoteToolProjectId(undefined, null), null);
});

it("isRemoteToolNameAllowed applies optional allowlists", () => {
  assertEquals(isRemoteToolNameAllowed("list_files", null), true);
  assertEquals(isRemoteToolNameAllowed("list_files", new Set(["list_files"])), true);
  assertEquals(isRemoteToolNameAllowed("delete_file", new Set(["list_files"])), false);
});

it("createProjectScopedRemoteToolCatalog filters and hydrates project tools", async () => {
  const listContexts: (ToolExecutionContext | undefined)[] = [];
  const source: RemoteToolSource = {
    id: "api",
    async listTools(context) {
      listContexts.push(context);
      return [
        toolDefinition({ name: "list_projects" }),
        toolDefinition({ name: "list_files", required: ["project_reference"] }),
        toolDefinition({ name: "delete_file", required: ["project_reference"] }),
      ];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({
    source,
    defaultProjectId: "project-1",
    allowedToolNames: new Set(["list_files", "list_projects"]),
  });

  assertEquals((await catalog.listTools()).map((tool) => tool.name), [
    "list_projects",
    "list_files",
  ]);
  assertEquals(listContexts, [{ projectId: "project-1" }]);

  const prepared = await catalog.prepareExecution({
    toolName: "list_files",
    toolInput: { pattern: "src" },
    context: {},
  });

  assertEquals(prepared.activeProjectId, "project-1");
  assertEquals(prepared.toolInput, {
    pattern: "src",
    project_reference: "project-1",
  });
  assertEquals(prepared.executeContext, { projectId: "project-1" });
  assertEquals(listContexts, [{ projectId: "project-1" }, { projectId: "project-1" }]);
});

it("createProjectScopedRemoteToolCatalog resolves dynamic default project ids", async () => {
  const listContexts: (ToolExecutionContext | undefined)[] = [];
  let defaultProjectId: string | null = null;
  const source: RemoteToolSource = {
    id: "api",
    async listTools(context) {
      listContexts.push(context);
      return [
        toolDefinition({ name: "list_projects" }),
        toolDefinition({ name: "list_files", required: ["project_reference"] }),
      ];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({
    source,
    defaultProjectId: () => defaultProjectId,
  });

  assertEquals((await catalog.listTools()).map((tool) => tool.name), ["list_projects"]);
  defaultProjectId = "project-2";

  const prepared = await catalog.prepareExecution({
    toolName: "list_files",
    toolInput: { pattern: "src" },
    context: {},
  });

  assertEquals(prepared.activeProjectId, "project-2");
  assertEquals(prepared.toolInput, {
    pattern: "src",
    project_reference: "project-2",
  });
  assertEquals(prepared.executeContext, { projectId: "project-2" });
  assertEquals(listContexts, [undefined, { projectId: "project-2" }]);
});

it("createProjectScopedRemoteToolCatalog rejects disallowed execution", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [toolDefinition({ name: "list_files", required: ["project_reference"] })];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({
    source,
    defaultProjectId: "project-1",
    allowedToolNames: new Set(["list_projects"]),
  });

  await assertRejectsWithMessage(
    () =>
      catalog.prepareExecution({
        toolName: "list_files",
        toolInput: {},
      }),
    'Tool "list_files" is not allowed for this run',
  );
});

it("createProjectScopedRemoteToolCatalog rejects tools absent from the scoped catalog", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [toolDefinition({ name: "list_files" })];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });

  await assertRejectsWithMessage(
    () =>
      catalog.prepareExecution({
        toolName: "delete_project",
        toolInput: {},
      }),
    'Tool "delete_project" is not available from remote source "api"',
  );
});

it("createProjectScopedRemoteToolCatalog snapshots definitions on every listing", async () => {
  let listCalls = 0;
  const definitions = [toolDefinition({ name: "list_files", required: ["path"] })];
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      listCalls += 1;
      return definitions;
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });

  const first = await catalog.listActiveToolDefinitions();
  first.toolDefinitions.length = 0;

  const second = await catalog.listActiveToolDefinitions();
  assertEquals(second.toolDefinitions.map((definition) => definition.name), ["list_files"]);
  assertEquals(listCalls, 2);
  assertEquals(definitions.map((definition) => definition.name), ["list_files"]);
});

it("createProjectScopedRemoteToolCatalog does not reuse definitions across agents", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools(context) {
      return [toolDefinition({ name: `visible_to_${context?.agentId}` })];
    },
    async executeTool() {
      return null;
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });

  assertEquals((await catalog.listTools({ agentId: "agent_a" }))[0]?.name, "visible_to_agent_a");
  assertEquals((await catalog.listTools({ agentId: "agent_b" }))[0]?.name, "visible_to_agent_b");
});

it("createProjectScopedRemoteToolCatalog rejects pre-aborted repeated listings", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [toolDefinition({ name: "list_files" })];
    },
    async executeTool() {
      return null;
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });
  await catalog.listTools({ projectId: "project-1" });
  const controller = new AbortController();
  controller.abort(new Error("listing canceled"));

  await assertRejects(
    () => catalog.listTools({ projectId: "project-1", abortSignal: controller.signal }),
    Error,
    "listing canceled",
  );
});

it("createProjectScopedRemoteToolCatalog rejects cyclic definition schemas", async () => {
  const definition = toolDefinition({ name: "cyclic" });
  const parameters = { type: "object", properties: {} } as Record<string, unknown>;
  parameters.properties = { self: parameters };
  definition.parameters = parameters;
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [definition];
    },
    async executeTool() {
      return null;
    },
  };

  await assertRejects(
    () => createProjectScopedRemoteToolCatalog({ source }).listTools(),
    Error,
    "cyclic references",
  );
});

it("createProjectScopedRemoteToolCatalog bounds source definition collections", async () => {
  const definitions = [] as ToolDefinition[];
  definitions.length = 10_001;
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return definitions;
    },
    async executeTool() {
      return null;
    },
  };

  await assertRejects(
    () =>
      createProjectScopedRemoteToolCatalog({
        source,
        defaultProjectId: "project-1",
      }).listTools(),
    Error,
    "cannot exceed 10000 entries",
  );
});

it("createProjectScopedRemoteToolCatalog stops waiting after caller cancellation", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return await new Promise(() => {});
    },
    async executeTool() {
      return null;
    },
  };
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(new Error("catalog canceled")), 20);

  try {
    await assertRejects(
      () =>
        createProjectScopedRemoteToolCatalog({ source }).listTools({
          abortSignal: controller.signal,
        }),
      Error,
      "catalog canceled",
    );
  } finally {
    clearTimeout(abortTimer);
  }
});

it("required remote tool inputs must be own properties", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [toolDefinition({ name: "lookup", required: ["toString"] })];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });

  await assertRejectsWithMessage(
    () => catalog.prepareExecution({ toolName: "lookup", toolInput: {} }),
    'Tool "lookup" requires input: toString',
  );
});

it("createProjectScopedRemoteToolCatalog rejects missing required remote tool input", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [toolDefinition({ name: "outlook__search_emails", required: ["$search"] })];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });

  await assertRejectsWithMessage(
    () =>
      catalog.prepareExecution({
        toolName: "outlook__search_emails",
        toolInput: {},
      }),
    'Tool "outlook__search_emails" requires input: $search',
  );
});

it("createProjectScopedRemoteToolCatalog rejects non-object execution input", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [toolDefinition({ name: "lookup" })];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });

  for (const toolInput of [null, [], 42]) {
    await assertRejectsWithMessage(
      () =>
        catalog.prepareExecution({
          toolName: "lookup",
          toolInput: toolInput as never,
        }),
      "Remote tool input must be a JSON object",
    );
  }
});

it("createProjectScopedRemoteToolCatalog rejects malformed definitions", async () => {
  for (
    const definition of [
      { description: "Missing name", parameters: {} },
      { name: "missing_parameters", description: "Missing parameters" },
    ]
  ) {
    const source: RemoteToolSource = {
      id: "api",
      async listTools() {
        return [definition as never];
      },
      async executeTool() {
        return { ok: true };
      },
    };

    await assertRejectsWithMessage(
      () => createProjectScopedRemoteToolCatalog({ source }).listTools(),
      "Remote tool definition 0 is invalid",
    );
  }
});

it("createProjectScopedRemoteToolCatalog rejects non-formatting description controls", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [{
        name: "lookup",
        description: "Lookup\frecords",
        parameters: { type: "object" },
      }];
    },
    async executeTool() {
      return { ok: true };
    },
  };

  await assertRejectsWithMessage(
    () => createProjectScopedRemoteToolCatalog({ source }).listTools(),
    "Remote tool definition 0 is invalid",
  );
});

it("listProjectScopedRemoteToolNames returns sorted unique visible names", async () => {
  const sourceA: RemoteToolSource = {
    id: "api",
    async listTools(context) {
      assertEquals(context, { projectId: "project-1" });
      return [
        toolDefinition({ name: "list_files", required: ["project_reference"] }),
        toolDefinition({ name: "list_projects" }),
      ];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const sourceB: RemoteToolSource = {
    id: "studio",
    async listTools(context) {
      assertEquals(context, { projectId: "project-1" });
      return [
        toolDefinition({ name: "list_files", required: ["project_reference"] }),
        toolDefinition({ name: "studio_open_project", required: ["project_id"] }),
      ];
    },
    async executeTool() {
      return { ok: true };
    },
  };

  assertEquals(
    await listProjectScopedRemoteToolNames([sourceA, sourceB], {
      projectId: "project-1",
      projectScopedRemoteToolOptions: {
        projectNavigationToolNames: ["studio_open_project"],
      },
    }),
    ["list_files", "list_projects", "studio_open_project"],
  );
});

async function assertRejectsWithMessage(
  action: () => Promise<unknown>,
  message: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    assertEquals(error instanceof Error ? error.message : String(error), message);
    return;
  }

  throw new Error("Expected action to reject");
}
