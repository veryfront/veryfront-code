import { getErrorMessage, INVALID_ARGUMENT } from "#veryfront/errors";
import { dynamicTool } from "./factory.ts";
import { snapshotJsonValue } from "./json-value.ts";
import { raceWithAbort } from "./abort.ts";
import type { RemoteToolSource, Tool, ToolDefinition, ToolExecutionContext } from "./types.ts";

/** Options accepted by remote tool materialization. */
export interface RemoteToolMaterializationOptions {
  /** Context supplied while listing remote tools. */
  context?: ToolExecutionContext;
  /** Optional mapping from remote names to model-facing tool names. */
  toolNameAliases?: Record<string, string>;
}

const MAX_REMOTE_TOOL_DEFINITIONS = 10_000;
const MAX_REMOTE_TOOL_NAME_LENGTH = 128;
const MAX_REMOTE_TOOL_DESCRIPTION_LENGTH = 16_384;
const MAX_REMOTE_DEFINITION_BYTES = 16 * 1024 * 1024;

function hasUnsafeControlCharacters(value: string, allowFormattingWhitespace = false): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 127 || (code < 32 && !(allowFormattingWhitespace && [9, 10, 13].includes(code)))
    ) {
      return true;
    }
  }
  return false;
}

function toToolInputRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw INVALID_ARGUMENT.create({ detail: "Remote tool arguments must be an object" });
  }
  try {
    return snapshotJsonValue(input, {
      label: "Remote tool arguments",
      maxBytes: MAX_REMOTE_DEFINITION_BYTES,
      maxStringLength: MAX_REMOTE_DEFINITION_BYTES,
    }) as Record<string, unknown>;
  } catch (error) {
    throw INVALID_ARGUMENT.create({ detail: getErrorMessage(error) });
  }
}

function snapshotDefinitions(definitions: readonly ToolDefinition[]): ToolDefinition[] {
  if (!Array.isArray(definitions)) {
    throw INVALID_ARGUMENT.create({ detail: "Remote tool definitions must be an array" });
  }
  if (definitions.length > MAX_REMOTE_TOOL_DEFINITIONS) {
    throw INVALID_ARGUMENT.create({
      detail: `Remote tool definitions cannot exceed ${MAX_REMOTE_TOOL_DEFINITIONS} entries`,
    });
  }
  try {
    return snapshotJsonValue(definitions, {
      label: "Remote tool definitions",
      maxBytes: MAX_REMOTE_DEFINITION_BYTES,
      maxStringLength: MAX_REMOTE_DEFINITION_BYTES,
      maxNodes: 250_000,
    });
  } catch (error) {
    throw INVALID_ARGUMENT.create({ detail: getErrorMessage(error) });
  }
}

function snapshotAliases(aliases: Record<string, string> | undefined): Map<string, string> {
  const snapshot = new Map<string, string>();
  if (aliases === undefined) return snapshot;
  if (aliases === null || typeof aliases !== "object" || Array.isArray(aliases)) {
    throw INVALID_ARGUMENT.create({ detail: "Remote tool aliases must be an object" });
  }

  let descriptors: PropertyDescriptorMap;
  try {
    descriptors = Object.getOwnPropertyDescriptors(aliases);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: "Remote tool aliases could not be inspected" });
  }
  const names = Object.keys(descriptors);
  if (names.length > MAX_REMOTE_TOOL_DEFINITIONS) {
    throw INVALID_ARGUMENT.create({
      detail: `Remote tool aliases cannot exceed ${MAX_REMOTE_TOOL_DEFINITIONS} entries`,
    });
  }
  for (const name of names) {
    const descriptor = descriptors[name];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw INVALID_ARGUMENT.create({ detail: "Remote tool aliases must use data properties" });
    }
    if (typeof descriptor.value !== "string") {
      throw INVALID_ARGUMENT.create({ detail: `Remote tool alias for "${name}" must be a string` });
    }
    snapshot.set(name, descriptor.value);
  }
  return snapshot;
}

