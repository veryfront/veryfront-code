import { z } from "zod";
import { dynamicTool } from "./factory.ts";
import type { RemoteToolSource, Tool, ToolDefinition, ToolExecutionContext } from "./types.ts";

export interface RemoteToolMaterializationOptions {
  context?: ToolExecutionContext;
  toolNameAliases?: Record<string, string>;
}

function toToolInputRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(Object.entries(input));
}

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
          inputSchema: z.object({}).passthrough(),
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

export async function loadRemoteToolsFromSource(
  source: RemoteToolSource,
  options: RemoteToolMaterializationOptions = {},
): Promise<Record<string, Tool<unknown, unknown>>> {
  const definitions = await source.listTools(options.context);
  return createToolsFromRemoteDefinitions(source, definitions, {
    toolNameAliases: options.toolNameAliases,
  });
}
