import type { HostToolSet, ToolDefinition } from "#veryfront/tool";
import { compareStrings } from "#veryfront/utils/compare.ts";

const ANTHROPIC_PROVIDER_NATIVE_TOOL_NAMES = [
  "web_fetch",
  "web_search",
] as const;

const OPENAI_PROVIDER_NATIVE_TOOL_NAMES = ["web_search"] as const;

const PROVIDER_NATIVE_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  web_fetch: "Fetch and read the contents of a web page.",
  web_search: "Search the web for current information.",
};
const IntrinsicArraySort = Array.prototype.sort;
const IntrinsicObjectCreate = Object.create;
const IntrinsicReflectApply = Reflect.apply;

function copyNames(names: readonly string[]): string[] {
  const copy: string[] = [];
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    if (name !== undefined) copy[copy.length] = name;
  }
  return copy;
}

function uniqueNames(names: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = IntrinsicObjectCreate(null) as Record<string, true>;
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    if (name !== undefined && seen[name] !== true) {
      seen[name] = true;
      unique[unique.length] = name;
    }
  }
  return unique;
}

/** Options accepted by provider native tool inventory. */
export interface ProviderNativeToolInventoryOptions {
  model?: string;
  provider?: string;
}

interface ExpandAllowedRemoteToolNamesOptions extends ProviderNativeToolInventoryOptions {
  toolNames: readonly string[];
}

function resolveHostedProvider(model?: string): string | undefined {
  if (!model) {
    return undefined;
  }

  const [provider, second] = model.split("/", 3);
  if (!provider) {
    return undefined;
  }

  if (provider === "veryfront-cloud") {
    return second || undefined;
  }

  return provider;
}

export function resolveProviderNativeToolProvider(
  options?: ProviderNativeToolInventoryOptions,
): string | undefined {
  if (options?.provider && options.provider.length > 0) {
    return options.provider;
  }

  return resolveHostedProvider(options?.model);
}

/** Return provider native tool names. */
export function getProviderNativeToolNames(
  options?: ProviderNativeToolInventoryOptions,
): string[] {
  switch (resolveProviderNativeToolProvider(options)) {
    case "anthropic":
      return copyNames(ANTHROPIC_PROVIDER_NATIVE_TOOL_NAMES);
    case "openai":
      return copyNames(OPENAI_PROVIDER_NATIVE_TOOL_NAMES);
    default:
      return [];
  }
}

/** Create schema-free search entries for configured provider-native tools. */
export function createProviderNativeToolExposureDefinitions(
  options: ProviderNativeToolInventoryOptions & { toolNames: readonly string[] },
): ToolDefinition[] {
  const supported = IntrinsicObjectCreate(null) as Record<string, true>;
  const supportedNames = getProviderNativeToolNames(options);
  for (let index = 0; index < supportedNames.length; index++) {
    const name = supportedNames[index];
    if (name !== undefined) supported[name] = true;
  }
  const selected: ToolDefinition[] = [];
  const toolNames = uniqueNames(options.toolNames);
  for (let index = 0; index < toolNames.length; index++) {
    const toolName = toolNames[index];
    if (toolName === undefined || supported[toolName] !== true) continue;
    selected[selected.length] = {
      name: toolName,
      description: PROVIDER_NATIVE_TOOL_DESCRIPTIONS[toolName] ?? "Provider-native tool.",
      parameters: { type: "object", properties: {} },
    };
  }
  IntrinsicReflectApply(IntrinsicArraySort, selected, [
    (left: ToolDefinition, right: ToolDefinition) => compareStrings(left.name, right.name),
  ]);
  return selected;
}

/** Normalize allowed remote tool names without adding undeclared provider-native tools. */
export function expandAllowedRemoteToolNames(
  options: ExpandAllowedRemoteToolNamesOptions,
): string[] {
  const names = uniqueNames(options.toolNames);
  IntrinsicReflectApply(IntrinsicArraySort, names, [compareStrings]);
  return names;
}

/** Return fork runtime allowed tool names. */
export function getForkRuntimeAllowedToolNames(input: {
  provider: string;
  forkModel?: string;
  forkTools: HostToolSet;
}): string[] {
  return expandAllowedRemoteToolNames({
    provider: input.provider,
    model: input.forkModel,
    toolNames: Object.keys(input.forkTools),
  });
}
