/**
 * Model Tool Converter
 *
 * Converts veryfront ToolDefinition[] to the current model-runtime ToolSet
 * format using framework-owned plain tool/schema objects.
 *
 * @module agent/runtime/model-tool-converter
 */
import type { ToolDefinition } from "#veryfront/tool";
import { getProviderNativeToolNames } from "./provider-native-tool-inventory.ts";
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
import {
  sanitizeProviderToolSchema,
  selectProviderCompatibleTools,
} from "./provider-tool-compat.ts";

export interface ConvertToolsToRuntimeToolsOptions {
  model?: string;
  providerTools?: string[];
}

function resolveProviderNativeTools(
  options?: ConvertToolsToRuntimeToolsOptions,
): RuntimeToolSet | undefined {
  const providerNativeToolNames = new Set(getProviderNativeToolNames({
    model: options?.model,
  }));

  if (providerNativeToolNames.size === 0) {
    return undefined;
  }

  const allowedProviderNativeToolNames =
    options?.providerTools?.filter((toolName) => providerNativeToolNames.has(toolName)) ?? [];
  if (allowedProviderNativeToolNames.length === 0) {
    return undefined;
  }

  const toolSet: RuntimeToolSet = {};
  if (allowedProviderNativeToolNames.includes("web_search")) {
    Object.assign(toolSet, createAnthropicWebSearchToolSet());
  }
  if (allowedProviderNativeToolNames.includes("web_fetch")) {
    Object.assign(toolSet, createAnthropicWebFetchToolSet());
  }

  return Object.keys(toolSet).length > 0 ? toolSet : undefined;
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
  const compatibleTools = selectProviderCompatibleTools(tools, {
    model: options?.model,
  });

  for (const def of compatibleTools) {
    addRuntimeTool(
      toolSet,
      def.name,
      createRuntimeTool({
        description: def.description,
        inputSchema: createRuntimeJsonSchema(
          sanitizeProviderToolSchema(def.parameters, { model: options?.model }),
        ),
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
