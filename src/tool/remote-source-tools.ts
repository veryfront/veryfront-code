import { dynamicTool } from "./factory.ts";
import { markRemoteToolProvenance } from "./remote-tool-provenance.ts";
import type { RemoteToolSource, Tool, ToolDefinition, ToolExecutionContext } from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

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

/** Create tools from remote definitions. */
export function createToolsFromRemoteDefinitions(
  source: RemoteToolSource,
  definitions: readonly ToolDefinition[],
  options: Omit<RemoteToolMaterializationOptions, "context"> = {},
): Record<string, Tool<unknown, unknown>> {
  const entries: Array<[string, Tool<unknown, unknown>]> = [];
  const materializedNames = new Set<string>();

  for (const definition of definitions) {
    const hasAlias = options.toolNameAliases !== undefined &&
      Object.hasOwn(options.toolNameAliases, definition.name);
    const toolName = hasAlias ? options.toolNameAliases![definition.name] : definition.name;
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
          await source.executeTool(definition.name, toToolInputRecord(input), context),
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
