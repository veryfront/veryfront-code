import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors";
import { isOpenAIReasoningModel } from "../shared/openai-reasoning.ts";
import {
  DEFAULT_VERYFRONT_CLOUD_GATEWAY_API_VERSION,
  DEFAULT_VERYFRONT_CLOUD_MODEL_ID as CATALOG_DEFAULT_MODEL_ID,
  DEFAULT_VERYFRONT_CLOUD_SURFACE,
  VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES,
  VERYFRONT_CLOUD_GATEWAY_PATH_PREFIX,
  VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES,
  VERYFRONT_CLOUD_PROVIDER_ALIASES,
  VERYFRONT_CLOUD_PROVIDER_LABELS as PROVIDER_LABELS,
  VERYFRONT_CLOUD_PROVIDER_ORDER as PROVIDER_ORDER,
  VERYFRONT_CLOUD_PROVIDER_ROUTING,
  VERYFRONT_CLOUD_SURFACE_GATEWAY_API_VERSIONS,
  type VeryfrontCloudModelTransportCapabilities,
  type VeryfrontCloudProviderRouting,
} from "./model-catalog.data.ts";

/**
 * Veryfront Cloud providers listed in the catalog of this package.
 *
 * Internal to the catalog: it keeps the label and display-order tables
 * exhaustive. It is deliberately not part of the public barrel, because the set
 * of providers is open and a caller that switched on it exhaustively would
 * break as soon as a provider is added.
 */
export type KnownVeryfrontCloudProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "mistral"
  | "moonshotai";

/**
 * Public API contract for Veryfront Cloud provider ID.
 *
 * Listed providers autocomplete. Any other provider string is accepted as
 * written, so a provider the platform adds is reachable without a release of
 * this package.
 */
export type VeryfrontCloudProviderId =
  | KnownVeryfrontCloudProviderId
  | (string & Record<never, never>);

/** Wire format a Veryfront Cloud gateway endpoint speaks. */
export type VeryfrontCloudWireSurface = "openai" | "anthropic" | "google";

/**
 * Surface named by catalog data. Implemented surfaces autocomplete; any other
 * value is carried through, so data can name a surface a later release builds
 * requests for.
 */
export type VeryfrontCloudSurfaceId = VeryfrontCloudWireSurface | (string & Record<never, never>);

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
/** Private runtime Map for provider routing lookups, built from the frozen data entries. */
const _providerRoutingMap = new Map(VERYFRONT_CLOUD_PROVIDER_ROUTING);
/** Private runtime Map for gateway API version lookups, built from the frozen data entries. */
const _surfaceGatewayApiVersionMap = new Map(VERYFRONT_CLOUD_SURFACE_GATEWAY_API_VERSIONS);

/** Resolve a supported gateway provider alias without consulting object prototypes. */
export function normalizeVeryfrontCloudProviderAlias(
  provider: string,
): KnownVeryfrontCloudProviderId | undefined {
  return _providerAliasMap.get(provider);
}

/**
 * Names rejected as a provider ID, so a provider segment can never be confused
 * with a member every object carries, and the gateway prefix can never be read
 * as a provider. Without the latter, a doubly prefixed ID would resolve to a
 * provider named after the prefix itself and build a self-referential path.
 */
const RESERVED_PROVIDER_IDS: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  "prototype",
  VERYFRONT_CLOUD_MODEL_PREFIX.slice(0, -1),
]);

/** Shape required of a provider ID: lowercase words joined by hyphens or dots. */
const PROVIDER_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * Resolve the provider segment of a gateway model ID, including providers this
 * package does not list. A listed alias resolves to its canonical ID; any other
 * value is kept as written once it is a safe single path segment.
 */
export function resolveVeryfrontCloudProviderId(
  provider: string,
): VeryfrontCloudProviderId | undefined {
  const alias = normalizeVeryfrontCloudProviderAlias(provider);
  if (alias) return alias;
  return PROVIDER_ID_PATTERN.test(provider) && !RESERVED_PROVIDER_IDS.has(provider)
    ? provider
    : undefined;
}

