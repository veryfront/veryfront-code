import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors";

/** Public API contract for Veryfront Cloud provider ID. */
export type VeryfrontCloudProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "mistral"
  | "moonshotai";

/** Configuration used by Veryfront Cloud model thinking. */
export type VeryfrontCloudModelThinkingConfig = {
  enabled: boolean;
  effort?: "low" | "medium" | "high" | "max";
  budgetTokens?: number;
};

/** Public API contract for Veryfront Cloud chat model. */
export type VeryfrontCloudChatModel = {
  id: string;
  modelId: string;
  provider: VeryfrontCloudProviderId;
  name: string;
  description: string;
  thinking?: boolean;
  thinkingBudgetTokens?: number;
};

/**
 * Default Veryfront Cloud model ID used when no model is configured.
 * Update this when the current default is deprecated — otherwise the default
 * path silently breaks for users who have not set an explicit model.
 */
export const DEFAULT_VERYFRONT_CLOUD_MODEL_ID = "gpt-5.4-nano";
/** Shared Veryfront Cloud model prefix value. */
export const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";

const VERYFRONT_CLOUD_GATEWAY_MODEL_PROVIDER_PREFIXES = [
  "anthropic/",
  "openai/",
  "google/",
  "google-ai-studio/",
  "mistral/",
  "moonshotai/",
];
/**
 * Anthropic models that use the adaptive thinking API (type: "adaptive").
 * New Opus/Sonnet versions supporting adaptive thinking must be added here,
 * otherwise they fall back to the standard budget-token thinking path.
 */
const ANTHROPIC_ADAPTIVE_THINKING_ONLY_MODELS = new Set([
  "anthropic/claude-opus-4-7",
  "anthropic/claude-opus-4-8",
]);

/** Returns true if the given model ID is a Mistral model in the catalog. */
export function isSupportedMistralModelId(modelId: string): boolean {
  return VERYFRONT_CLOUD_CHAT_MODELS.some(
    (model) => model.provider === "mistral" && model.modelId === modelId,
  );
}

/** Shared Veryfront Cloud chat models value. */
export const VERYFRONT_CLOUD_CHAT_MODELS: VeryfrontCloudChatModel[] = [
  {
    id: "opus",
    modelId: "anthropic/claude-opus-4-8",
    provider: "anthropic",
    name: "Claude Opus 4.8",
    description: "Most capable for ambitious work",
    thinkingBudgetTokens: 2048,
  },
  {
    id: "claude-opus-4-6",
    modelId: "anthropic/claude-opus-4-6",
    provider: "anthropic",
    name: "Claude Opus 4.6",
    description: "Previous Opus generation for compatibility-sensitive agents",
    thinkingBudgetTokens: 2048,
  },
  {
    id: "sonnet",
    modelId: "anthropic/claude-sonnet-4-6",
    provider: "anthropic",
    name: "Claude Sonnet 4.6",
    description: "Most efficient for everyday tasks",
    thinkingBudgetTokens: 2048,
  },
  {
    id: "haiku",
    modelId: "anthropic/claude-haiku-4-5-20251001",
    provider: "anthropic",
    name: "Claude Haiku 4.5",
    description: "Fastest for quick answers",
    thinkingBudgetTokens: 1024,
  },
  {
    id: "gpt-5.5",
    modelId: "openai/gpt-5.5",
    provider: "openai",
    name: "GPT-5.5",
    description: "Most capable OpenAI model",
    thinking: true,
  },
  {
    id: "gpt-5.4-mini",
    modelId: "openai/gpt-5.4-mini",
    provider: "openai",
    name: "GPT-5.4 Mini",
    description: "Fast OpenAI model for cost-efficient everyday work",
    thinking: true,
  },
  {
    id: "gpt-5.4",
    modelId: "openai/gpt-5.4",
    provider: "openai",
    name: "GPT-5.4",
    description: "Production-proven OpenAI frontier model",
    thinking: true,
  },
  {
    id: "gpt-5.4-nano",
    modelId: "openai/gpt-5.4-nano",
    provider: "openai",
    name: "GPT-5.4 Nano",
    description: "Lowest-cost OpenAI model for lightweight work",
    thinking: true,
  },
  {
    id: "gpt-5.2",
    modelId: "openai/gpt-5.2",
    provider: "openai",
    name: "GPT-5.2",
    description: "Previous OpenAI frontier generation",
    thinking: true,
  },
  {
    id: "gemini-3.1-pro-preview",
    modelId: "google-ai-studio/gemini-3.1-pro-preview",
    provider: "google",
    name: "Gemini 3.1 Pro Preview",
    description: "Advanced reasoning and analysis",
    thinking: true,
  },
  {
    id: "gemini-3.5-flash",
    modelId: "google-ai-studio/gemini-3.5-flash",
    provider: "google",
    name: "Gemini 3.5 Flash",
    description: "Fast and cost-efficient",
  },
  {
    id: "gemini-2.5-pro",
    modelId: "google-ai-studio/gemini-2.5-pro",
    provider: "google",
    name: "Gemini 2.5 Pro",
    description: "Previous Google Pro model",
    thinking: true,
  },
  {
    id: "gemini-2.5-flash",
    modelId: "google-ai-studio/gemini-2.5-flash",
    provider: "google",
    name: "Gemini 2.5 Flash",
    description: "Previous Google Flash model",
  },
  {
    id: "mistral-large-2512",
    modelId: "mistral/mistral-large-2512",
    provider: "mistral",
    name: "Mistral Large 3",
    description: "Most capable Mistral model",
  },
  {
    id: "kimi-k2.6",
    modelId: "moonshotai/kimi-k2.6",
    provider: "moonshotai",
    name: "Kimi K2.6",
    description: "Deep thinking and multimodal",
    thinking: true,
  },
  {
    id: "kimi-k2.5",
    modelId: "moonshotai/kimi-k2.5",
    provider: "moonshotai",
    name: "Kimi K2.5",
    description: "Previous Kimi generation",
    thinking: true,
  },
];

