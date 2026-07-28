import { dynamicTool } from "./factory.ts";
import { markRemoteToolProvenance } from "./remote-tool-provenance.ts";
import type { RemoteToolSource, Tool, ToolDefinition, ToolExecutionContext } from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  getEnumerableOwnStringDataEntries,
  getOwnDataProperty,
  isMissingOwnDataProperty,
} from "./data-properties.ts";

/** Options accepted by remote tool materialization. */
export interface RemoteToolMaterializationOptions {
  context?: ToolExecutionContext;
  toolNameAliases?: Record<string, string>;
}

function toToolInputRecord(input: unknown): Record<string, unknown> {
  const snapshot = snapshotBoundedJsonValue(input);
  if (
    !snapshot.success ||
    typeof snapshot.value !== "object" ||
    snapshot.value === null ||
    Array.isArray(snapshot.value)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Remote tool input must be a bounded JSON object",
    });
  }
  return snapshot.value;
}

function captureToolNameAliases(
  value: Record<string, string> | undefined,
): ReadonlyMap<string, string> {
  if (value === undefined) return new Map();
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Remote tool name aliases must be an object");
  }
  const aliases = new Map<string, string>();
  for (
    const [canonicalName, materializedName] of getEnumerableOwnStringDataEntries(
      value,
      "Remote tool name aliases",
    )
  ) {
    if (typeof materializedName !== "string" || materializedName.length === 0) {
      throw INVALID_ARGUMENT.create({
        detail: `Remote tool "${canonicalName}" must have a non-empty materialized name`,
      });
    }
    aliases.set(canonicalName, materializedName);
  }
  return aliases;
}

function captureRemoteToolDefinition(
  value: ToolDefinition,
  index: number,
): ToolDefinition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Remote tool definition at index ${index} must be an object`);
  }
  const label = `Remote tool definition at index ${index}`;
  let name: unknown;
  let description: unknown;
  let parameters: unknown;
  let title: unknown;
  let annotations: unknown;
  try {
    name = getOwnDataProperty(value, "name", label);
    description = getOwnDataProperty(value, "description", label);
    parameters = getOwnDataProperty(value, "parameters", label);
    title = getOwnDataProperty(value, "title", label);
    annotations = getOwnDataProperty(value, "annotations", label);
  } catch {
    throw new TypeError(`${label} must contain only own data properties`);
  }
  if (
    isMissingOwnDataProperty(name) ||
    typeof name !== "string" ||
    name.length === 0 ||
    isMissingOwnDataProperty(description) ||
    typeof description !== "string" ||
    isMissingOwnDataProperty(parameters)
  ) {
    throw new TypeError(`${label} is malformed`);
  }

  return {
    name,
    description,
    parameters: parameters as ToolDefinition["parameters"],
    ...(!isMissingOwnDataProperty(title) && title !== undefined
      ? { title: title as ToolDefinition["title"] }
      : {}),
    ...(!isMissingOwnDataProperty(annotations) && annotations !== undefined
      ? { annotations: annotations as ToolDefinition["annotations"] }
      : {}),
  };
}

/** Create tools from remote definitions. */
export function createToolsFromRemoteDefinitions(
  source: RemoteToolSource,
  definitions: readonly ToolDefinition[],
  options: Omit<RemoteToolMaterializationOptions, "context"> = {},
): Record<string, Tool<unknown, unknown>> {
  const entries: Array<[string, Tool<unknown, unknown>]> = [];
  const materializedNames = new Set<string>();
  const aliases = captureToolNameAliases(options.toolNameAliases);
  const executeTool = source.executeTool;
  if (typeof executeTool !== "function") {
    throw new TypeError("Remote tool source executeTool must be a function");
  }

  for (let index = 0; index < definitions.length; index += 1) {
    const definition = captureRemoteToolDefinition(definitions[index]!, index);
    const toolName = aliases.get(definition.name) ?? definition.name;
    if (typeof toolName !== "string" || toolName.length === 0) {
      throw INVALID_ARGUMENT.create({
        detail: `Remote tool "${definition.name}" must have a non-empty materialized name`,
      });
    }
    if (materializedNames.has(toolName)) {
      throw INVALID_ARGUMENT.create({
        detail: `Remote definitions contain duplicate materialized tool name "${toolName}"`,
      });
    }
    materializedNames.add(toolName);

    const remoteTool = markRemoteToolProvenance(
      dynamicTool({
        id: toolName,
        description: definition.description,
        // The remote JSON Schema is provider metadata; the remote server owns
        // semantic validation. Keep the local admission path data-only so a
        // caller-controlled accessor cannot run inside a schema adapter.
        inputSchema: {},
        inputSchemaJson: definition.parameters,
        mcp: {
          title: definition.title,
          annotations: definition.annotations,
        },
        execute: async (input, context) =>
          await Reflect.apply(executeTool, source, [
            definition.name,
            toToolInputRecord(input),
            context,
          ]),
      }),
      definition.name,
    );
    entries.push([toolName, remoteTool]);
  }

  return Object.fromEntries(entries);
}

/** Loads remote tools from source. */
export async function loadRemoteToolsFromSource(
  source: RemoteToolSource,
  options: RemoteToolMaterializationOptions = {},
): Promise<Record<string, Tool<unknown, unknown>>> {
  const definitions = await source.listTools(options.context);
  return createToolsFromRemoteDefinitions(source, definitions, {
    toolNameAliases: options.toolNameAliases,
  });
}
