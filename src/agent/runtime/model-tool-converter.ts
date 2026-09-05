/**
 * Model Tool Converter
 *
 * Converts veryfront ToolDefinition[] to the current model-runtime ToolSet
 * format using framework-owned plain tool/schema objects.
 *
 * @module agent/runtime/model-tool-converter
 */
import type { ToolDefinition } from "#veryfront/tool";
import {
  getProviderNativeToolNames,
  resolveProviderNativeToolProvider,
} from "./provider-native-tool-inventory.ts";
import type { RuntimeToolSet } from "./runtime-tool-types.ts";
import {
  addRuntimeTool,
  createRuntimeJsonSchema,
  createRuntimeTool,
} from "./runtime-tool-builder.ts";
import {
  createAnthropicWebFetchToolSet,
  createAnthropicWebSearchToolSet,
  createOpenAIWebSearchToolSet,
} from "./provider-native-tools.ts";
import {
  createMoonshotSchemaExpansionBudget,
  normalizeProviderToolInputSchema,
  sanitizeProviderToolSchema,
  selectProviderCompatibleTools,
} from "./provider-tool-compat.ts";

export interface ConvertToolsToRuntimeToolsOptions {
  model?: string;
  providerTools?: string[];
}

const intrinsicReflectApply = Reflect.apply;
const intrinsicArrayFilter = Array.prototype.filter;
const NativeSet = Set;
const intrinsicSetAdd = Set.prototype.add;
const intrinsicSetHas = Set.prototype.has;
const intrinsicObjectAssign = Object.assign;
const intrinsicObjectEntries = Object.entries;
const intrinsicObjectKeys = Object.keys;

function createStringSet(values: readonly string[]): Set<string> {
  const set = new NativeSet<string>();
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value !== undefined) intrinsicReflectApply(intrinsicSetAdd, set, [value]);
  }
  return set;
}

function resolveProviderNativeTools(
  options?: ConvertToolsToRuntimeToolsOptions,
): RuntimeToolSet | undefined {
  const providerNativeToolNames = createStringSet(getProviderNativeToolNames({
    model: options?.model,
  }));

  if (providerNativeToolNames.size === 0) {
    return undefined;
  }

  const allowedProviderNativeToolNames = options?.providerTools === undefined
    ? []
    : intrinsicReflectApply(intrinsicArrayFilter, options.providerTools, [
      (toolName: string) =>
        intrinsicReflectApply(intrinsicSetHas, providerNativeToolNames, [toolName]) as boolean,
    ]) as string[];
  if (allowedProviderNativeToolNames.length === 0) {
    return undefined;
  }
  const allowedProviderNativeTools = createStringSet(allowedProviderNativeToolNames);

  const toolSet: RuntimeToolSet = {};
  const provider = resolveProviderNativeToolProvider({ model: options?.model });
  if (intrinsicReflectApply(intrinsicSetHas, allowedProviderNativeTools, ["web_search"])) {
    if (provider === "anthropic") {
      intrinsicReflectApply(intrinsicObjectAssign, Object, [
        toolSet,
        createAnthropicWebSearchToolSet(),
      ]);
    } else if (provider === "openai") {
      intrinsicReflectApply(intrinsicObjectAssign, Object, [
        toolSet,
        createOpenAIWebSearchToolSet(),
      ]);
    }
  }
  if (
    provider === "anthropic" &&
    intrinsicReflectApply(intrinsicSetHas, allowedProviderNativeTools, ["web_fetch"])
  ) {
    intrinsicReflectApply(intrinsicObjectAssign, Object, [
      toolSet,
      createAnthropicWebFetchToolSet(),
    ]);
  }

  return (intrinsicReflectApply(intrinsicObjectKeys, Object, [toolSet]) as string[]).length > 0
    ? toolSet
    : undefined;
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
  const providerNativeToolNames = createStringSet(
    intrinsicReflectApply(intrinsicObjectKeys, Object, [providerNativeTools ?? {}]) as string[],
  );
  const compatibleTools = selectProviderCompatibleTools(tools, {
    model: options?.model,
  });
  // One budget for the whole tool set: a per-schema cap bounds each tool in isolation,
  // but a source advertising hundreds of admissible schemas would otherwise multiply
  // the worst-case `$ref` expansion by the tool count.
  const moonshotExpansionBudget = createMoonshotSchemaExpansionBudget();

  for (let index = 0; index < compatibleTools.length; index++) {
    const def = compatibleTools[index];
    if (def === undefined) continue;
    if (intrinsicReflectApply(intrinsicSetHas, providerNativeToolNames, [def.name])) {
      continue;
    }
    addRuntimeTool(
      toolSet,
      def.name,
      createRuntimeTool({
        description: def.description,
        inputSchema: createRuntimeJsonSchema(
          sanitizeProviderToolSchema(normalizeProviderToolInputSchema(def.parameters), {
            model: options?.model,
            moonshotExpansionBudget,
          }),
        ),
      }),
    );
  }

  if (providerNativeTools) {
    const providerToolEntries = intrinsicReflectApply(
      intrinsicObjectEntries,
      Object,
      [providerNativeTools],
    ) as Array<[string, RuntimeToolSet[string]]>;
    for (let index = 0; index < providerToolEntries.length; index++) {
      const entry = providerToolEntries[index];
      if (entry === undefined) continue;
      const name = entry[0];
      const providerTool = entry[1];
      toolSet[name] = providerTool;
    }
  }

  return (intrinsicReflectApply(intrinsicObjectKeys, Object, [toolSet]) as string[]).length > 0
    ? toolSet
    : undefined;
}
