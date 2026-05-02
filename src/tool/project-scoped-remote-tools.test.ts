import { assertEquals, assertStrictEquals } from "@std/assert";
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

Deno.test("filterProjectScopedRemoteToolDefinitions hides project-bound tools when no active project exists", () => {
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

Deno.test("filterProjectScopedRemoteToolDefinitions preserves project-bound tools when an active project exists", () => {
  const tools = [
    toolDefinition({ name: "list_projects" }),
    toolDefinition({ name: "list_files", required: ["project_reference"] }),
  ];

  assertEquals(
    filterProjectScopedRemoteToolDefinitions(tools, "project-1").map((tool) => tool.name),
    ["list_projects", "list_files"],
  );
});

Deno.test("filterProjectScopedRemoteToolDefinitions does not infer project scope without required fields", () => {
  const tools = [
    toolDefinition({ name: "list_agents" }),
    toolDefinition({ name: "list_workflows" }),
  ];

  assertEquals(
    filterProjectScopedRemoteToolDefinitions(tools, null).map((tool) => tool.name),
    ["list_agents", "list_workflows"],
  );
});

Deno.test("filterProjectScopedRemoteToolDefinitions allows configured navigation tools without an active project", () => {
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

Deno.test("isProjectNavigationRemoteTool checks configured navigation tools", () => {
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

Deno.test("hydrateProjectScopedRemoteToolInput injects project_reference when required", () => {
  assertEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: toolDefinition({ name: "list_files", required: ["project_reference"] }),
      activeProjectId: "project-1",
      toolInput: { pattern: "src" },
    }),
    { pattern: "src", project_reference: "project-1" },
  );
});

Deno.test("hydrateProjectScopedRemoteToolInput preserves explicit project_reference", () => {
  const toolInput = { project_reference: "explicit-project", pattern: "src" };

  assertStrictEquals(
    hydrateProjectScopedRemoteToolInput({
      toolDefinition: toolDefinition({ name: "list_files", required: ["project_reference"] }),
      activeProjectId: "project-1",
      toolInput,
    }),
    toolInput,
  );
});

Deno.test("hydrateProjectScopedRemoteToolInput leaves non-project-reference tools unchanged", () => {
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

Deno.test("hydrateProjectScopedRemoteToolInput leaves inputs unchanged without active project", () => {
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

Deno.test("resolveProjectScopedRemoteToolProjectId prefers context project ids", () => {
  assertEquals(
    resolveProjectScopedRemoteToolProjectId({ projectId: "context-project" }, "default-project"),
    "context-project",
  );
  assertEquals(resolveProjectScopedRemoteToolProjectId({}, "default-project"), "default-project");
  assertEquals(resolveProjectScopedRemoteToolProjectId(undefined, null), null);
});

Deno.test("isRemoteToolNameAllowed applies optional allowlists", () => {
  assertEquals(isRemoteToolNameAllowed("list_files", null), true);
  assertEquals(isRemoteToolNameAllowed("list_files", new Set(["list_files"])), true);
  assertEquals(isRemoteToolNameAllowed("delete_file", new Set(["list_files"])), false);
});

Deno.test("createProjectScopedRemoteToolCatalog filters, caches, and hydrates project tools", async () => {
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
  assertEquals(listContexts, [{ projectId: "project-1" }]);
});

Deno.test("createProjectScopedRemoteToolCatalog rejects disallowed execution", async () => {
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

Deno.test("listProjectScopedRemoteToolNames returns sorted unique visible names", async () => {
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
