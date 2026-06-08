/**
 * Framework-default `providerOptions` for known providers.
 *
 * Currently: enable Anthropic extended thinking by default only for catalog
 * models that declare a thinking budget. Apps can override or opt out by
 * returning their own `providerOptions.anthropic.thinking` from
 * `AgentConfig.resolveModelTransport`.
 */

import { resolveVeryfrontCloudModelThinking } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";

const VERYFRONT_CLOUD_PREFIX = "veryfront-cloud/";
const ANTHROPIC_PREFIX = "anthropic/";

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

function resolveAnthropicThinkingBudgetTokens(modelString: string): number | undefined {
  const thinking = resolveVeryfrontCloudModelThinking(modelString);
  if (
    thinking?.enabled !== true || typeof thinking.budgetTokens !== "number" ||
    thinking.budgetTokens <= 0
  ) {
    return undefined;
  }
  return Math.floor(thinking.budgetTokens);
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

  const budgetTokens = resolveAnthropicThinkingBudgetTokens(modelString);
  if (!budgetTokens) {
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
      thinking: { type: "enabled", budget_tokens: budgetTokens },
    },
  };
}
