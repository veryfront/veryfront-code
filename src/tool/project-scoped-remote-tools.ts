import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";

export type ProjectScopedRemoteToolOptions = {
  projectNavigationToolNames?: readonly string[];
};

export type ProjectScopedRemoteToolDefaultProjectId =
  | string
  | null
  | undefined
  | (() => string | null | undefined);

export type ProjectScopedRemoteToolCatalogOptions = {
  source: RemoteToolSource;
  defaultProjectId?: ProjectScopedRemoteToolDefaultProjectId;
  allowedToolNames?: ReadonlySet<string> | null;
  projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
};

export type ProjectScopedRemoteToolDefinitions = {
  activeProjectId: string | null;
  toolDefinitions: ToolDefinition[];
};

export type ProjectScopedRemoteToolExecutionInput = {
  toolName: string;
  toolInput: Record<string, unknown>;
  context?: ToolExecutionContext;
};

export type ProjectScopedRemoteToolExecution = ProjectScopedRemoteToolDefinitions & {
  toolDefinition: ToolDefinition | undefined;
  toolInput: Record<string, unknown>;
  executeContext: ToolExecutionContext | undefined;
};

export type ProjectScopedRemoteToolCatalog = {
  id: string;
  listActiveToolDefinitions(
    context?: ToolExecutionContext,
  ): Promise<ProjectScopedRemoteToolDefinitions>;
  listTools(context?: ToolExecutionContext): Promise<ToolDefinition[]>;
  prepareExecution(
    input: ProjectScopedRemoteToolExecutionInput,
  ): Promise<ProjectScopedRemoteToolExecution>;
};

export type ListProjectScopedRemoteToolNameOptions = {
  projectId: string | null;
  context?: ToolExecutionContext;
  projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
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

export function isRemoteToolNameAllowed(
  toolName: string,
  allowedToolNames: ReadonlySet<string> | null | undefined,
): boolean {
  return !allowedToolNames || allowedToolNames.has(toolName);
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

export function resolveProjectScopedRemoteToolProjectId(
  context: ToolExecutionContext | undefined,
  defaultProjectId: string | null | undefined,
): string | null {
  if (typeof context?.projectId === "string" && context.projectId.length > 0) {
    return context.projectId;
  }

  return defaultProjectId || null;
}

function resolveDefaultProjectId(
  defaultProjectId: ProjectScopedRemoteToolDefaultProjectId,
): string | null {
  const resolvedProjectId = typeof defaultProjectId === "function"
    ? defaultProjectId()
    : defaultProjectId;
  return resolvedProjectId || null;
}

function withActiveProjectContext(
  context: ToolExecutionContext | undefined,
  activeProjectId: string | null,
): ToolExecutionContext | undefined {
  if (!activeProjectId) {
    return context;
  }

  if (context?.projectId === activeProjectId) {
    return context;
  }

  return {
    ...(context ?? {}),
    projectId: activeProjectId,
  };
}

export function createProjectScopedRemoteToolCatalog(
  input: ProjectScopedRemoteToolCatalogOptions,
): ProjectScopedRemoteToolCatalog {
  let cachedProjectId: string | null | undefined;
  let cachedToolDefinitions: ToolDefinition[] | null = null;

  async function listActiveToolDefinitions(
    context?: ToolExecutionContext,
  ): Promise<ProjectScopedRemoteToolDefinitions> {
    const activeProjectId = resolveProjectScopedRemoteToolProjectId(
      context,
      resolveDefaultProjectId(input.defaultProjectId),
    );

    if (cachedToolDefinitions && cachedProjectId === activeProjectId) {
      return {
        activeProjectId,
        toolDefinitions: cachedToolDefinitions,
      };
    }

    const sourceContext = withActiveProjectContext(context, activeProjectId);
    const toolDefinitions = filterProjectScopedRemoteToolDefinitions(
      await input.source.listTools(sourceContext),
      activeProjectId,
      input.projectScopedRemoteToolOptions,
    );

    cachedProjectId = activeProjectId;
    cachedToolDefinitions = toolDefinitions;

    return {
      activeProjectId,
      toolDefinitions,
    };
  }

  return {
    id: input.source.id,
    listActiveToolDefinitions,
    async listTools(context) {
      const { toolDefinitions } = await listActiveToolDefinitions(context);
      return toolDefinitions.filter((toolDefinition) =>
        isRemoteToolNameAllowed(toolDefinition.name, input.allowedToolNames)
      );
    },
    async prepareExecution(executionInput) {
      if (!isRemoteToolNameAllowed(executionInput.toolName, input.allowedToolNames)) {
        throw new Error(`Tool "${executionInput.toolName}" is not allowed for this run`);
      }

      const { activeProjectId, toolDefinitions } = await listActiveToolDefinitions(
        executionInput.context,
      );
      const toolDefinition = toolDefinitions.find((definition) =>
        definition.name === executionInput.toolName
      );
      const toolInput = hydrateProjectScopedRemoteToolInput({
        toolDefinition,
        activeProjectId,
        toolInput: executionInput.toolInput,
      });

      return {
        activeProjectId,
        toolDefinitions,
        toolDefinition,
        toolInput,
        executeContext: withActiveProjectContext(executionInput.context, activeProjectId),
      };
    },
  };
}

export async function listProjectScopedRemoteToolNames(
  remoteSources: readonly RemoteToolSource[],
  options: ListProjectScopedRemoteToolNameOptions,
): Promise<string[]> {
  const remoteToolNames = new Set<string>();
  const sourceContext = withActiveProjectContext(options.context, options.projectId);

  for (const source of remoteSources) {
    const toolDefinitions = filterProjectScopedRemoteToolDefinitions(
      await source.listTools(sourceContext),
      options.projectId,
      options.projectScopedRemoteToolOptions,
    );
    for (const toolDefinition of toolDefinitions) {
      remoteToolNames.add(toolDefinition.name);
    }
  }

  return [...remoteToolNames].sort();
}
