import type { ToolDefinition } from "./types.ts";

export type ProjectScopedRemoteToolOptions = {
  projectNavigationToolNames?: readonly string[];
};

function getProjectNavigationToolNames(
  options: ProjectScopedRemoteToolOptions,
): ReadonlySet<string> {
  return new Set(options.projectNavigationToolNames ?? []);
}

function getRequiredToolProperties(toolDefinition: ToolDefinition): string[] {
  if (typeof toolDefinition.parameters !== "object" || toolDefinition.parameters === null) {
    return [];
  }

  const required = Reflect.get(toolDefinition.parameters, "required");
  return Array.isArray(required)
    ? required.filter((property): property is string => typeof property === "string")
    : [];
}

function requiresActiveProject(
  toolDefinition: ToolDefinition,
  options: ProjectScopedRemoteToolOptions,
): boolean {
  if (isProjectNavigationRemoteTool(toolDefinition.name, options)) {
    return false;
  }

  return getRequiredToolProperties(toolDefinition).some(
    (property) => property === "project_reference" || property === "project_id",
  );
}

function requiresProjectReference(toolDefinition: ToolDefinition): boolean {
  return getRequiredToolProperties(toolDefinition).includes("project_reference");
}

export function isProjectNavigationRemoteTool(
  toolName: string,
  options: ProjectScopedRemoteToolOptions = {},
): boolean {
  if (toolName.length === 0) {
    return false;
  }

  return getProjectNavigationToolNames(options).has(toolName);
}

export function filterProjectScopedRemoteToolDefinitions(
  toolDefinitions: readonly ToolDefinition[],
  projectId: string | null,
  options: ProjectScopedRemoteToolOptions = {},
): ToolDefinition[] {
  if (projectId) {
    return [...toolDefinitions];
  }

  return toolDefinitions.filter((toolDefinition) =>
    !requiresActiveProject(toolDefinition, options)
  );
}

export function hydrateProjectScopedRemoteToolInput(input: {
  toolDefinition: ToolDefinition | undefined;
  activeProjectId: string | null;
  toolInput: Record<string, unknown>;
}): Record<string, unknown> {
  if (
    !input.toolDefinition || !input.activeProjectId ||
    !requiresProjectReference(input.toolDefinition)
  ) {
    return input.toolInput;
  }

  if (input.toolInput.project_reference) {
    return input.toolInput;
  }

  return {
    ...input.toolInput,
    project_reference: input.activeProjectId,
  };
}
