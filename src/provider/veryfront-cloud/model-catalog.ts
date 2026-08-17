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
  readonly id: string;
  readonly modelId: string;
  readonly provider: VeryfrontCloudProviderId;
  readonly name: string;
  readonly description: string;
  readonly thinking?: boolean;
  readonly thinkingBudgetTokens?: number;
};

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function requireThinkingBudgetTokens(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!isPositiveSafeInteger(value)) {
    throw INVALID_ARGUMENT.create({
      detail: "Veryfront Cloud thinking budgetTokens must be a positive safe integer",
    });
  }
  return value;
}

/**
 * Default Veryfront Cloud model ID used when no model is configured.
 * Update this when the current default is deprecated — otherwise the default
 * path silently breaks for users who have not set an explicit model.
 */
export const DEFAULT_VERYFRONT_CLOUD_MODEL_ID = "gpt-5.4-nano";
/** Shared Veryfront Cloud model prefix value. */
export const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";

const VERYFRONT_CLOUD_PROVIDER_ALIASES = new Map<string, VeryfrontCloudProviderId>([
  ["anthropic", "anthropic"],
  ["openai", "openai"],
  ["google", "google"],
  ["google-ai-studio", "google"],
  ["mistral", "mistral"],
  ["moonshotai", "moonshotai"],
]);

const VERYFRONT_CLOUD_GATEWAY_MODEL_PROVIDER_PREFIXES = Object.freeze(
  Array.from(VERYFRONT_CLOUD_PROVIDER_ALIASES.keys(), (provider) => `${provider}/`),
);

/** Resolve a supported gateway provider alias without consulting object prototypes. */
export function normalizeVeryfrontCloudProviderAlias(
  provider: string,
): VeryfrontCloudProviderId | undefined {
  return VERYFRONT_CLOUD_PROVIDER_ALIASES.get(provider);
}

type VeryfrontCloudModelTransportCapabilities = {
  readonly anthropicThinkingMode?: "adaptive";
  readonly openAITransport?: "chat-completions" | "responses";
  readonly openAIChatReasoningWithFunctionTools?: boolean;
};

/**
 * Model-specific transport capabilities that cannot be inferred from the
 * provider family. Both provider-specific and provider-neutral option
 * resolution must consult this catalog so the two representations cannot
 * contradict each other.
 */
const VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES = new Map<
  string,
  Readonly<VeryfrontCloudModelTransportCapabilities>
>([
  ["anthropic/claude-opus-4-7", Object.freeze({ anthropicThinkingMode: "adaptive" })],
  ["anthropic/claude-opus-4-8", Object.freeze({ anthropicThinkingMode: "adaptive" })],
  [
    "openai/gpt-5.4",
    Object.freeze({
      openAITransport: "chat-completions",
      openAIChatReasoningWithFunctionTools: false,
    }),
  ],
  [
    "openai/gpt-5.5",
    Object.freeze({
      openAITransport: "chat-completions",
      openAIChatReasoningWithFunctionTools: false,
    }),
  ],
]);

function getVeryfrontCloudModelTransportCapabilities(
  modelId: string,
): Readonly<VeryfrontCloudModelTransportCapabilities> | undefined {
  return VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES.get(
    normalizeVeryfrontCloudModelId(modelId),
  );
}

/** Resolves a model-specific OpenAI transport override for Veryfront Cloud. */
export function resolveVeryfrontCloudOpenAITransport(
  modelId: string,
): "chat-completions" | "responses" | undefined {
  return getVeryfrontCloudModelTransportCapabilities(modelId)?.openAITransport;
}

/** Resolves whether a model's Chat transport can combine reasoning with function tools. */
export function resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(
  modelId: string,
): boolean | undefined {
  return getVeryfrontCloudModelTransportCapabilities(modelId)
    ?.openAIChatReasoningWithFunctionTools;
}

/** Returns true if the given model ID is a Mistral model in the catalog. */
export function isSupportedMistralModelId(modelId: string): boolean {
  return VERYFRONT_CLOUD_CHAT_MODELS.some(
    (model) => model.provider === "mistral" && model.modelId === modelId,
  );
}

const veryfrontCloudChatModels: VeryfrontCloudChatModel[] = [
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

/** Shared Veryfront Cloud chat models value. */
export const VERYFRONT_CLOUD_CHAT_MODELS: readonly VeryfrontCloudChatModel[] = Object.freeze(
  veryfrontCloudChatModels.map((model) => {
    if (
      model.thinkingBudgetTokens !== undefined &&
      !isPositiveSafeInteger(model.thinkingBudgetTokens)
    ) {
      throw new TypeError(
        `Veryfront Cloud model "${model.id}" thinkingBudgetTokens must be a positive safe integer`,
      );
    }
    return Object.freeze(model);
  }),
);

const defaultVeryfrontCloudChatModel = VERYFRONT_CLOUD_CHAT_MODELS.find(
  (model) => model.id === DEFAULT_VERYFRONT_CLOUD_MODEL_ID,
);
if (!defaultVeryfrontCloudChatModel) {
  throw new Error(
    `Veryfront Cloud default model "${DEFAULT_VERYFRONT_CLOUD_MODEL_ID}" is missing from the catalog`,
  );
}

/** Catalog-backed default model descriptor. */
export const DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL = defaultVeryfrontCloudChatModel;
/** Canonical direct provider/model ID for the default chat model. */
export const DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID = DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL.modelId;
/** Canonical hosted runtime ID for the default chat model. */
export const DEFAULT_VERYFRONT_CLOUD_RUNTIME_MODEL_ID =
  `${VERYFRONT_CLOUD_MODEL_PREFIX}${DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID}`;

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
  const prefix = normalizedModelId.split("/", 1)[0] ?? "";
  const provider = normalizeVeryfrontCloudProviderAlias(prefix);
  if (provider) return provider;

  throw INVALID_ARGUMENT.create({
    detail: `Unknown model provider prefix "${prefix}" in model ID "${modelId}"`,
  });
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
  const budgetTokens = requireThinkingBudgetTokens(model?.thinkingBudgetTokens);
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

  const budgetTokens = requireThinkingBudgetTokens(thinking.budgetTokens);
  const capabilities = getVeryfrontCloudModelTransportCapabilities(modelId);
  if (capabilities?.anthropicThinkingMode === "adaptive") {
    return undefined;
  }

  return {
    enabled: true,
    ...(thinking.effort ? { effort: thinking.effort } : {}),
    ...(budgetTokens !== undefined ? { budgetTokens } : {}),
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

  const capabilities = getVeryfrontCloudModelTransportCapabilities(modelId);
  if (capabilities?.anthropicThinkingMode === "adaptive") {
    requireThinkingBudgetTokens(thinking.budgetTokens);
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

  const budgetTokens = requireThinkingBudgetTokens(thinking.budgetTokens);
  if (budgetTokens === undefined) return undefined;

  return {
    anthropic: {
      temperature: 1,
      thinking: {
        type: "enabled",
        budget_tokens: budgetTokens,
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
  readonly provider: VeryfrontCloudProviderId;
  readonly label: string;
  readonly models: readonly VeryfrontCloudChatModel[];
}> {
  return PROVIDER_ORDER.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    models: Object.freeze(
      VERYFRONT_CLOUD_CHAT_MODELS.filter((model) => model.provider === provider),
    ),
  })).filter((group) => group.models.length > 0);
}

/** Resolves hosted Veryfront Cloud model ID. */
export const resolveHostedVeryfrontCloudModelId = resolveVeryfrontCloudGatewayModelId;