/** Find Veryfront Cloud model. */
export function findVeryfrontCloudModel(id: string): VeryfrontCloudChatModel | undefined {
  return VERYFRONT_CLOUD_CHAT_MODELS.find((model) => model.id === id);
}

/** Normalizes Veryfront Cloud model ID. */
export function normalizeVeryfrontCloudModelId(modelId: string): string {
  return modelId.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX)
    ? modelId.slice(VERYFRONT_CLOUD_MODEL_PREFIX.length)
    : modelId;
}

/** Find Veryfront Cloud model by model ID. */
export function findVeryfrontCloudModelByModelId(
  modelId: string,
): VeryfrontCloudChatModel | undefined {
  const normalizedModelId = normalizeVeryfrontCloudModelId(modelId);
  return VERYFRONT_CLOUD_CHAT_MODELS.find((model) => model.modelId === normalizedModelId);
}

/** Return Veryfront Cloud provider from model ID. */
export function getVeryfrontCloudProviderFromModelId(
  modelId: string,
): VeryfrontCloudProviderId {
  const normalizedModelId = normalizeVeryfrontCloudModelId(modelId);
  const prefix = normalizedModelId.split("/")[0];

  switch (prefix) {
    case "google-ai-studio":
      return "google";
    case "openai":
    case "anthropic":
    case "mistral":
    case "moonshotai":
      return prefix;
  }

  throw INVALID_ARGUMENT.create({ detail: `Unknown model provider prefix "${prefix}" in model ID "${modelId}"` });
}

/** Try to get Veryfront Cloud provider from model ID. */
export function tryGetVeryfrontCloudProviderFromModelId(
  modelId: string,
): VeryfrontCloudProviderId | undefined {
  try {
    return getVeryfrontCloudProviderFromModelId(modelId);
  } catch {
    return undefined;
  }
}

/** Resolves Veryfront Cloud model ID. */
export function resolveVeryfrontCloudModelId(alias?: string): string {
  const requestedModel = alias || DEFAULT_VERYFRONT_CLOUD_MODEL_ID;
  const catalogModel = VERYFRONT_CLOUD_CHAT_MODELS.find((model) =>
    model.modelId === requestedModel
  );
  if (catalogModel) {
    return catalogModel.modelId;
  }

  if (requestedModel.includes("/")) {
    // Mistral models are gated by the catalog whitelist; reject ids we don't
    // list so callers get a clear error rather than a gateway-side failure.
    if (requestedModel.startsWith("mistral/") && !isSupportedMistralModelId(requestedModel)) {
      throw NOT_SUPPORTED.create({ detail: `Unsupported Mistral model "${requestedModel}"` });
    }
    return requestedModel;
  }

  const model = findVeryfrontCloudModel(requestedModel);
  if (!model) {
    throw INVALID_ARGUMENT.create({ detail: `Unknown model alias "${requestedModel}"` });
  }
  return model.modelId;
}

