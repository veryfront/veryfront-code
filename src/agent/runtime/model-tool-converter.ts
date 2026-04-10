/**
 * Model Tool Converter
 *
 * Converts veryfront ToolDefinition[] to the current model-runtime ToolSet
 * format using framework-owned plain tool/schema objects.
 *
 * @module agent/runtime/model-tool-converter
 */
import type { ToolDefinition } from "#veryfront/tool";
import type { RuntimeToolSet } from "./runtime-tool-types.ts";
import {
  addRuntimeTool,
  createRuntimeJsonSchema,
  createRuntimeTool,
} from "./runtime-tool-builder.ts";
import {
  createAnthropicWebFetchToolSet,
  createAnthropicWebSearchToolSet,
} from "./provider-native-tools.ts";

export interface ConvertToolsToRuntimeToolsOptions {
  model?: string;
  allowedToolNames?: string[];
}

function resolveHostedProvider(model?: string): string | undefined {
  if (!model) return undefined;

  const [provider, second] = model.split("/", 3);
  if (!provider) return undefined;
  if (provider === "veryfront-cloud") {
    return second || undefined;
  }

  return provider;
}

function resolveProviderNativeTools(
  options?: ConvertToolsToRuntimeToolsOptions,
): RuntimeToolSet | undefined {
  if (
    !options?.allowedToolNames?.some((toolName) =>
      toolName === "web_search" || toolName === "web_fetch"
    )
  ) {
    return undefined;
  }

  if (resolveHostedProvider(options.model) !== "anthropic") {
    return undefined;
  }

  return {
    ...createAnthropicWebSearchToolSet(),
    ...createAnthropicWebFetchToolSet(),
  };
}

/**
 * Convert veryfront tool definitions to the current model-runtime ToolSet.
 *
 * We only provide the schema/metadata the runtime substrate needs here.
 * Tool execution remains owned by the agent runtime.
 */
export function convertToolsToRuntimeTools(
  tools: ToolDefinition[],
  options?: ConvertToolsToRuntimeToolsOptions,
): RuntimeToolSet | undefined {
  const toolSet: RuntimeToolSet = {};

  for (const def of tools) {
    addRuntimeTool(
      toolSet,
      def.name,
      createRuntimeTool({
        description: def.description,
        inputSchema: createRuntimeJsonSchema(def.parameters),
      }),
    );
  }

  const providerNativeTools = resolveProviderNativeTools(options);
  if (providerNativeTools) {
    for (const [name, providerTool] of Object.entries(providerNativeTools)) {
      if (!Object.hasOwn(toolSet, name)) {
        toolSet[name] = providerTool;
      }
    }
  }

  return Object.keys(toolSet).length > 0 ? toolSet : undefined;
}
