import type { VeryfrontCloudProviderId } from "./shared.ts";

export type VeryfrontCloudModelThinkingConfig = {
  enabled: boolean;
  budgetTokens?: number;
};

export type VeryfrontCloudChatModel = {
  id: string;
  modelId: string;
  provider: VeryfrontCloudProviderId;
  name: string;
  description: string;
  thinkingBudgetTokens?: number;
};

export const DEFAULT_VERYFRONT_CLOUD_MODEL_ID = "opus";
export const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";

const VERYFRONT_CLOUD_GATEWAY_MODEL_PROVIDER_PREFIXES = [
  "anthropic/",
  "openai/",
  "google/",
  "google-ai-studio/",
  "moonshotai/",
];

export const VERYFRONT_CLOUD_CHAT_MODELS: VeryfrontCloudChatModel[] = [
  {
    id: "opus",
    modelId: "anthropic/claude-opus-4-6",
    provider: "anthropic",
    name: "Claude Opus 4.6",
    description: "Most capable for ambitious work",
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
    id: "gpt-5.2",
    modelId: "openai/gpt-5.2",
    provider: "openai",
    name: "GPT-5.2",
    description: "Most capable OpenAI model",
  },
  {
    id: "gemini-2.5-pro",
    modelId: "google-ai-studio/gemini-2.5-pro",
    provider: "google",
    name: "Gemini 2.5 Pro",
    description: "Advanced reasoning and analysis",
  },
  {
    id: "gemini-2.5-flash",
    modelId: "google-ai-studio/gemini-2.5-flash",
    provider: "google",
    name: "Gemini 2.5 Flash",
    description: "Fast and cost-efficient",
  },
  {
    id: "kimi-k2.5",
    modelId: "moonshotai/kimi-k2.5",
    provider: "moonshotai",
    name: "Kimi K2.5",
    description: "Deep thinking and multimodal",
  },
];

export function findVeryfrontCloudModel(id: string): VeryfrontCloudChatModel | undefined {
  return VERYFRONT_CLOUD_CHAT_MODELS.find((model) => model.id === id);
}

export function normalizeVeryfrontCloudModelId(modelId: string): string {
  return modelId.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX)
    ? modelId.slice(VERYFRONT_CLOUD_MODEL_PREFIX.length)
    : modelId;
}

export function findVeryfrontCloudModelByModelId(
  modelId: string,
): VeryfrontCloudChatModel | undefined {
  const normalizedModelId = normalizeVeryfrontCloudModelId(modelId);
  return VERYFRONT_CLOUD_CHAT_MODELS.find((model) => model.modelId === normalizedModelId);
}

export function getVeryfrontCloudProviderFromModelId(
  modelId: string,
): VeryfrontCloudProviderId {
  const normalizedModelId = normalizeVeryfrontCloudModelId(modelId);
  const prefix = normalizedModelId.split("/")[0];
  if (prefix === "google-ai-studio") return "google";
  if (prefix === "openai" || prefix === "anthropic" || prefix === "moonshotai") return prefix;

  throw new Error(`Unknown model provider prefix "${prefix}" in model ID "${modelId}"`);
}

export function tryGetVeryfrontCloudProviderFromModelId(
  modelId: string,
): VeryfrontCloudProviderId | undefined {
  try {
    return getVeryfrontCloudProviderFromModelId(modelId);
  } catch {
    return undefined;
  }
}

export function resolveVeryfrontCloudModelId(alias?: string): string {
  const requestedModel = alias || DEFAULT_VERYFRONT_CLOUD_MODEL_ID;
  const catalogModel = VERYFRONT_CLOUD_CHAT_MODELS.find((model) =>
    model.modelId === requestedModel
  );
  if (catalogModel) {
    return catalogModel.modelId;
  }

  if (requestedModel.includes("/")) {
    return requestedModel;
  }

  const model = findVeryfrontCloudModel(requestedModel);
  if (!model) {
    throw new Error(`Unknown model alias "${requestedModel}"`);
  }
  return model.modelId;
}

export function resolveVeryfrontCloudGatewayModelId(
  modelId: string | undefined,
): string | undefined {
  if (!modelId) {
    return modelId;
  }

  if (modelId.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX)) {
    return modelId;
  }

  return VERYFRONT_CLOUD_GATEWAY_MODEL_PROVIDER_PREFIXES.some((prefix) =>
      modelId.startsWith(prefix)
    )
    ? `${VERYFRONT_CLOUD_MODEL_PREFIX}${modelId}`
    : modelId;
}

export function resolveVeryfrontCloudModelThinking(
  modelId: string | undefined,
): VeryfrontCloudModelThinkingConfig | undefined {
  if (!modelId) {
    return undefined;
  }

  const model = findVeryfrontCloudModelByModelId(modelId) ?? findVeryfrontCloudModel(modelId);
  if (typeof model?.thinkingBudgetTokens !== "number" || model.thinkingBudgetTokens <= 0) {
    return undefined;
  }

  return {
    enabled: true,
    budgetTokens: model.thinkingBudgetTokens,
  };
}

export function resolveVeryfrontCloudThinkingProviderOptions(
  modelId: string,
  thinking: VeryfrontCloudModelThinkingConfig | undefined,
): Record<string, unknown> | undefined {
  if (
    !thinking?.enabled || typeof thinking.budgetTokens !== "number" || thinking.budgetTokens <= 0
  ) {
    return undefined;
  }

  const provider = getVeryfrontCloudProviderFromModelId(modelId);
  if (provider !== "anthropic") {
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
};

const PROVIDER_ORDER: VeryfrontCloudProviderId[] = ["anthropic", "openai", "google", "moonshotai"];

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

export const resolveHostedVeryfrontCloudModelId = resolveVeryfrontCloudGatewayModelId;
