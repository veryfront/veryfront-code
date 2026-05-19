import { defineSchema } from "#veryfront/schemas/index.ts";
import { dynamicTool } from "./factory.ts";
import type { RemoteToolSource, Tool, ToolDefinition, ToolExecutionContext } from "./types.ts";

/** Options accepted by remote tool materialization. */
export interface RemoteToolMaterializationOptions {
  context?: ToolExecutionContext;
  toolNameAliases?: Record<string, string>;
}

/**
 * Permissive input schema used for remote tools whose JSON Schema is
 * sourced from the remote and we only need a no-op contract `Schema<T>` to
 * satisfy the runtime input-validation pass. Equivalent to
 * `z.object({}).passthrough()`.
 */
const getRemoteToolPassthroughSchema = defineSchema((v) => v.object({}).passthrough());

function toToolInputRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(Object.entries(input));
}

/** Create tools from remote definitions. */
export function createToolsFromRemoteDefinitions(
  source: RemoteToolSource,
  definitions: readonly ToolDefinition[],
  options: Omit<RemoteToolMaterializationOptions, "context"> = {},
): Record<string, Tool<unknown, unknown>> {
  return Object.fromEntries(
    definitions.map((definition) => {
      const toolName = options.toolNameAliases?.[definition.name] ?? definition.name;

      return [
        toolName,
        dynamicTool({
          id: toolName,
          description: definition.description,
          inputSchema: getRemoteToolPassthroughSchema(),
          inputSchemaJson: definition.parameters,
          mcp: {
            title: definition.title,
            annotations: definition.annotations,
          },
          execute: async (input, context) =>
            await source.executeTool(definition.name, toToolInputRecord(input), context),
        }),
      ];
    }),
  );
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
