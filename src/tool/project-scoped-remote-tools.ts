import { INPUT_VALIDATION_FAILED, PERMISSION_DENIED } from "#veryfront/errors";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "./types.ts";
import {
  getOwnDataProperty,
  isMissingOwnDataProperty,
  snapshotEnumerableOwnDataObject,
} from "./data-properties.ts";
import { isToolAnnotations } from "./mcp-metadata.ts";

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
  const parameters = snapshotToolParameters(toolDefinition);
  const required = parameters.required;
  if (required === undefined) return [];
  if (!Array.isArray(required)) {
    throw new TypeError(
      `Tool "${toolDefinition.name}" parameters.required must be an array of unique strings`,
    );
  }
  const names = new Set<string>();
  for (const property of required) {
    if (typeof property !== "string" || names.has(property)) {
      throw new TypeError(
        `Tool "${toolDefinition.name}" parameters.required must be an array of unique strings`,
      );
    }
    names.add(property);
  }
  return [...names];
}

function snapshotToolParameterValue(
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
    throw new TypeError(
      `Tool "${toolName}" parameters must be a bounded JSON Schema object`,
    );
  }
  return snapshot.value;
}

function snapshotToolParameters(
  toolDefinition: ToolDefinition,
): Record<string, unknown> {
  let parameters: unknown;
  try {
    parameters = getOwnDataProperty(
      toolDefinition,
      "parameters",
      `Tool "${toolDefinition.name}" definition`,
    );
  } catch {
    throw new TypeError(
      `Tool "${toolDefinition.name}" parameters must be a bounded JSON Schema object`,
    );
  }
  if (isMissingOwnDataProperty(parameters)) {
    throw new TypeError(
      `Tool "${toolDefinition.name}" parameters must be a bounded JSON Schema object`,
    );
  }
  return snapshotToolParameterValue(toolDefinition.name, parameters);
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
  if (properties === undefined) return false;
  if (
    typeof properties !== "object" ||
    properties === null ||
    Array.isArray(properties)
  ) {
    throw new TypeError(
      `Tool "${toolDefinition.name}" parameters.properties must be an object`,
    );
  }
  return Object.prototype.hasOwnProperty.call(properties, property);
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

/** Filter project scoped remote tool definitions. */
export function filterProjectScopedRemoteToolDefinitions(
  toolDefinitions: readonly ToolDefinition[],
  projectId: string | null,
  options: ProjectScopedRemoteToolOptions = {},
): ToolDefinition[] {
  if (normalizeProjectId(projectId)) {
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

  const projectReferenceDescriptor = Object.getOwnPropertyDescriptor(
    input.toolInput,
    "project_reference",
  );
  if (
    projectReferenceDescriptor &&
    "value" in projectReferenceDescriptor &&
    !isMissingRequiredToolInput(projectReferenceDescriptor.value)
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

/** Resolves project scoped remote tool project ID. */
export function resolveProjectScopedRemoteToolProjectId(
  context: ToolExecutionContext | undefined,
  defaultProjectId: string | null | undefined,
): string | null {
  const contextSnapshot = snapshotToolExecutionContext(context);
  return resolveProjectIdFromSnapshot(contextSnapshot, defaultProjectId);
}

function resolveProjectIdFromSnapshot(
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
  const contextSnapshot = snapshotToolExecutionContext(context);
  return withActiveProjectContextSnapshot(contextSnapshot, activeProjectId);
}

function withActiveProjectContextSnapshot(
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

function snapshotToolExecutionContext(
  context: ToolExecutionContext | undefined,
): ToolExecutionContext | undefined {
  if (context === undefined) return undefined;
  if (typeof context !== "object" || context === null || Array.isArray(context)) {
    throw new TypeError("Tool execution context must be an object");
  }
  return snapshotEnumerableOwnDataObject(context, "Tool execution context");
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
  return definitions.map((definitionValue, index) => {
    if (typeof definitionValue !== "object" || definitionValue === null) {
      throw new TypeError(
        `Remote source "${sourceId}" returned a malformed tool definition at index ${index}`,
      );
    }
    const label = `Remote source "${sourceId}" tool definition at index ${index}`;
    let name: unknown;
    let description: unknown;
    let parameters: unknown;
    let title: unknown;
    let annotations: unknown;
    try {
      name = getOwnDataProperty(definitionValue, "name", label);
      description = getOwnDataProperty(definitionValue, "description", label);
      parameters = getOwnDataProperty(definitionValue, "parameters", label);
      title = getOwnDataProperty(definitionValue, "title", label);
      annotations = getOwnDataProperty(definitionValue, "annotations", label);
    } catch {
      throw new TypeError(
        `Remote source "${sourceId}" returned a malformed tool definition at index ${index}`,
      );
    }
    if (
      isMissingOwnDataProperty(name) ||
      typeof name !== "string" ||
      name.length === 0 ||
      isMissingOwnDataProperty(description) ||
      typeof description !== "string" ||
      isMissingOwnDataProperty(parameters)
    ) {
      throw new TypeError(
        `Remote source "${sourceId}" returned a malformed tool definition at index ${index}`,
      );
    }
    if (names.has(name)) {
      throw new TypeError(
        `Remote source "${sourceId}" advertised duplicate tool name "${name}"`,
      );
    }
    names.add(name);

    const normalized: ToolDefinition = {
      name,
      description,
      parameters: snapshotToolParameterValue(name, parameters),
    };
    if (!isMissingOwnDataProperty(title) && title !== undefined) {
      if (typeof title !== "string" || title.length === 0) {
        throw new TypeError(
          `Remote source "${sourceId}" returned a malformed title for tool "${name}"`,
        );
      }
      normalized.title = title;
    }
    if (!isMissingOwnDataProperty(annotations) && annotations !== undefined) {
      const annotationSnapshot = snapshotBoundedJsonValue(annotations);
      if (
        !annotationSnapshot.success ||
        !isToolAnnotations(annotationSnapshot.value)
      ) {
        throw new TypeError(
          `Remote source "${sourceId}" returned malformed annotations for tool "${name}"`,
        );
      }
      normalized.annotations = annotationSnapshot.value;
    }
    return normalized;
  });
}

function captureProjectScopedRemoteToolOptions(
  options: ProjectScopedRemoteToolOptions | undefined,
): ProjectScopedRemoteToolOptions {
  const names = options?.projectNavigationToolNames;
  if (names === undefined) return {};
  const snapshot = snapshotBoundedJsonValue(names);
  if (
    !snapshot.success ||
    !Array.isArray(snapshot.value)
  ) {
    throw new TypeError("Project navigation tool names must be a bounded array of strings");
  }
  const projectNavigationToolNames: string[] = [];
  for (const name of snapshot.value) {
    if (typeof name !== "string" || name.length === 0) {
      throw new TypeError("Project navigation tool names must be a bounded array of strings");
    }
    projectNavigationToolNames.push(name);
  }
  return { projectNavigationToolNames };
}

function captureAllowedToolNameCheck(
  allowedToolNames: ReadonlySet<string> | null | undefined,
): (toolName: string) => boolean {
  if (!allowedToolNames) return () => true;
  const has = allowedToolNames.has;
  if (typeof has !== "function") {
    throw new TypeError("allowedToolNames must be a ReadonlySet");
  }
  return (toolName) => Reflect.apply(has, allowedToolNames, [toolName]);
}

/** Create project scoped remote tool catalog. */
export function createProjectScopedRemoteToolCatalog(
  input: ProjectScopedRemoteToolCatalogOptions,
): ProjectScopedRemoteToolCatalog {
  const source = input.source;
  const sourceId = source.id;
  const listSourceTools = source.listTools;
  if (
    typeof sourceId !== "string" ||
    sourceId.length === 0 ||
    typeof listSourceTools !== "function"
  ) {
    throw new TypeError("Project scoped remote tool source is invalid");
  }
  const defaultProjectId = input.defaultProjectId;
  const isAllowed = captureAllowedToolNameCheck(input.allowedToolNames);
  const projectScopedRemoteToolOptions = captureProjectScopedRemoteToolOptions(
    input.projectScopedRemoteToolOptions,
  );
  const filterToolDefinitions = input.filterToolDefinitions;
  if (
    filterToolDefinitions !== undefined &&
    typeof filterToolDefinitions !== "function"
  ) {
    throw new TypeError("Project scoped remote tool filter must be a function");
  }

  async function listActiveToolDefinitions(
    context?: ToolExecutionContext,
  ): Promise<ProjectScopedRemoteToolDefinitions> {
    const { activeProjectId, toolDefinitions } = await loadActiveToolDefinitions(
      context,
    );
    return { activeProjectId, toolDefinitions };
  }

  async function loadActiveToolDefinitions(
    context?: ToolExecutionContext,
  ): Promise<
    ProjectScopedRemoteToolDefinitions & {
      executeContext: ToolExecutionContext | undefined;
    }
  > {
    const contextSnapshot = snapshotToolExecutionContext(context);
    const activeProjectId = resolveProjectIdFromSnapshot(
      contextSnapshot,
      resolveDefaultProjectId(defaultProjectId),
    );

    const sourceContext = withActiveProjectContextSnapshot(
      contextSnapshot,
      activeProjectId,
    );
    const scopedToolDefinitions = filterProjectScopedRemoteToolDefinitions(
      normalizeToolDefinitions(
        sourceId,
        await Reflect.apply(listSourceTools, source, [sourceContext]),
      ),
      activeProjectId,
      projectScopedRemoteToolOptions,
    );
    const toolDefinitions = filterToolDefinitions
      ? await filterToolDefinitions({
        source,
        toolDefinitions: scopedToolDefinitions,
        activeProjectId,
        context: sourceContext,
      })
      : scopedToolDefinitions;

    return {
      activeProjectId,
      toolDefinitions: normalizeToolDefinitions(sourceId, toolDefinitions),
      executeContext: sourceContext,
    };
  }

  return {
    id: sourceId,
    listActiveToolDefinitions,
    async listTools(context) {
      const { toolDefinitions } = await listActiveToolDefinitions(context);
      return toolDefinitions.filter((toolDefinition) => isAllowed(toolDefinition.name));
    },
    async prepareExecution(executionInput) {
      if (!isAllowed(executionInput.toolName)) {
        throw PERMISSION_DENIED.create({
          detail: `Tool "${executionInput.toolName}" is not allowed for this run`,
        });
      }

      const {
        activeProjectId,
        toolDefinitions,
        executeContext,
      } = await loadActiveToolDefinitions(
        executionInput.context,
      );
      const toolDefinition = toolDefinitions.find((definition) =>
        definition.name === executionInput.toolName
      );
      if (!toolDefinition) {
        throw PERMISSION_DENIED.create({
          detail:
            `Tool "${executionInput.toolName}" is not advertised by remote source "${sourceId}"`,
        });
      }
      const toolInput = hydrateProjectScopedRemoteToolInput({
        toolDefinition,
        activeProjectId,
        toolInput: snapshotToolInput(executionInput.toolName, executionInput.toolInput),
      });
      validateRequiredToolInput({ toolDefinition, toolInput });

      return {
        activeProjectId,
        toolDefinitions,
        toolDefinition,
        toolInput,
        executeContext,
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
  const activeProjectId = normalizeProjectId(options.projectId);
  const sourceContext = withActiveProjectContext(options.context, activeProjectId);

  for (const source of remoteSources) {
    const definitions = normalizeToolDefinitions(
      source.id,
      await source.listTools(sourceContext),
    );
    const toolDefinitions = filterProjectScopedRemoteToolDefinitions(
      definitions,
      activeProjectId,
      options.projectScopedRemoteToolOptions,
    );
    for (const toolDefinition of toolDefinitions) {
      remoteToolNames.add(toolDefinition.name);
    }
  }

  return [...remoteToolNames].sort();
}