function validateRemoteDefinition(definition: ToolDefinition, index: number): void {
  if (
    typeof definition.name !== "string" || definition.name.trim().length === 0 ||
    definition.name.trim() !== definition.name ||
    definition.name.length > MAX_REMOTE_TOOL_NAME_LENGTH ||
    hasUnsafeControlCharacters(definition.name)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `Remote tool definition ${index} has an invalid name`,
    });
  }
  if (
    typeof definition.description !== "string" || definition.description.trim().length === 0 ||
    definition.description.length > MAX_REMOTE_TOOL_DESCRIPTION_LENGTH ||
    hasUnsafeControlCharacters(definition.description, true)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `Remote tool "${definition.name}" has an invalid description`,
    });
  }
  if (
    typeof definition.parameters !== "object" || definition.parameters === null ||
    Array.isArray(definition.parameters)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `Remote tool "${definition.name}" has an invalid input schema`,
    });
  }
}

/** Create tools from remote definitions. */
export function createToolsFromRemoteDefinitions(
  source: RemoteToolSource,
  definitions: readonly ToolDefinition[],
  options: Omit<RemoteToolMaterializationOptions, "context"> = {},
): Record<string, Tool<unknown, unknown>> {
  const tools: Record<string, Tool<unknown, unknown>> = {};
  const sourceNameByToolName = new Map<string, string>();
  if (!source || typeof source !== "object" || typeof source.executeTool !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "Remote tool source executeTool must be a function" });
  }
  const executeTool = source.executeTool.bind(source);
  const definitionSnapshots = snapshotDefinitions(definitions);
  const aliases = snapshotAliases(options.toolNameAliases);

  for (let index = 0; index < definitionSnapshots.length; index += 1) {
    const definition = definitionSnapshots[index]!;
    validateRemoteDefinition(definition, index);
    const toolName = aliases.has(definition.name) ? aliases.get(definition.name) : definition.name;
    if (
      typeof toolName !== "string" || toolName.trim().length === 0 ||
      toolName.trim() !== toolName || toolName.length > MAX_REMOTE_TOOL_NAME_LENGTH ||
      hasUnsafeControlCharacters(toolName)
    ) {
      throw INVALID_ARGUMENT.create({
        detail: `Remote tool alias for "${definition.name}" must be a non-empty string`,
      });
    }

    const existingSourceName = sourceNameByToolName.get(toolName);
    if (existingSourceName !== undefined) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Remote tools "${existingSourceName}" and "${definition.name}" both map to "${toolName}"`,
      });
    }
    sourceNameByToolName.set(toolName, definition.name);

    const runtimeTool = dynamicTool({
      id: toolName,
      description: definition.description,
      inputSchema: {},
      inputSchemaJson: definition.parameters,
      mcp: {
        title: definition.title,
        annotations: definition.annotations,
      },
      execute: async (input, context) =>
        await executeTool(definition.name, toToolInputRecord(input), context),
    });
    Object.defineProperty(tools, toolName, {
      value: runtimeTool,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }

  return tools;
}

/** Loads remote tools from source. */
export async function loadRemoteToolsFromSource(
  source: RemoteToolSource,
  options: RemoteToolMaterializationOptions = {},
): Promise<Record<string, Tool<unknown, unknown>>> {
  if (!source || typeof source !== "object" || typeof source.listTools !== "function") {
    throw INVALID_ARGUMENT.create({ detail: "Remote tool source listTools must be a function" });
  }
  options.context?.abortSignal?.throwIfAborted();
  const listTools = source.listTools.bind(source);
  const definitions = await raceWithAbort(
    Promise.resolve().then(() => listTools(options.context)),
    options.context?.abortSignal,
  );
  options.context?.abortSignal?.throwIfAborted();
  return createToolsFromRemoteDefinitions(source, definitions, {
    toolNameAliases: options.toolNameAliases,
  });
}
