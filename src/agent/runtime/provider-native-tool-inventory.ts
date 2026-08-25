import type { HostToolSet, ToolDefinition } from "#veryfront/tool";

const ANTHROPIC_PROVIDER_NATIVE_TOOL_NAMES = [
  "web_fetch",
  "web_search",
] as const;

const OPENAI_PROVIDER_NATIVE_TOOL_NAMES = ["web_search"] as const;

const PROVIDER_NATIVE_TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  web_fetch: "Fetch and read the contents of a web page.",
  web_search: "Search the web for current information.",
};

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
      return [...ANTHROPIC_PROVIDER_NATIVE_TOOL_NAMES];
    case "openai":
      return [...OPENAI_PROVIDER_NATIVE_TOOL_NAMES];
    default:
      return [];
  }
}

/** Create schema-free search entries for configured provider-native tools. */
export function createProviderNativeToolExposureDefinitions(
  options: ProviderNativeToolInventoryOptions & { toolNames: readonly string[] },
): ToolDefinition[] {
  const supported = new Set(getProviderNativeToolNames(options));
  return [...new Set(options.toolNames)]
    .filter((toolName) => supported.has(toolName))
    .sort()
    .map((toolName) => ({
      name: toolName,
      description: PROVIDER_NATIVE_TOOL_DESCRIPTIONS[toolName] ?? "Provider-native tool.",
      parameters: { type: "object", properties: {} },
    }));
}

/** Normalize allowed remote tool names without adding undeclared provider-native tools. */
export function expandAllowedRemoteToolNames(
  options: ExpandAllowedRemoteToolNamesOptions,
): string[] {
  return [...new Set(options.toolNames)].sort();
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
