/**
 * Framework-default `providerOptions` for known providers.
 *
 * Currently: enable Anthropic extended thinking by default only for Veryfront
 * Cloud models the served catalog gives a thinking budget. A direct-provider
 * model takes none: the catalog describes what the gateway serves, and a direct
 * run must resolve the same whether or not a catalog happens to be loaded.
 * Apps can override or opt out by returning their own
 * `providerOptions.anthropic.thinking` from `AgentConfig.resolveModelTransport`.
 */

import {
  isVeryfrontCloudAnthropicSurfaceModel,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudThinkingProviderOptions,
  VERYFRONT_CLOUD_MODEL_PREFIX,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";

/**
 * Whether a Veryfront Cloud model speaks the Anthropic protocol: the surface
 * the served catalog gives its provider, so a newly served provider on the
 * Anthropic surface gets the same defaults.
 */
function isCloudAnthropicModel(modelString: string): boolean {
  return modelString.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX) &&
    isVeryfrontCloudAnthropicSurfaceModel(modelString);
}

function hasAnthropicThinkingConfig(existing: Record<string, unknown> | undefined): boolean {
  if (!existing || typeof existing !== "object") return false;
  const anthropic = (existing as { anthropic?: unknown }).anthropic;
  if (!anthropic || typeof anthropic !== "object") return false;
  return "thinking" in (anthropic as Record<string, unknown>);
}

export function resolveProviderOptionsWithDefaults(
  modelString: string,
  existing: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!isCloudAnthropicModel(modelString)) {
    return existing;
  }

  if (hasAnthropicThinkingConfig(existing)) {
    return existing;
  }

  const thinking = resolveVeryfrontCloudModelThinking(modelString);
  const defaults = thinking
    ? resolveVeryfrontCloudThinkingProviderOptions(modelString, thinking)
    : undefined;
  const defaultAnthropic = defaults?.anthropic as Record<string, unknown> | undefined;
  if (!defaultAnthropic) {
    return existing;
  }

  const existingAnthropic = (existing?.anthropic ?? {}) as Record<string, unknown>;
  return {
    ...(existing ?? {}),
    anthropic: {
      // Defaults first; host-supplied fields (e.g. temperature) override them.
      // Only `thinking` is forced because we already confirmed it isn't set.
      ...defaultAnthropic,
      ...existingAnthropic,
      thinking: defaultAnthropic.thinking,
    },
  };
}
