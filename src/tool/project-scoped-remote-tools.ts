import { INPUT_VALIDATION_FAILED, PERMISSION_DENIED } from "#veryfront/errors";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

/** Options accepted by project-scoped remote tool. */
export type ProjectScopedRemoteToolOptions = {
  projectNavigationToolNames?: readonly string[];
};

/** Public API contract for project-scoped remote tool default project ID. */
export type ProjectScopedRemoteToolDefaultProjectId =
  | string
  | null
  | undefined
  | (() => string | null | undefined);

/** Options accepted by project-scoped remote tool catalog. */
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

/** Public API contract for project-scoped remote tool definitions. */
export type ProjectScopedRemoteToolDefinitions = {
  activeProjectId: string | null;
  toolDefinitions: ToolDefinition[];
};

/** Input payload for project-scoped remote tool execution. */
export type ProjectScopedRemoteToolExecutionInput = {
  toolName: string;
  toolInput: Record<string, unknown>;
  context?: ToolExecutionContext;
};

/** Public API contract for project-scoped remote tool execution. */
export type ProjectScopedRemoteToolExecution = ProjectScopedRemoteToolDefinitions & {
  toolDefinition: ToolDefinition;
  toolInput: Record<string, unknown>;
  executeContext: ToolExecutionContext | undefined;
};

/** Public API contract for project-scoped remote tool catalog. */
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

/** Options accepted by list project-scoped remote tool name. */
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
  const parameters = snapshotToolParameters(toolDefinition);
  const required = parameters.required;
  return Array.isArray(required)
    ? required.filter((property): property is string => typeof property === "string")
    : [];
}

