import {
  getAnthropicEnvConfig,
  getGoogleGenAIEnvConfig,
  getOpenAIEnvConfig,
} from "#veryfront/config/env.ts";
import { findAvailableCloudModel } from "#veryfront/provider";
import { DEFAULT_LOCAL_MODEL } from "#veryfront/provider/local/model-catalog.ts";
import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";

export const AUTO_AGENT_MODEL = "auto";

const HOSTED_PROVIDER_NAMES = new Set(["anthropic", "google", "openai"]);

export function normalizeAgentModelConfig(model?: string): string {
  const normalized = model?.trim();
  return normalized && normalized.length > 0 ? normalized : AUTO_AGENT_MODEL;
}

export function resolveConfiguredAgentModel(model?: string): string {
  const normalized = normalizeAgentModelConfig(model);
  return normalized === AUTO_AGENT_MODEL ? `local/${DEFAULT_LOCAL_MODEL}` : normalized;
}

function hasDirectProviderCredentials(provider: string): boolean {
  switch (provider) {
    case "anthropic":
      return Boolean(getAnthropicEnvConfig().apiKey);
    case "google":
      return Boolean(getGoogleGenAIEnvConfig().apiKey);
    case "openai":
      return Boolean(getOpenAIEnvConfig().apiKey);
    default:
      return false;
  }
}

/**
 * Resolve the effective runtime model string for agent execution.
 *
 * Runtime-only rewrites happen here:
 * - `auto` still defaults to `local/*`
 * - `local/*` upgrades to the first available cloud model when bootstrap exists
 * - explicit hosted-provider models (`openai/*`, `anthropic/*`, `google/*`)
 *   transparently route through `veryfront-cloud/*` when the runtime has
 *   request-scoped Veryfront bootstrap but no direct provider API key
 */
export function resolveRuntimeModel(model?: string): string {
  const configuredModel = resolveConfiguredAgentModel(model);

  if (configuredModel.startsWith("veryfront-cloud/")) {
    return configuredModel;
  }

  if (configuredModel.startsWith("local/")) {
    return findAvailableCloudModel() ?? configuredModel;
  }

  const slashIndex = configuredModel.indexOf("/");
  if (slashIndex === -1) {
    return configuredModel;
  }

  const provider = configuredModel.slice(0, slashIndex);
  const modelId = configuredModel.slice(slashIndex + 1);

  if (!HOSTED_PROVIDER_NAMES.has(provider) || !modelId) {
    return configuredModel;
  }

  if (!isVeryfrontCloudEnabled() || hasDirectProviderCredentials(provider)) {
    return configuredModel;
  }

  return `veryfront-cloud/${provider}/${modelId}`;
}
