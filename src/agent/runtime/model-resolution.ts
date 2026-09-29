import {
  getAnthropicEnvConfig,
  getGoogleGenAIEnvConfig,
  getMistralEnvConfig,
  getOpenAIEnvConfig,
} from "#veryfront/config/env.ts";
import {
  canVeryfrontCloudCatalogRefuse,
  createRetiredVeryfrontCloudModelError,
  isListedInServedVeryfrontCloudCatalog,
  isRetiredVeryfrontCloudModelId,
  isSupportedMistralModelId,
  isVeryfrontCloudCatalogLoaded,
  resolveServedVeryfrontCloudAlias,
  VERYFRONT_CLOUD_CATALOG_PROVIDER_NAMES,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { DEFAULT_MODEL_CREDENTIAL_MISMATCH, NOT_SUPPORTED } from "#veryfront/errors";
import {
  getDefaultVeryfrontCloudModel,
  isVeryfrontCloudEnabled,
} from "#veryfront/platform/cloud/resolver.ts";
import { getHostEnv } from "#veryfront/platform/compat/process/env.ts";
import type { ModelRuntime } from "#veryfront/provider/types.ts";
import { getModelRuntimeProvider } from "#veryfront/provider/runtime-inspection.ts";

export const AUTO_AGENT_MODEL = "auto";
export const DEFAULT_AGENT_MODEL = "openai/gpt-5-nano";

/**
 * Providers the gateway serves that the catalog snapshot shipped in this
 * package does not list yet. Each routes on the default surface, which the
 * gateway serves at the vendor-neutral `/ai/v1`. Drop an entry once
 * `deno task generate:model-catalog` adds its provider to the snapshot.
 */
const GATEWAY_PROVIDERS_AHEAD_OF_CATALOG = ["qwen"] as const;
const HOSTED_PROVIDER_NAMES: ReadonlySet<string> = new Set([
  ...VERYFRONT_CLOUD_CATALOG_PROVIDER_NAMES,
  ...GATEWAY_PROVIDERS_AHEAD_OF_CATALOG,
]);
const DIRECT_CREDENTIAL_PROVIDER_ALIASES = new Map<string, string>([
  ["google-ai-studio", "google"],
]);
const DIRECT_RUNTIME_PROVIDER_ALIASES = new Map<string, string>([
  ["google-ai-studio", "google"],
]);
// Called with the user's own provider key against the vendor's API, never the
// gateway, so these follow each vendor's own catalog rather than our
// gateway's retirement list (isRetiredVeryfrontCloudModelId is gateway-only
// and never runs on this path). mistral-large-2512 (Mistral Large 3) is
// Mistral's current flagship; mistral-small-2503 (Mistral Small 3.1) is not
// a safe substitute here even though our gateway still serves it under that
// name -- Mistral itself deprecated it 2025-11-06 and retired it 2025-11-30,
// so a direct call with the user's own key now 404s.
const DIRECT_AUTO_MODEL_DEFAULTS: Array<{ provider: string; modelId: string }> = [
  { provider: "openai", modelId: "gpt-5-nano" },
  { provider: "anthropic", modelId: "claude-sonnet-4-6" },
  { provider: "google-ai-studio", modelId: "gemini-3.5-flash" },
  { provider: "mistral", modelId: "mistral-large-2512" },
];
const LEGACY_MODEL_ALIASES = new Map<string, string>([
  ["opus", "anthropic/claude-opus-4-8"],
  ["sonnet", "anthropic/claude-sonnet-4-6"],
  ["haiku", "anthropic/claude-haiku-4-5-20251001"],
  ["claude-opus-4-8", "anthropic/claude-opus-4-8"],
  ["claude-opus-4-6", "anthropic/claude-opus-4-6"],
  ["claude-sonnet-4-6", "anthropic/claude-sonnet-4-6"],
  ["claude-haiku-4-5-20251001", "anthropic/claude-haiku-4-5-20251001"],
  ["gpt-5.5", "openai/gpt-5.5"],
  ["gpt-5.2", "openai/gpt-5.2"],
  ["gpt-5.4", "openai/gpt-5.4"],
  ["gpt-5.4-mini", "openai/gpt-5.4-mini"],
  ["gpt-5.4-nano", "openai/gpt-5.4-nano"],
  ["gpt-5-nano", "openai/gpt-5-nano"],
  ["deepseek-v4-flash", "deepseek/deepseek-v4-flash"],
  ["o3-pro", "openai/o3-pro"],
  ["o4-mini", "openai/o4-mini"],
  ["gemini-3.1-pro", "google-ai-studio/gemini-3.1-pro-preview"],
  ["gemini-3.1-pro-preview", "google-ai-studio/gemini-3.1-pro-preview"],
  ["gemini-3.5-flash", "google-ai-studio/gemini-3.5-flash"],
  ["gemini-3-flash-preview", "google-ai-studio/gemini-3-flash-preview"],
  ["gemini-3.1-flash-lite", "google-ai-studio/gemini-3.1-flash-lite"],
  ["gemini-2.5-pro", "google-ai-studio/gemini-2.5-pro"],
  ["gemini-2.5-flash", "google-ai-studio/gemini-2.5-flash"],
  ["mistral-large", "mistral/mistral-large-2512"],
  ["mistral-large-2512", "mistral/mistral-large-2512"],
  ["mistral-small-2503", "mistral/mistral-small-2503"],
  ["kimi-k2.6", "moonshotai/kimi-k2.6"],
  ["kimi-k2.5", "moonshotai/kimi-k2.5"],
]);

export function normalizeAgentModelConfig(model?: string): string {
  if (model === undefined) return DEFAULT_AGENT_MODEL;

  const normalized = model?.trim();
  return normalized && normalized.length > 0 ? normalized : AUTO_AGENT_MODEL;
}

export function resolveConfiguredAgentModel(model?: string): string {
  if (model === undefined && isVeryfrontCloudEnabled()) {
    return getDefaultVeryfrontCloudModel();
  }
  const normalized = normalizeAgentModelConfig(model);
  if (normalized === AUTO_AGENT_MODEL) {
    return getDefaultVeryfrontCloudModel();
  }

  if (normalized.includes("/")) {
    return normalized;
  }

  // Known aliases first, so a bare vendor name keeps its direct-key meaning;
  // then an alias only the loaded served catalog knows.
  return LEGACY_MODEL_ALIASES.get(normalized) ??
    resolveServedVeryfrontCloudAlias(normalized) ??
    normalized;
}

/** Resolve the provider-options key used by the effective model runtime. */
export function resolveModelProviderOptionKey(
  model?: string,
  runtime?: ModelRuntime,
): string | undefined {
  const runtimeProvider = runtime === undefined ? undefined : getModelRuntimeProvider(runtime);
  if (runtimeProvider) {
    return runtimeProvider;
  }
  const resolvedModel = resolveConfiguredAgentModel(model);
  const slashIndex = resolvedModel.indexOf("/");
  if (slashIndex <= 0) {
    return undefined;
  }
  return resolvedModel.slice(0, slashIndex) || undefined;
}

function hasDirectProviderCredentials(provider: string): boolean {
  switch (DIRECT_CREDENTIAL_PROVIDER_ALIASES.get(provider) ?? provider) {
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

/** Direct-credential providers that currently have a key, in stable order. */
function listAvailableDirectProviders(): string[] {
  return DIRECT_AUTO_MODEL_DEFAULTS
    .map(({ provider }) => provider)
    .filter((provider) => hasDirectProviderCredentials(provider));
}

function isSupportedHostedMistralModel(modelId: string): boolean {
  // A stale served catalog cannot refuse: the platform answers for the model.
  return !canVeryfrontCloudCatalogRefuse() || isSupportedMistralModelId(`mistral/${modelId}`);
}

function isUnsupportedVeryfrontCloudMistralModel(modelId: string): boolean {
  // An explicit Veryfront Cloud id is refused only against a served catalog:
  // the shipped list cannot know a model the platform added since, and the
  // model checks its own catalog once that has loaded.
  return modelId.startsWith("veryfront-cloud/mistral/") && isVeryfrontCloudCatalogLoaded() &&
    canVeryfrontCloudCatalogRefuse() && !isSupportedMistralModelId(modelId);
}

function normalizeVeryfrontCloudRuntimeModel(modelId: string): string {
  if (isUnsupportedVeryfrontCloudMistralModel(modelId)) {
    throw NOT_SUPPORTED.create({ detail: `Unsupported Mistral model "${modelId}"` });
  }
  if (isRetiredVeryfrontCloudModelId(modelId)) {
    throw createRetiredVeryfrontCloudModelError(modelId);
  }
  return modelId;
}

function toDirectRuntimeModel(provider: string, modelId: string): string {
  const runtimeProvider = DIRECT_RUNTIME_PROVIDER_ALIASES.get(provider) ?? provider;
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
  const configuredDefault = resolveDirectRuntimeModelForDefault(
    getHostEnv("VERYFRONT_DEFAULT_MODEL")?.trim() || DEFAULT_AGENT_MODEL,
  );
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
  if (
    (model === undefined && isVeryfrontCloudEnabled()) ||
    normalizeAgentModelConfig(model) === AUTO_AGENT_MODEL
  ) {
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

  // A provider this package names, or any model the loaded served catalog
  // lists (a provider the platform added since), is a Veryfront Cloud candidate.
  if (
    !modelId ||
    (!HOSTED_PROVIDER_NAMES.has(provider) &&
      !isListedInServedVeryfrontCloudCatalog(configuredModel))
  ) {
    return configuredModel;
  }

  if (provider === "mistral" && !isSupportedHostedMistralModel(modelId)) {
    return configuredModel;
  }

  if (!isVeryfrontCloudEnabled() || hasDirectProviderCredentials(provider)) {
    // The default model is a framework choice, not the user's. If its provider
    // has no key but another provider does, the user almost certainly meant
    // that other provider. Say so instead of failing later against the wrong
    // vendor. Resolution stays deterministic — never substitute silently, or
    // the same project resolves differently per machine.
    if (
      model === undefined && !isVeryfrontCloudEnabled() &&
      !hasDirectProviderCredentials(provider)
    ) {
      const available = listAvailableDirectProviders();
      if (available.length > 0) {
        throw DEFAULT_MODEL_CREDENTIAL_MISMATCH.create({
          detail: `Default model "${configuredModel}" needs a ${provider} credential. ` +
            `Found ${available.join(", ")} instead. ` +
            `Set model: "${available[0]}/<model>" or model: "auto".`,
        });
      }
    }
    return toDirectRuntimeModel(provider, modelId);
  }

  if (isRetiredVeryfrontCloudModelId(configuredModel)) {
    throw createRetiredVeryfrontCloudModelError(configuredModel);
  }

  return `veryfront-cloud/${provider}/${modelId}`;
}

/**
 * Whether the runtime routes `model` through Veryfront Cloud in the current
 * context. A model it cannot resolve counts as hosted, so a capability cap
 * derived from the answer fails closed.
 */
export function isVeryfrontCloudRuntimeModel(model?: string): boolean {
  try {
    return resolveRuntimeModel(model).startsWith("veryfront-cloud/");
  } catch {
    return true;
  }
}
