/**
 * Framework-default `providerOptions` for known providers.
 *
 * Currently: enable Anthropic extended thinking by default for any
 * Anthropic model, since the `reasoning-*` event surface in this framework
 * relies on the provider-side feature being on. Apps can override or opt
 * out by returning their own `providerOptions.anthropic.thinking` from
 * `AgentConfig.resolveModelTransport`.
 */

const VERYFRONT_CLOUD_PREFIX = "veryfront-cloud/";
const ANTHROPIC_PREFIX = "anthropic/";
const DEFAULT_ANTHROPIC_THINKING_BUDGET_TOKENS = 2048;

function isAnthropicModel(modelString: string): boolean {
  const normalized = modelString.startsWith(VERYFRONT_CLOUD_PREFIX)
    ? modelString.slice(VERYFRONT_CLOUD_PREFIX.length)
    : modelString;
  return normalized.startsWith(ANTHROPIC_PREFIX);
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
  if (!isAnthropicModel(modelString)) {
    return existing;
  }

  if (hasAnthropicThinkingConfig(existing)) {
    return existing;
  }

  const existingAnthropic = (existing?.anthropic ?? {}) as Record<string, unknown>;
  return {
    ...(existing ?? {}),
    anthropic: {
      // Defaults first; host-supplied fields (e.g. temperature) override them.
      // Only `thinking` is forced because we already confirmed it isn't set.
      temperature: 1,
      ...existingAnthropic,
      thinking: { type: "enabled", budget_tokens: DEFAULT_ANTHROPIC_THINKING_BUDGET_TOKENS },
    },
  };
}
