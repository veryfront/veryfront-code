import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import {
  createProjectScopedRemoteToolCatalog,
  filterProjectScopedRemoteToolDefinitions,
  hydrateProjectScopedRemoteToolInput,
  isProjectNavigationRemoteTool,
  isRemoteToolNameAllowed,
  listProjectScopedRemoteToolNames,
  resolveProjectScopedRemoteToolProjectId,
} from "./project-scoped-remote-tools.ts";
import type { ToolAnnotations } from "#veryfront/mcp/annotations.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";

function toolDefinition(input: {
  name: string;
  required?: string[];
  title?: string;
  annotations?: ToolAnnotations;
}): ToolDefinition {
  return {
    name: input.name,
    description: input.name,
    parameters: {
      type: "object",
      properties: {},
      ...(input.required ? { required: input.required } : {}),
    },
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.annotations !== undefined ? { annotations: input.annotations } : {}),
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

it("hydrateProjectScopedRemoteToolInput overwrites mismatched project_reference", () => {
  assertEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: toolDefinition({ name: "list_files", required: ["project_reference"] }),
      activeProjectId: "project-1",
      toolInput: { project_reference: "explicit-project", pattern: "src" },
    }),
    { project_reference: "project-1", pattern: "src" },
  );
});

it("hydrateProjectScopedRemoteToolInput keeps a project_reference matching the active project", () => {
  const toolInput = { project_reference: "project-1", pattern: "src" };

  assertStrictEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: toolDefinition({ name: "list_files", required: ["project_reference"] }),
      activeProjectId: "project-1",
      toolInput,
    }),
    toolInput,
  );
});

it("hydrateProjectScopedRemoteToolInput preserves navigation tool project_reference", () => {
  const toolInput = { project_reference: "other-project" };

  assertStrictEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: toolDefinition({
        name: "open_project",
        required: ["project_reference"],
      }),
      activeProjectId: "project-1",
      toolInput,
      projectScopedRemoteToolOptions: { projectNavigationToolNames: ["open_project"] },
    }),
    toolInput,
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
  assertEquals(
    resolveProjectScopedRemoteToolProjectId({ projectId: "   " }, " default-project "),
    "default-project",
  );
});

it("isRemoteToolNameAllowed applies optional allowlists", () => {
  assertEquals(isRemoteToolNameAllowed("list_files", null), true);
  assertEquals(isRemoteToolNameAllowed("list_files", new Set(["list_files"])), true);
  assertEquals(isRemoteToolNameAllowed("delete_file", new Set(["list_files"])), false);
});

