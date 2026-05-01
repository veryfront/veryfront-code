import { assertEquals, assertStrictEquals } from "@std/assert";
import {
  filterProjectScopedRemoteToolDefinitions,
  hydrateProjectScopedRemoteToolInput,
  isProjectNavigationRemoteTool,
} from "./project-scoped-remote-tools.ts";
import type { ToolDefinition } from "./types.ts";

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
