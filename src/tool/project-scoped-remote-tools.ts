import {
  getErrorMessage,
  INPUT_VALIDATION_FAILED,
  PERMISSION_DENIED,
  RESOURCE_NOT_FOUND,
} from "#veryfront/errors";
import { snapshotJsonValue } from "./json-value.ts";
import { raceWithAbort } from "./abort.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";

const MAX_PROJECT_SCOPED_TOOL_DEFINITIONS = 10_000;
const MAX_PROJECT_SCOPED_DEFINITION_BYTES = 16 * 1024 * 1024;
const MAX_PROJECT_SCOPED_TOOL_NAME_LENGTH = 128;
const MAX_PROJECT_SCOPED_TOOL_DESCRIPTION_LENGTH = 16_384;

function hasUnsafeControlCharacters(value: string, allowFormattingWhitespace = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x7f ||
      (code < 0x20 &&
        !(allowFormattingWhitespace && (code === 0x09 || code === 0x0a || code === 0x0d)))
    ) {
      return true;
    }
  }
  return false;
}

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
  toolDefinition: ToolDefinition | undefined;
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
    !Object.hasOwn(input.toolInput, property) ||
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

  if (
    Object.hasOwn(input.toolInput, "project_reference") &&
    input.toolInput.project_reference === input.activeProjectId
  ) {
    return input.toolInput;
  }

  return {
    ...input.toolInput,
    project_reference: input.activeProjectId,
  };
}

function cloneToolDefinitions(definitions: readonly ToolDefinition[]): ToolDefinition[] {
  if (!Array.isArray(definitions)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Remote tool definitions must be an array" });
  }
  if (definitions.length > MAX_PROJECT_SCOPED_TOOL_DEFINITIONS) {
    throw INPUT_VALIDATION_FAILED.create({
      detail:
        `Remote tool definitions cannot exceed ${MAX_PROJECT_SCOPED_TOOL_DEFINITIONS} entries`,
    });
  }
  let snapshot: ToolDefinition[];
  try {
    snapshot = snapshotJsonValue(definitions, {
      label: "Remote tool definitions",
      maxBytes: MAX_PROJECT_SCOPED_DEFINITION_BYTES,
      maxStringLength: MAX_PROJECT_SCOPED_DEFINITION_BYTES,
      maxNodes: 250_000,
    });
  } catch (error) {
    throw INPUT_VALIDATION_FAILED.create({ detail: getErrorMessage(error) });
  }

  for (let index = 0; index < snapshot.length; index += 1) {
    const definition = snapshot[index];
    if (
      typeof definition !== "object" || definition === null || Array.isArray(definition) ||
      typeof definition.name !== "string" || definition.name.trim().length === 0 ||
      definition.name.trim() !== definition.name ||
      definition.name.length > MAX_PROJECT_SCOPED_TOOL_NAME_LENGTH ||
      hasUnsafeControlCharacters(definition.name) ||
      typeof definition.description !== "string" ||
      definition.description.trim().length === 0 ||
      definition.description.length > MAX_PROJECT_SCOPED_TOOL_DESCRIPTION_LENGTH ||
      hasUnsafeControlCharacters(definition.description, true) ||
      typeof definition.parameters !== "object" || definition.parameters === null ||
      Array.isArray(definition.parameters)
    ) {
      throw INPUT_VALIDATION_FAILED.create({
        detail: `Remote tool definition ${index} is invalid`,
      });
    }
  }
  return snapshot;
}

function snapshotRemoteToolInput(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "Remote tool input must be a JSON object" });
  }
  try {
    return snapshotJsonValue(value, {
      label: "Remote tool input",
      maxBytes: MAX_PROJECT_SCOPED_DEFINITION_BYTES,
      maxStringLength: MAX_PROJECT_SCOPED_DEFINITION_BYTES,
      maxNodes: 250_000,
    }) as Record<string, unknown>;
  } catch (error) {
    throw INPUT_VALIDATION_FAILED.create({ detail: getErrorMessage(error) });
  }
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
  async function listActiveToolDefinitions(
    context?: ToolExecutionContext,
  ): Promise<ProjectScopedRemoteToolDefinitions> {
    context?.abortSignal?.throwIfAborted();
    const activeProjectId = resolveProjectScopedRemoteToolProjectId(
      context,
      resolveDefaultProjectId(input.defaultProjectId),
    );

    const sourceContext = withActiveProjectContext(context, activeProjectId);
    const sourceToolDefinitions = cloneToolDefinitions(
      await raceWithAbort(
        Promise.resolve().then(() => input.source.listTools(sourceContext)),
        context?.abortSignal,
      ),
    );
    const scopedToolDefinitions = filterProjectScopedRemoteToolDefinitions(
      sourceToolDefinitions,
      activeProjectId,
      input.projectScopedRemoteToolOptions,
    );
    const toolDefinitions = cloneToolDefinitions(
      input.filterToolDefinitions
        ? await raceWithAbort(
          Promise.resolve().then(() =>
            input.filterToolDefinitions!({
              source: input.source,
              toolDefinitions: scopedToolDefinitions,
              activeProjectId,
              context: sourceContext,
            })
          ),
          context?.abortSignal,
        )
        : scopedToolDefinitions,
    );

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
      const executionToolInput = snapshotRemoteToolInput(executionInput.toolInput);
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
        throw RESOURCE_NOT_FOUND.create({
          detail:
            `Tool "${executionInput.toolName}" is not available from remote source "${input.source.id}"`,
        });
      }
      const toolInput = hydrateProjectScopedRemoteToolInput({
        toolDefinition,
        activeProjectId,
        toolInput: executionToolInput,
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
    options.context?.abortSignal?.throwIfAborted();
    const toolDefinitions = filterProjectScopedRemoteToolDefinitions(
      cloneToolDefinitions(
        await raceWithAbort(
          Promise.resolve().then(() => source.listTools(sourceContext)),
          options.context?.abortSignal,
        ),
      ),
      options.projectId,
      options.projectScopedRemoteToolOptions,
    );
    for (const toolDefinition of toolDefinitions) {
      remoteToolNames.add(toolDefinition.name);
    }
  }

  return [...remoteToolNames].sort();
}
