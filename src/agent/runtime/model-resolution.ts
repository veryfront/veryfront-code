import {
  getAnthropicEnvConfig,
  getGoogleGenAIEnvConfig,
  getMistralEnvConfig,
  getOpenAIEnvConfig,
} from "#veryfront/config/env.ts";
import {
  DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID,
  findVeryfrontCloudModelByModelId,
  VERYFRONT_CLOUD_CHAT_MODELS,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { NOT_SUPPORTED } from "#veryfront/errors";
import {
  getDefaultVeryfrontCloudModel,
  isVeryfrontCloudEnabled,
} from "#veryfront/platform/cloud/resolver.ts";

export const AUTO_AGENT_MODEL = "auto";
export const DEFAULT_AGENT_MODEL = DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID;

const HOSTED_PROVIDER_NAMES = new Set([
  "anthropic",
  "google",
  "google-ai-studio",
  "mistral",
  "moonshotai",
  "openai",
]);
const DIRECT_CREDENTIAL_PROVIDER_ALIASES: Record<string, string> = {
  "google-ai-studio": "google",
};
const DIRECT_RUNTIME_PROVIDER_ALIASES: Record<string, string> = {
  "google-ai-studio": "google",
};
const defaultDirectModelSeparator = DEFAULT_AGENT_MODEL.indexOf("/");
if (defaultDirectModelSeparator <= 0) {
  throw new Error(`Default agent model "${DEFAULT_AGENT_MODEL}" must use provider/model format`);
}
const DIRECT_AUTO_MODEL_DEFAULTS: Array<{ provider: string; modelId: string }> = [
  {
    provider: DEFAULT_AGENT_MODEL.slice(0, defaultDirectModelSeparator),
    modelId: DEFAULT_AGENT_MODEL.slice(defaultDirectModelSeparator + 1),
  },
  { provider: "anthropic", modelId: "claude-sonnet-4-6" },
  { provider: "google-ai-studio", modelId: "gemini-3.5-flash" },
  { provider: "mistral", modelId: "mistral-large-2512" },
];
const LEGACY_MODEL_ALIASES = new Map<string, string>([
  ...VERYFRONT_CLOUD_CHAT_MODELS.map((model) => [model.id, model.modelId] as const),
  ["claude-opus-4-8", "anthropic/claude-opus-4-8"],
  ["claude-sonnet-4-6", "anthropic/claude-sonnet-4-6"],
  ["claude-haiku-4-5-20251001", "anthropic/claude-haiku-4-5-20251001"],
  ["o3-pro", "openai/o3-pro"],
  ["o4-mini", "openai/o4-mini"],
  ["gemini-3.1-pro", "google-ai-studio/gemini-3.1-pro-preview"],
  ["gemini-3-flash-preview", "google-ai-studio/gemini-3-flash-preview"],
  ["gemini-3.1-flash-lite", "google-ai-studio/gemini-3.1-flash-lite"],
  ["mistral-large", "mistral/mistral-large-2512"],
]);

export function normalizeAgentModelConfig(model?: string): string {
  if (model === undefined) return DEFAULT_AGENT_MODEL;

  const normalized = model?.trim();
  return normalized && normalized.length > 0 ? normalized : AUTO_AGENT_MODEL;
}

export function resolveConfiguredAgentModel(model?: string): string {
  const normalized = normalizeAgentModelConfig(model);
  if (normalized === AUTO_AGENT_MODEL) {
    return getDefaultVeryfrontCloudModel();
  }

  if (normalized.includes("/")) {
    return normalized;
  }

  return LEGACY_MODEL_ALIASES.get(normalized) ?? normalized;
}

function hasDirectProviderCredentials(provider: string): boolean {
  switch (DIRECT_CREDENTIAL_PROVIDER_ALIASES[provider] ?? provider) {
    case "anthropic":
      return Boolean(getAnthropicEnvConfig().apiKey);
    case "google":
      return Boolean(getGoogleGenAIEnvConfig().apiKey);
    case "mistral":
      return Boolean(getMistralEnvConfig().apiKey);
    case "openai":
      return Boolean(getOpenAIEnvConfig().apiKey);
    default:
      return false;
  }
}

function isSupportedHostedMistralModel(modelId: string): boolean {
  return Boolean(findVeryfrontCloudModelByModelId(`mistral/${modelId}`));
}

function isUnsupportedVeryfrontCloudMistralModel(modelId: string): boolean {
  return modelId.startsWith("veryfront-cloud/mistral/") &&
    !findVeryfrontCloudModelByModelId(modelId);
}

function normalizeVeryfrontCloudRuntimeModel(modelId: string): string {
  if (isUnsupportedVeryfrontCloudMistralModel(modelId)) {
    throw NOT_SUPPORTED.create({ detail: `Unsupported Mistral model "${modelId}"` });
  }
  return modelId;
}

function toDirectRuntimeModel(provider: string, modelId: string): string {
  const runtimeProvider = DIRECT_RUNTIME_PROVIDER_ALIASES[provider] ?? provider;
  return `${runtimeProvider}/${modelId}`;
}

function resolveDirectRuntimeModelForDefault(modelId: string): string | undefined {
  const normalized = modelId.startsWith("veryfront-cloud/")
    ? modelId.slice("veryfront-cloud/".length)
    : modelId;
  const slashIndex = normalized.indexOf("/");
  if (slashIndex === -1) return undefined;

  const provider = normalized.slice(0, slashIndex);
  const providerModelId = normalized.slice(slashIndex + 1);
  if (!provider || !providerModelId || !hasDirectProviderCredentials(provider)) {
    return undefined;
  }

  return toDirectRuntimeModel(provider, providerModelId);
}

function resolveDirectAutoRuntimeModel(): string | undefined {
  const configuredDefault = resolveDirectRuntimeModelForDefault(getDefaultVeryfrontCloudModel());
  if (configuredDefault) {
    return configuredDefault;
  }

  for (const { provider, modelId } of DIRECT_AUTO_MODEL_DEFAULTS) {
    if (hasDirectProviderCredentials(provider)) {
      return toDirectRuntimeModel(provider, modelId);
    }
  }

  return undefined;
}

function resolveAutoRuntimeModel(): string {
  const cloudModel = getDefaultVeryfrontCloudModel();

  if (isVeryfrontCloudEnabled()) {
    return normalizeVeryfrontCloudRuntimeModel(cloudModel);
  }

  return resolveDirectAutoRuntimeModel() ?? normalizeVeryfrontCloudRuntimeModel(cloudModel);
}

/**
 * Resolve the effective runtime model string for agent execution.
 *
 * Runtime-only rewrites happen here:
 * - `auto` uses Veryfront Cloud when bootstrap is available, otherwise a
 *   configured direct provider key when one exists
 * - explicit hosted-provider models (`openai/*`, `anthropic/*`, `google/*`)
 *   transparently route through `veryfront-cloud/*` when the runtime has
 *   request-scoped Veryfront bootstrap but no direct provider API key
 */
export function resolveRuntimeModel(model?: string): string {
  if (normalizeAgentModelConfig(model) === AUTO_AGENT_MODEL) {
    return resolveAutoRuntimeModel();
  }

  const configuredModel = resolveConfiguredAgentModel(model);

  if (configuredModel.startsWith("veryfront-cloud/")) {
    return normalizeVeryfrontCloudRuntimeModel(configuredModel);
  }

  if (configuredModel.startsWith("local/")) {
    return configuredModel;
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

  if (provider === "mistral" && !isSupportedHostedMistralModel(modelId)) {
    return configuredModel;
  }

  if (!isVeryfrontCloudEnabled() || hasDirectProviderCredentials(provider)) {
    return toDirectRuntimeModel(provider, modelId);
  }

  return `veryfront-cloud/${provider}/${modelId}`;
}
