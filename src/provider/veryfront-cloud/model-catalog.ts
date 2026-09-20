import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors";
import {
  DEFAULT_VERYFRONT_CLOUD_MODEL_ID as CATALOG_DEFAULT_MODEL_ID,
  VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES,
  VERYFRONT_CLOUD_GATEWAY_MODEL_PROVIDER_PREFIXES,
  VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES,
  VERYFRONT_CLOUD_PROVIDER_ALIASES,
  VERYFRONT_CLOUD_PROVIDER_LABELS as PROVIDER_LABELS,
  VERYFRONT_CLOUD_PROVIDER_ORDER as PROVIDER_ORDER,
  type VeryfrontCloudModelTransportCapabilities,
} from "./model-catalog.data.ts";

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
export const DEFAULT_VERYFRONT_CLOUD_MODEL_ID = CATALOG_DEFAULT_MODEL_ID;
/** Shared Veryfront Cloud model prefix value. */
export const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";

/** Private runtime Map for alias lookups, built from the frozen data entries. */
const _providerAliasMap = new Map(VERYFRONT_CLOUD_PROVIDER_ALIASES);
/** Private runtime Map for transport-capability lookups, built from the frozen data entries. */
const _transportCapabilitiesMap = new Map(VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES);

/** Resolve a supported gateway provider alias without consulting object prototypes. */
export function normalizeVeryfrontCloudProviderAlias(
  provider: string,
): VeryfrontCloudProviderId | undefined {
  return _providerAliasMap.get(provider);
}

function getVeryfrontCloudModelTransportCapabilities(
  modelId: string,
): Readonly<VeryfrontCloudModelTransportCapabilities> | undefined {
  return _transportCapabilitiesMap.get(
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

/** Shared Veryfront Cloud chat models value. */
export const VERYFRONT_CLOUD_CHAT_MODELS: readonly VeryfrontCloudChatModel[] = Object.freeze(
  VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES.map((model) => {
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