function snapshotToolParameters(
  toolDefinition: ToolDefinition,
): Record<string, unknown> {
  const snapshot = snapshotBoundedJsonValue(toolDefinition.parameters);
  if (
    !snapshot.success ||
    typeof snapshot.value !== "object" ||
    snapshot.value === null ||
    Array.isArray(snapshot.value)
  ) {
    throw new TypeError(
      `Tool "${toolDefinition.name}" parameters must be a bounded JSON Schema object`,
    );
  }
  return snapshot.value;
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
  const properties = snapshotToolParameters(toolDefinition).properties;
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

  const missingProperties = getRequiredToolProperties(input.toolDefinition).filter((property) => {
    const descriptor = Object.getOwnPropertyDescriptor(input.toolInput, property);
    return !descriptor || !("value" in descriptor) ||
      isMissingRequiredToolInput(descriptor.value);
  });
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

/** Filter project-scoped remote tool definitions. */
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

/** Input payload for hydrate project-scoped remote tool. */
export function hydrateProjectScopedRemoteToolInput(input: {
  toolDefinition: ToolDefinition | undefined;
  activeProjectId: string | null;
  toolInput: Record<string, unknown>;
  projectScopedRemoteToolOptions?: ProjectScopedRemoteToolOptions;
}): Record<string, unknown> {
  if (
    !input.toolDefinition || !input.activeProjectId ||
    !acceptsProjectReference(input.toolDefinition)
  ) {
    return input.toolInput;
  }

  // Project-navigation tools legitimately target a model-chosen project.
  if (
    isProjectNavigationRemoteTool(
      input.toolDefinition.name,
      input.projectScopedRemoteToolOptions ?? {},
    )
  ) {
    return input.toolInput;
  }

  const projectReferenceDescriptor = Object.getOwnPropertyDescriptor(
    input.toolInput,
    "project_reference",
  );
  if (
    projectReferenceDescriptor &&
    "value" in projectReferenceDescriptor &&
    projectReferenceDescriptor.value === input.activeProjectId
  ) {
    return input.toolInput;
  }

  const snapshot = snapshotBoundedJsonValue(input.toolInput);
  if (
    !snapshot.success ||
    typeof snapshot.value !== "object" ||
    snapshot.value === null ||
    Array.isArray(snapshot.value)
  ) {
    throw new TypeError(
      `Tool "${input.toolDefinition.name}" input must be a bounded JSON object`,
    );
  }
  return {
    ...snapshot.value,
    project_reference: input.activeProjectId,
  };
}

function normalizeProjectId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/** Resolves project-scoped remote tool project ID. */
export function resolveProjectScopedRemoteToolProjectId(
  context: ToolExecutionContext | undefined,
  defaultProjectId: string | null | undefined,
): string | null {
  return normalizeProjectId(context?.projectId) ?? normalizeProjectId(defaultProjectId);
}

function resolveDefaultProjectId(
  defaultProjectId: ProjectScopedRemoteToolDefaultProjectId,
): string | null {
  const resolvedProjectId = typeof defaultProjectId === "function"
    ? defaultProjectId()
    : defaultProjectId;
  return normalizeProjectId(resolvedProjectId);
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

function snapshotToolInput(
  toolName: string,
  value: unknown,
): Record<string, unknown> {
  const snapshot = snapshotBoundedJsonValue(value);
  if (
    !snapshot.success ||
    typeof snapshot.value !== "object" ||
    snapshot.value === null ||
    Array.isArray(snapshot.value)
  ) {
    throw INPUT_VALIDATION_FAILED.create({
      detail: `Tool "${toolName}" input must be a bounded JSON object`,
    });
  }
  return snapshot.value;
}

function normalizeToolDefinitions(
  sourceId: string,
  definitions: readonly ToolDefinition[],
): ToolDefinition[] {
  const names = new Set<string>();
  return definitions.map((definition, index) => {
    if (
      typeof definition !== "object" ||
      definition === null ||
      typeof definition.name !== "string" ||
      definition.name.length === 0 ||
      typeof definition.description !== "string"
    ) {
      throw new TypeError(
        `Remote source "${sourceId}" returned a malformed tool definition at index ${index}`,
      );
    }
    if (names.has(definition.name)) {
      throw new TypeError(
        `Remote source "${sourceId}" advertised duplicate tool name "${definition.name}"`,
      );
    }
    names.add(definition.name);

    const normalized: ToolDefinition = {
      name: definition.name,
      description: definition.description,
      parameters: snapshotToolParameters(definition),
    };
    if (definition.title !== undefined) {
      if (typeof definition.title !== "string" || definition.title.length === 0) {
        throw new TypeError(
          `Remote source "${sourceId}" returned a malformed title for tool "${definition.name}"`,
        );
      }
      normalized.title = definition.title;
    }
    if (definition.annotations !== undefined) {
      const annotations = snapshotBoundedJsonValue(definition.annotations);
      if (
        !annotations.success ||
        typeof annotations.value !== "object" ||
        annotations.value === null ||
        Array.isArray(annotations.value)
      ) {
        throw new TypeError(
          `Remote source "${sourceId}" returned malformed annotations for tool "${definition.name}"`,
        );
      }
      normalized.annotations = annotations.value;
    }
    return normalized;
  });
}

/** Create project-scoped remote tool catalog. */
export function createProjectScopedRemoteToolCatalog(
  input: ProjectScopedRemoteToolCatalogOptions,
): ProjectScopedRemoteToolCatalog {
  async function listActiveToolDefinitions(
    context?: ToolExecutionContext,
  ): Promise<ProjectScopedRemoteToolDefinitions> {
    const activeProjectId = resolveProjectScopedRemoteToolProjectId(
      context,
      resolveDefaultProjectId(input.defaultProjectId),
    );

    const sourceContext = withActiveProjectContext(context, activeProjectId);
    const scopedToolDefinitions = filterProjectScopedRemoteToolDefinitions(
      normalizeToolDefinitions(
        input.source.id,
        await input.source.listTools(sourceContext),
      ),
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

    return {
      activeProjectId,
      toolDefinitions: normalizeToolDefinitions(input.source.id, toolDefinitions),
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
        toolInput: snapshotToolInput(executionInput.toolName, executionInput.toolInput),
        projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
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

/** List project-scoped remote tool names. */
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

  return [...remoteToolNames].sort(compareStrings);
}