/** Resolves Veryfront Cloud gateway model ID. */
export function resolveVeryfrontCloudGatewayModelId(
  modelId: string | undefined,
): string | undefined {
  if (!modelId) {
    return modelId;
  }

  if (modelId.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX)) {
    // Already prefixed for the gateway — pass through as-is.
    return modelId;
  }

  // Unsupported Mistral ids are passed through unprefixed (not routed through
  // the Veryfront Cloud gateway prefix).
  if (modelId.startsWith("mistral/") && !isSupportedMistralModelId(modelId)) {
    return modelId;
  }

  return VERYFRONT_CLOUD_GATEWAY_MODEL_PROVIDER_PREFIXES.some((prefix) =>
      modelId.startsWith(prefix)
    )
    ? `${VERYFRONT_CLOUD_MODEL_PREFIX}${modelId}`
    : modelId;
}

/** Resolves Veryfront Cloud model thinking. */
export function resolveVeryfrontCloudModelThinking(
  modelId: string | undefined,
): VeryfrontCloudModelThinkingConfig | undefined {
  if (!modelId) {
    return undefined;
  }

  const model = findVeryfrontCloudModelByModelId(modelId) ?? findVeryfrontCloudModel(modelId);
  const budgetTokens = typeof model?.thinkingBudgetTokens === "number" &&
      model.thinkingBudgetTokens > 0
    ? model.thinkingBudgetTokens
    : undefined;
  if (model?.thinking !== true && budgetTokens === undefined) {
    return undefined;
  }

  return {
    enabled: true,
    ...(budgetTokens !== undefined ? { budgetTokens } : {}),
  };
}

/** Resolves provider-neutral runtime reasoning for a Veryfront Cloud model. */
export function resolveVeryfrontCloudReasoningOption(
  modelId: string,
  thinking: VeryfrontCloudModelThinkingConfig | undefined,
): VeryfrontCloudModelThinkingConfig | undefined {
  if (!tryGetVeryfrontCloudProviderFromModelId(modelId)) {
    return undefined;
  }

  if (!thinking) {
    return undefined;
  }

  if (thinking.enabled === false) {
    return { enabled: false };
  }

  if (thinking.enabled !== true) {
    return undefined;
  }

  return {
    enabled: true,
    ...(thinking.effort ? { effort: thinking.effort } : {}),
    ...(typeof thinking.budgetTokens === "number" && thinking.budgetTokens > 0
      ? { budgetTokens: Math.floor(thinking.budgetTokens) }
      : {}),
  };
}

/** Options accepted by resolve Veryfront Cloud thinking provider. */
export function resolveVeryfrontCloudThinkingProviderOptions(
  modelId: string,
  thinking: VeryfrontCloudModelThinkingConfig | undefined,
): Record<string, unknown> | undefined {
  if (!thinking?.enabled) {
    return undefined;
  }

  const provider = getVeryfrontCloudProviderFromModelId(modelId);
  if (provider !== "anthropic") {
    return undefined;
  }

  const normalizedModelId = normalizeVeryfrontCloudModelId(modelId);
  if (ANTHROPIC_ADAPTIVE_THINKING_ONLY_MODELS.has(normalizedModelId)) {
    return {
      anthropic: {
        thinking: {
          type: "adaptive",
          display: "summarized",
        },
        output_config: {
          effort: "high",
        },
      },
    };
  }

  if (typeof thinking.budgetTokens !== "number" || thinking.budgetTokens <= 0) {
    return undefined;
  }

  return {
    anthropic: {
      temperature: 1,
      thinking: {
        type: "enabled",
        budget_tokens: Math.floor(thinking.budgetTokens),
      },
    },
  };
}

const PROVIDER_LABELS: Record<VeryfrontCloudProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  moonshotai: "Kimi",
  mistral: "Mistral",
};

const PROVIDER_ORDER: VeryfrontCloudProviderId[] = [
  "anthropic",
  "openai",
  "google",
  "mistral",
  "moonshotai",
];

/** Group Veryfront Cloud models by provider. */
export function groupVeryfrontCloudModelsByProvider(): Array<{
  provider: VeryfrontCloudProviderId;
  label: string;
  models: VeryfrontCloudChatModel[];
}> {
  return PROVIDER_ORDER.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    models: VERYFRONT_CLOUD_CHAT_MODELS.filter((model) => model.provider === provider),
  })).filter((group) => group.models.length > 0);
}

/** Resolves hosted Veryfront Cloud model ID. */
export const resolveHostedVeryfrontCloudModelId = resolveVeryfrontCloudGatewayModelId;