it("createProjectScopedRemoteToolCatalog filters, revalidates, and hydrates project tools", async () => {
  const listContexts: (ToolExecutionContext | undefined)[] = [];
  const source: RemoteToolSource = {
    id: "api",
    async listTools(context) {
      listContexts.push(context);
      return [
        toolDefinition({ name: "list_projects" }),
        toolDefinition({
          name: "list_files",
          required: ["project_reference"],
          title: "List files",
          annotations: { readOnlyHint: true },
        }),
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

  const listed = await catalog.listTools();
  assertEquals(listed.map((tool) => tool.name), [
    "list_projects",
    "list_files",
  ]);
  assertEquals(listed[1]?.title, "List files", "remote titles survive normalization");
  assertEquals(
    listed[1]?.annotations,
    { readOnlyHint: true },
    "remote MCP annotations survive normalization",
  );
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
  assertEquals(listContexts, [
    { projectId: "project-1" },
    { projectId: "project-1" },
  ]);
});

it("createProjectScopedRemoteToolCatalog pins execution to the active project", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [
        toolDefinition({ name: "list_files", required: ["project_reference"] }),
        toolDefinition({ name: "open_project", required: ["project_reference"] }),
      ];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({
    source,
    defaultProjectId: "project-1",
    projectScopedRemoteToolOptions: { projectNavigationToolNames: ["open_project"] },
  });

  const scoped = await catalog.prepareExecution({
    toolName: "list_files",
    toolInput: { pattern: "src", project_reference: "other-project" },
    context: {},
  });
  assertEquals(scoped.toolInput, {
    pattern: "src",
    project_reference: "project-1",
  });

  const navigation = await catalog.prepareExecution({
    toolName: "open_project",
    toolInput: { project_reference: "other-project" },
    context: {},
  });
  assertEquals(navigation.toolInput, { project_reference: "other-project" });
});

it("createProjectScopedRemoteToolCatalog detaches and validates advertised MCP metadata", async () => {
  function createCatalog(definition: ToolDefinition) {
    const source: RemoteToolSource = {
      id: "api",
      async listTools() {
        return [definition];
      },
      async executeTool() {
        return { ok: true };
      },
    };
    return createProjectScopedRemoteToolCatalog({ source });
  }

  const catalog = createCatalog(
    toolDefinition({
      name: "list_agents",
      title: "List agents",
      annotations: { readOnlyHint: true },
    }),
  );
  const first = await catalog.listTools();
  (first[0]?.annotations as Record<string, unknown>).readOnlyHint = false;
  const second = await catalog.listTools();
  assertEquals(
    second[0]?.annotations,
    { readOnlyHint: true },
    "mutating returned annotations does not affect a later listing",
  );

  await assertRejects(
    () => createCatalog(toolDefinition({ name: "list_agents", title: "" })).listTools(),
    TypeError,
    "malformed title",
  );
  await assertRejects(
    () =>
      createCatalog(
        toolDefinition({
          name: "list_agents",
          annotations: [] as unknown as ToolAnnotations,
        }),
      ).listTools(),
    TypeError,
    "malformed annotations",
  );
});

it("createProjectScopedRemoteToolCatalog does not reuse definitions across credential contexts", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools(context) {
      return context?.authToken === "token-b"
        ? [toolDefinition({ name: "write_file" })]
        : [toolDefinition({ name: "read_file" })];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });

  assertEquals(
    (await catalog.listTools({ authToken: "token-a" })).map((tool) => tool.name),
    ["read_file"],
  );
  const prepared = await catalog.prepareExecution({
    toolName: "write_file",
    toolInput: {},
    context: { authToken: "token-b" },
  });

  assertEquals(prepared.toolDefinition.name, "write_file");
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

it("createProjectScopedRemoteToolCatalog rejects tools absent from remote discovery", async () => {
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
    () => catalog.prepareExecution({ toolName: "delete_file", toolInput: {} }),
    'Tool "delete_file" is not advertised by remote source "api"',
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

it("createProjectScopedRemoteToolCatalog rejects duplicate advertised names", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [
        toolDefinition({ name: "read_file" }),
        toolDefinition({ name: "read_file" }),
      ];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });

  await assertRejectsWithMessage(
    () => catalog.listTools(),
    'Remote source "api" advertised duplicate tool name "read_file"',
  );
});

it("required input checks do not invoke accessors or accept inherited values", async () => {
  const source: RemoteToolSource = {
    id: "api",
    async listTools() {
      return [toolDefinition({ name: "search", required: ["query"] })];
    },
    async executeTool() {
      return { ok: true };
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({ source });
  let getterCalls = 0;
  const accessorInput = Object.defineProperty({}, "query", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "secret";
    },
  });

  await assertRejectsWithMessage(
    () =>
      catalog.prepareExecution({
        toolName: "search",
        toolInput: accessorInput,
      }),
    'Tool "search" input must be a bounded JSON object',
  );
  assertEquals(getterCalls, 0);

  const inheritedInput = Object.create({ query: "inherited" }) as Record<string, unknown>;
  await assertRejectsWithMessage(
    () =>
      catalog.prepareExecution({
        toolName: "search",
        toolInput: inheritedInput,
      }),
    'Tool "search" input must be a bounded JSON object',
  );
});

it("project schema inspection does not execute accessors", () => {
  let getterCalls = 0;
  const definition = toolDefinition({ name: "search" });
  definition.parameters = Object.defineProperty({}, "required", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return ["project_reference"];
    },
  });

  assertThrows(
    () => filterProjectScopedRemoteToolDefinitions([definition], null),
    TypeError,
    'Tool "search" parameters must be a bounded JSON Schema object',
  );
  assertEquals(getterCalls, 0);
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
        toolDefinition({ name: "studio_open_project", required: ["project_reference"] }),
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