/** Routing used for a provider the catalog data does not list. */
const DEFAULT_PROVIDER_ROUTING: Readonly<VeryfrontCloudProviderRouting> = Object.freeze({
  surface: DEFAULT_VERYFRONT_CLOUD_SURFACE,
});

/** Gateway routing declared for a provider, or the default for an unlisted one. */
export function resolveVeryfrontCloudProviderRouting(
  provider: string,
): Readonly<VeryfrontCloudProviderRouting> {
  const canonical = normalizeVeryfrontCloudProviderAlias(provider) ?? provider;
  return _providerRoutingMap.get(canonical) ?? DEFAULT_PROVIDER_ROUTING;
}

/** Wire format the given provider's gateway endpoint speaks. */
export function resolveVeryfrontCloudSurface(provider: string): VeryfrontCloudSurfaceId {
  return resolveVeryfrontCloudProviderRouting(provider).surface;
}

/** Wire surfaces this package builds requests for. */
const WIRE_SURFACES: ReadonlySet<string> = new Set(["openai", "anthropic", "google"]);

/**
 * Narrow a declared surface to one this package builds requests for.
 *
 * Catalog data can name a surface a later release adds, so the check is on the
 * value rather than on the type.
 */
export function requireVeryfrontCloudWireSurface(
  surface: VeryfrontCloudSurfaceId,
): VeryfrontCloudWireSurface {
  if (WIRE_SURFACES.has(surface)) return surface as VeryfrontCloudWireSurface;
  throw NOT_SUPPORTED.create({
    detail: `Veryfront Cloud wire surface "${surface}" is not supported by this package version`,
  });
}

/**
 * Gateway path for a provider, or undefined when the provider ID cannot be a
 * path segment. The surface decides the API version, so a provider the catalog
 * does not list resolves to a path of the same shape.
 */
export function resolveVeryfrontCloudGatewayPath(provider: string): string | undefined {
  const providerId = resolveVeryfrontCloudProviderId(provider);
  if (!providerId) return undefined;
  const apiVersion = _surfaceGatewayApiVersionMap.get(
    resolveVeryfrontCloudSurface(providerId),
  ) ?? DEFAULT_VERYFRONT_CLOUD_GATEWAY_API_VERSION;
  return `${VERYFRONT_CLOUD_GATEWAY_PATH_PREFIX}/${providerId}/${apiVersion}`;
}

/**
 * Provider segment of a gateway model ID, including providers this package does
 * not list. Returns undefined when the ID carries no usable provider segment.
 */
