import type { HostToolSet } from "#veryfront/tool";

const ANTHROPIC_PROVIDER_NATIVE_TOOL_NAMES = [
  "web_fetch",
  "web_search",
] as const;

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

function resolveProvider(options?: ProviderNativeToolInventoryOptions): string | undefined {
  if (options?.provider && options.provider.length > 0) {
    return options.provider;
  }

  return resolveHostedProvider(options?.model);
}

/** Return provider native tool names. */
export function getProviderNativeToolNames(
  options?: ProviderNativeToolInventoryOptions,
): string[] {
  switch (resolveProvider(options)) {
    case "anthropic":
      return [...ANTHROPIC_PROVIDER_NATIVE_TOOL_NAMES];
    default:
      return [];
  }
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
