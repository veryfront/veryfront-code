import {
  getAnthropicEnvConfig,
  getGoogleGenAIEnvConfig,
  getOpenAIEnvConfig,
} from "#veryfront/config/env.ts";
import { findAvailableCloudModel } from "#veryfront/provider";
import { DEFAULT_LOCAL_MODEL } from "#veryfront/provider/local/model-catalog.ts";
import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";

export const AUTO_AGENT_MODEL = "auto";

const HOSTED_PROVIDER_NAMES = new Set([
  "anthropic",
  "google",
  "google-ai-studio",
  "moonshotai",
  "openai",
]);
const DIRECT_CREDENTIAL_PROVIDER_ALIASES: Record<string, string> = {
  "google-ai-studio": "google",
};
const DIRECT_RUNTIME_PROVIDER_ALIASES: Record<string, string> = {
  "google-ai-studio": "google",
};
const LEGACY_MODEL_ALIASES: Record<string, string> = {
  opus: "anthropic/claude-opus-4-8",
  sonnet: "anthropic/claude-sonnet-4-6",
  haiku: "anthropic/claude-haiku-4-5-20251001",
  "claude-opus-4-8": "anthropic/claude-opus-4-8",
  "claude-opus-4-6": "anthropic/claude-opus-4-6",
  "claude-sonnet-4-6": "anthropic/claude-sonnet-4-6",
  "claude-haiku-4-5-20251001": "anthropic/claude-haiku-4-5-20251001",
  "gpt-5.5": "openai/gpt-5.5",
  "gpt-5.2": "openai/gpt-5.2",
  "gpt-5.4": "openai/gpt-5.4",
  "gpt-5.4-mini": "openai/gpt-5.4-mini",
  "gpt-5.4-nano": "openai/gpt-5.4-nano",
  "o3-pro": "openai/o3-pro",
  "o4-mini": "openai/o4-mini",
  "gemini-3.1-pro": "google-ai-studio/gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview": "google-ai-studio/gemini-3.1-pro-preview",
  "gemini-3.5-flash": "google-ai-studio/gemini-3.5-flash",
  "gemini-3-flash-preview": "google-ai-studio/gemini-3-flash-preview",
  "gemini-3.1-flash-lite": "google-ai-studio/gemini-3.1-flash-lite",
  "gemini-2.5-pro": "google-ai-studio/gemini-2.5-pro",
  "gemini-2.5-flash": "google-ai-studio/gemini-2.5-flash",
  "kimi-k2.6": "moonshotai/kimi-k2.6",
  "kimi-k2.5": "moonshotai/kimi-k2.5",
};

export function normalizeAgentModelConfig(model?: string): string {
  const normalized = model?.trim();
  return normalized && normalized.length > 0 ? normalized : AUTO_AGENT_MODEL;
}

export function resolveConfiguredAgentModel(model?: string): string {
  const normalized = normalizeAgentModelConfig(model);
  if (normalized === AUTO_AGENT_MODEL) {
    return `local/${DEFAULT_LOCAL_MODEL}`;
  }

  if (normalized.includes("/")) {
    return normalized;
  }

  return LEGACY_MODEL_ALIASES[normalized] ?? normalized;
}

function hasDirectProviderCredentials(provider: string): boolean {
  switch (DIRECT_CREDENTIAL_PROVIDER_ALIASES[provider] ?? provider) {
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
    const runtimeProvider = DIRECT_RUNTIME_PROVIDER_ALIASES[provider] ?? provider;
    return `${runtimeProvider}/${modelId}`;
  }

  return `veryfront-cloud/${provider}/${modelId}`;
}
