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
  normalizeProviderToolInputSchema,
  sanitizeProviderToolSchema,
  selectProviderCompatibleTools,
} from "./provider-tool-compat.ts";
import type { ToolExposurePlan } from "./tool-exposure.ts";
import { createToolSearchDefinition, TOOL_SEARCH_TOOL_NAME } from "./tool-exposure.ts";

export type NativeToolSearchProjection = {
  mode: "hosted" | "client";
  variant?: "regex" | "bm25";
};

export interface ConvertToolsToRuntimeToolsOptions {
  model?: string;
  providerTools?: string[];
  toolExposurePlan?: ToolExposurePlan;
  nativeToolSearch?: NativeToolSearchProjection;
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
  const providerNativeTools = resolveProviderNativeTools(options);
  const providerNativeToolNames = new Set(Object.keys(providerNativeTools ?? {}));
  const sourceTools = options?.nativeToolSearch && options.toolExposurePlan
    ? [...options.toolExposurePlan.authorized, createToolSearchDefinition()]
    : tools;
  const deferredToolNames = options?.nativeToolSearch && options.toolExposurePlan
    ? new Set(options.toolExposurePlan.deferred.map((tool) => tool.name))
    : new Set<string>();
  const compatibleTools = selectProviderCompatibleTools(sourceTools, {
    model: options?.model,
  });

  for (const def of compatibleTools) {
    if (providerNativeToolNames.has(def.name)) {
      continue;
    }
    addRuntimeTool(
      toolSet,
      def.name,
      createRuntimeTool({
        description: def.description,
        deferLoading: deferredToolNames.has(def.name),
        nativeToolSearch: def.name === TOOL_SEARCH_TOOL_NAME
          ? options?.nativeToolSearch
          : undefined,
        inputSchema: createRuntimeJsonSchema(
          sanitizeProviderToolSchema(normalizeProviderToolInputSchema(def.parameters), {
            model: options?.model,
          }),
        ),
      }),
    );
  }

  if (providerNativeTools) {
    for (const [name, providerTool] of Object.entries(providerNativeTools)) {
      toolSet[name] = providerTool;
    }
  }

  return Object.keys(toolSet).length > 0 ? toolSet : undefined;
}