export function resolveVeryfrontCloudProviderFromModelId(
  modelId: string,
): VeryfrontCloudProviderId | undefined {
  const normalizedModelId = normalizeVeryfrontCloudModelId(modelId);
  const slashIndex = normalizedModelId.indexOf("/");
  if (slashIndex <= 0) return undefined;
  return resolveVeryfrontCloudProviderId(normalizedModelId.slice(0, slashIndex));
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

/** Provider name the OpenAI runtime is built under for Veryfront Cloud models. */
const VERYFRONT_CLOUD_OPENAI_RUNTIME_NAME = "veryfront-cloud";

/**
 * How a Veryfront Cloud model on the OpenAI surface picks its transport.
 *
 * A pinned plan never changes for the life of the model. An unpinned plan is
 * adaptive: the runtime keeps to chat completions until a request carries a
 * hosted tool, which only the Responses surface serves.
 */
export type VeryfrontCloudOpenAITransportPlan = {
  readonly transport: "chat-completions" | "responses";
  readonly pinned: boolean;
};

const CHAT_COMPLETIONS_PINNED: VeryfrontCloudOpenAITransportPlan = Object.freeze({
  transport: "chat-completions" as const,
  pinned: true,
});
const RESPONSES_PINNED: VeryfrontCloudOpenAITransportPlan = Object.freeze({
  transport: "responses" as const,
  pinned: true,
});
const CHAT_COMPLETIONS_ADAPTIVE: VeryfrontCloudOpenAITransportPlan = Object.freeze({
  transport: "chat-completions" as const,
  pinned: false,
});

/**
 * Transport plan for a provider and upstream model ID on the OpenAI surface.
 *
 * Model construction and the durable model-call context both read this, so the
 * transport recorded against a call cannot drift from the one the request is
 * built with.
 */
export function resolveVeryfrontCloudOpenAITransportPlan(
  provider: string,
  upstreamModelId: string,
): VeryfrontCloudOpenAITransportPlan {
  const routing = resolveVeryfrontCloudProviderRouting(provider);
  // A provider that only speaks the OpenAI wire format has no Responses
  // surface, so nothing can move it off chat completions.
  if (routing.surface !== "openai" || routing.native !== true) return CHAT_COMPLETIONS_PINNED;

  const catalogModelId = `${provider}/${upstreamModelId}`;
  const declared = resolveVeryfrontCloudOpenAITransport(catalogModelId);
  if (declared !== undefined) {
    return declared === "responses" ? RESPONSES_PINNED : CHAT_COMPLETIONS_PINNED;
  }
  if (resolveVeryfrontCloudModelThinking(catalogModelId)?.enabled === true) return RESPONSES_PINNED;
  if (isOpenAIReasoningModel(upstreamModelId, VERYFRONT_CLOUD_OPENAI_RUNTIME_NAME)) {
    return RESPONSES_PINNED;
  }
  return CHAT_COMPLETIONS_ADAPTIVE;
}

/** Transport one call uses, given whether that call carries a hosted tool. */
export function resolveVeryfrontCloudOpenAICallTransport(
  provider: string,
  upstreamModelId: string,
  usesHostedTool: boolean,
): "chat-completions" | "responses" {
  const plan = resolveVeryfrontCloudOpenAITransportPlan(provider, upstreamModelId);
  if (plan.pinned) return plan.transport;
  return usesHostedTool ? "responses" : "chat-completions";
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

/**
 * Return Veryfront Cloud provider from model ID.
 *
 * Hosted and delegated runs install this as their provider resolver, so it
 * accepts the same provider segments the gateway routes: a listed alias
 * resolves to its canonical ID, and a provider this package does not list is
 * kept as written. It throws only when the ID carries no usable provider
 * segment at all.
 */
export function getVeryfrontCloudProviderFromModelId(
  modelId: string,
): VeryfrontCloudProviderId {
  const provider = resolveVeryfrontCloudProviderFromModelId(modelId);
  if (provider) return provider;

  const prefix = normalizeVeryfrontCloudModelId(modelId).split("/", 1)[0] ?? "";
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

/**
 * Prefix a model ID so it resolves through the Veryfront Cloud gateway,
 * including a provider this package does not list.
 *
 * Call this only once Veryfront Cloud is the chosen backend for the run. It
 * prefixes ANY well-formed provider segment, including providers this package
 * does not list, so it must not be used to test whether an ID belongs to
 * Veryfront Cloud. An ID that already carries the prefix, an ID with no
 * well-formed provider segment, and the explicitly unsupported models are
 * returned unchanged.
 *
 * Every ID that routed before routes the same way. Well-formed IDs that did
 * not resolve before now do, which is the point: a provider the platform adds
 * needs no release of this package.
 *
 * Known limitation: a typo in an otherwise well-formed provider segment is
 * accepted here and fails at the gateway rather than locally. Nothing in this
 * package knows which providers the platform serves until the served model
 * list is consumed.
 */
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

  // Any ID whose provider segment the gateway can route is prefixed, so a
  // provider this package does not list reaches the gateway rather than the
  // global provider registry.
  return resolveVeryfrontCloudProviderFromModelId(modelId) !== undefined
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
  if (!resolveVeryfrontCloudProviderFromModelId(modelId)) {
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

  const provider = resolveVeryfrontCloudProviderFromModelId(modelId);
  if (!provider || resolveVeryfrontCloudSurface(provider) !== "anthropic") {
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
  readonly provider: KnownVeryfrontCloudProviderId;
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

/**
 * Prefix a model ID for a hosted run. Alias of
 * {@link resolveVeryfrontCloudGatewayModelId}, with the same contract: call it
 * only once Veryfront Cloud is the chosen backend, because it prefixes ANY
 * well-formed provider segment, including providers this package does not
 * list. Read that function's documentation before calling this one.
 */
export const resolveHostedVeryfrontCloudModelId = resolveVeryfrontCloudGatewayModelId;
