import { INPUT_VALIDATION_FAILED, PERMISSION_DENIED } from "#veryfront/errors";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";

/** Options accepted by project scoped remote tool. */
export type ProjectScopedRemoteToolOptions = {
  projectNavigationToolNames?: readonly string[];
};

/** Public API contract for project scoped remote tool default project ID. */
export type ProjectScopedRemoteToolDefaultProjectId =
  | string
  | null
  | undefined
  | (() => string | null | undefined);

/** Options accepted by project scoped remote tool catalog. */
export type ProjectScopedRemoteToolCatalogOptions = {
  source: RemoteToolSource;
  defaultProjectId?: ProjectScopedRemoteToolDefaultProjectId;
  allowedToolNames?: ReadonlySet<string> | null;
  projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
  filterToolDefinitions?: (input: {
    source: RemoteToolSource;
    toolDefinitions: readonly ToolDefinition[];
    activeProjectId: string | null;
    context?: ToolExecutionContext;
  }) => Promise<ToolDefinition[]> | ToolDefinition[];
};

/** Public API contract for project scoped remote tool definitions. */
export type ProjectScopedRemoteToolDefinitions = {
  activeProjectId: string | null;
  toolDefinitions: ToolDefinition[];
};

/** Input payload for project scoped remote tool execution. */
export type ProjectScopedRemoteToolExecutionInput = {
  toolName: string;
  toolInput: Record<string, unknown>;
  context?: ToolExecutionContext;
};

/** Public API contract for project scoped remote tool execution. */
export type ProjectScopedRemoteToolExecution = ProjectScopedRemoteToolDefinitions & {
  toolDefinition: ToolDefinition;
  toolInput: Record<string, unknown>;
  executeContext: ToolExecutionContext | undefined;
};

/** Public API contract for project scoped remote tool catalog. */
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

/** Options accepted by list project scoped remote tool name. */
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

  if (acceptsProjectReference(toolDefinition)) {
    return true;
  }

  return getRequiredToolProperties(toolDefinition).includes("project_id");
}

function requiresProjectReference(toolDefinition: ToolDefinition): boolean {
  return getRequiredToolProperties(toolDefinition).includes("project_reference");
}

function hasToolProperty(toolDefinition: ToolDefinition, property: string): boolean {
  if (typeof toolDefinition.parameters !== "object" || toolDefinition.parameters === null) {
    return false;
  }

  const properties = Reflect.get(toolDefinition.parameters, "properties");
  return typeof properties === "object" && properties !== null &&
    Object.prototype.hasOwnProperty.call(properties, property);
}

function acceptsProjectReference(toolDefinition: ToolDefinition): boolean {
  return requiresProjectReference(toolDefinition) ||
    hasToolProperty(toolDefinition, "project_reference");
}

function isMissingRequiredToolInput(value: unknown): boolean {
  return value === undefined || value === null ||
    (typeof value === "string" && value.trim().length === 0);
}

function validateRequiredToolInput(input: {
  toolDefinition: ToolDefinition | undefined;
  toolInput: Record<string, unknown>;
}): void {
  if (!input.toolDefinition) {
    return;
  }

  const missingProperties = getRequiredToolProperties(input.toolDefinition).filter((property) =>
    isMissingRequiredToolInput(input.toolInput[property])
  );
  if (missingProperties.length === 0) {
    return;
  }

  throw INPUT_VALIDATION_FAILED.create({
    detail: `Tool "${input.toolDefinition.name}" requires input: ${missingProperties.join(", ")}`,
  });
}

/** Check whether a remote tool is project-navigation scoped. */
export function isProjectNavigationRemoteTool(
  toolName: string,
  options: ProjectScopedRemoteToolOptions = {},
): boolean {
  if (toolName.length === 0) {
    return false;
  }

  return getProjectNavigationToolNames(options).has(toolName);
}

/** Check whether a remote tool name is allowed. */
export function isRemoteToolNameAllowed(
  toolName: string,
  allowedToolNames: ReadonlySet<string> | null | undefined,
): boolean {
  return !allowedToolNames || allowedToolNames.has(toolName);
}

/** Filter project scoped remote tool definitions. */
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

/** Input payload for hydrate project scoped remote tool. */
export function hydrateProjectScopedRemoteToolInput(input: {
  toolDefinition: ToolDefinition | undefined;
  activeProjectId: string | null;
  toolInput: Record<string, unknown>;
}): Record<string, unknown> {
  if (
    !input.toolDefinition || !input.activeProjectId ||
    !acceptsProjectReference(input.toolDefinition)
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

/** Resolves project scoped remote tool project ID. */
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

/** Create project scoped remote tool catalog. */
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

    if (
      !input.filterToolDefinitions && cachedToolDefinitions &&
      cachedProjectId === activeProjectId
    ) {
      return {
        activeProjectId,
        toolDefinitions: cachedToolDefinitions,
      };
    }

    const sourceContext = withActiveProjectContext(context, activeProjectId);
    const scopedToolDefinitions = filterProjectScopedRemoteToolDefinitions(
      await input.source.listTools(sourceContext),
      activeProjectId,
      input.projectScopedRemoteToolOptions,
    );
    const toolDefinitions = input.filterToolDefinitions
      ? await input.filterToolDefinitions({
        source: input.source,
        toolDefinitions: scopedToolDefinitions,
        activeProjectId,
        context: sourceContext,
      })
      : scopedToolDefinitions;

    if (!input.filterToolDefinitions) {
      cachedProjectId = activeProjectId;
      cachedToolDefinitions = toolDefinitions;
    }

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
        throw PERMISSION_DENIED.create({
          detail: `Tool "${executionInput.toolName}" is not allowed for this run`,
        });
      }

      const { activeProjectId, toolDefinitions } = await listActiveToolDefinitions(
        executionInput.context,
      );
      const toolDefinition = toolDefinitions.find((definition) =>
        definition.name === executionInput.toolName
      );
      if (!toolDefinition) {
        throw PERMISSION_DENIED.create({
          detail:
            `Tool "${executionInput.toolName}" is not advertised by remote source "${input.source.id}"`,
        });
      }
      const toolInput = hydrateProjectScopedRemoteToolInput({
        toolDefinition,
        activeProjectId,
        toolInput: executionInput.toolInput,
      });
      validateRequiredToolInput({ toolDefinition, toolInput });

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

/** List project scoped remote tool names. */
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
