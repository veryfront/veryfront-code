import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors";
import { isOpenAIReasoningModel } from "../shared/openai-reasoning.ts";
import { getVeryfrontCloudBootstrap } from "#veryfront/platform/cloud/resolver.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import type { ModelRuntime } from "../types.ts";
import {
  hasActiveVeryfrontCloudCatalogScope,
  peekVeryfrontCloudCatalog,
  type VeryfrontCloudCatalog,
  type VeryfrontCloudCatalogModel,
} from "./catalog-client.ts";
import { SHIPPED_VERYFRONT_CLOUD_CATALOG } from "./model-catalog.deprecated.ts";

export {
  DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL,
  findVeryfrontCloudModel,
  findVeryfrontCloudModelByModelId,
  groupVeryfrontCloudModelsByProvider,
  VERYFRONT_CLOUD_CHAT_MODELS,
} from "./model-catalog.deprecated.ts";

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
  | "moonshotai"
  | "deepseek";

/**
 * A Veryfront Cloud provider ID: a listed provider, or any other well-formed provider string.
 *
 * Listed providers autocomplete. Any other provider string is accepted as
 * written, so a provider the platform adds is reachable without a release of
 * this package.
 */
export type VeryfrontCloudProviderId =
  | KnownVeryfrontCloudProviderId
  | (string & Record<never, never>);

/**
 * A provider-qualified Veryfront Cloud model ID, for example
 * `anthropic/claude-sonnet-4-6`. Any provider and model the platform serves
 * fits, so a new model needs no release of this package.
 */
export type VeryfrontCloudModelId = `${string}/${string}`;

/** A model ID routed through Veryfront Cloud: `veryfront-cloud/<provider>/<model>`. */
export type VeryfrontCloudRuntimeModelId = `veryfront-cloud/${string}/${string}`;

/** Wire format a Veryfront Cloud gateway endpoint speaks. */
export type VeryfrontCloudWireSurface = "openai" | "anthropic" | "google";

/**
 * Surface named by catalog data. Implemented surfaces autocomplete; any other
 * value is carried through, so data can name a surface a later release builds
 * requests for.
 */
export type VeryfrontCloudSurfaceId =
  | VeryfrontCloudWireSurface
  | (string & Record<never, never>);

/**
 * Gateway routing for one provider: the wire format its endpoint speaks, and
 * whether it implements that format natively. On the OpenAI surface, only a
 * native provider can use the Responses transport.
 */
export type VeryfrontCloudProviderRouting = {
  readonly surface: VeryfrontCloudSurfaceId;
  readonly native?: boolean;
};

/** Model-specific transport capabilities that cannot be inferred from the provider family. */
type VeryfrontCloudModelTransportCapabilities = {
  readonly anthropicThinkingMode?: "adaptive";
  readonly openAITransport?: "chat-completions" | "responses";
  readonly openAIChatReasoningWithFunctionTools?: boolean;
  readonly openAIChatPreserveSystemMessages?: boolean;
};

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
 * Short ID of the built-in default model, used when no model is configured
 * and the served catalog has not been loaded.
 */
export const DEFAULT_VERYFRONT_CLOUD_MODEL_ID = "mistral-small-2503";
/** Shared Veryfront Cloud model prefix value. */
export const VERYFRONT_CLOUD_MODEL_PREFIX = "veryfront-cloud/";
/** Provider-qualified ID of the built-in default model. */
export const DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID: VeryfrontCloudModelId =
  "mistral/mistral-small-2503";
/** Veryfront Cloud runtime ID of the built-in default model. */
export const DEFAULT_VERYFRONT_CLOUD_RUNTIME_MODEL_ID: VeryfrontCloudRuntimeModelId =
  `veryfront-cloud/${DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID}`;

/**
 * Provider-qualified ID of the default model: the one the served catalog
 * names once it is loaded, otherwise the built-in default.
 */
export function resolveVeryfrontCloudDefaultModelId(): VeryfrontCloudModelId {
  const served = loadedCatalog()?.defaultModelId;
  return served !== undefined && served.includes("/")
    ? served as VeryfrontCloudModelId
    : DEFAULT_VERYFRONT_CLOUD_PROVIDER_MODEL_ID;
}

/** Leading gateway path segments of a vendor-scoped route, shared by every surface. */
const VENDOR_GATEWAY_PATH_PREFIX = "ai/gateway";
/** Vendor-scoped gateway API version per wire protocol. */
const VENDOR_GATEWAY_API_VERSIONS: ReadonlyMap<string, string> = new Map([
  ["anthropic", "v1"],
  ["openai", "v1"],
  ["google", "v1beta"],
]);
/** Vendor-scoped gateway API version for a protocol without its own entry. */
const DEFAULT_VENDOR_GATEWAY_API_VERSION = "v1";
/** Surface used for a provider the served catalog does not describe. */
const DEFAULT_VERYFRONT_CLOUD_SURFACE = "openai";
/**
 * Providers named after the wire protocol they implement. When no catalog
 * describes a provider, one of these speaks its own protocol natively and any
 * other provider speaks the default surface.
 */
const PROTOCOL_NAMED_PROVIDERS: ReadonlySet<string> = new Set(["openai", "anthropic", "google"]);
/**
 * Provider spellings that name a protocol-named provider. A protocol fact, not
 * a model fact: it holds whether or not a catalog has loaded.
 */
const PROTOCOL_PROVIDER_ALIASES: ReadonlyMap<string, string> = new Map([
  ["google-ai-studio", "google"],
]);

/** Lookups built once per loaded catalog. */
interface ServedCatalogIndex {
  /** Provider segment of a served model ID -> the canonical provider it belongs to. */
  readonly providerAliases: ReadonlyMap<string, string>;
  /** Canonical provider -> routing derived from its served models. */
  readonly routing: ReadonlyMap<string, Readonly<VeryfrontCloudProviderRouting>>;
  /** `<canonical provider>/<model>` -> served model. */
  readonly byKey: ReadonlyMap<string, VeryfrontCloudCatalogModel>;
  /** Short ID or bare alias -> served model. */
  readonly byShortId: ReadonlyMap<string, VeryfrontCloudCatalogModel>;
  /** Exact provider-qualified model ID -> served model. */
  readonly byModelId: ReadonlyMap<string, VeryfrontCloudCatalogModel>;
}

const servedIndexes = new WeakMap<VeryfrontCloudCatalog, ServedCatalogIndex>();

function modelSegment(modelId: string): string {
  return modelId.slice(modelId.indexOf("/") + 1);
}

function buildServedIndex(catalog: VeryfrontCloudCatalog): ServedCatalogIndex {
  const providerAliases = new Map<string, string>();
  const surfaces = new Map<string, string>();
  const operationsKnown = new Set<string>();
  const servesResponses = new Set<string>();
  const byKey = new Map<string, VeryfrontCloudCatalogModel>();
  const byShortId = new Map<string, VeryfrontCloudCatalogModel>();
  const byModelId = new Map<string, VeryfrontCloudCatalogModel>();

  for (const model of catalog.models) {
    const slashIndex = model.modelId.indexOf("/");
    if (slashIndex <= 0) continue;
    const segment = model.modelId.slice(0, slashIndex);
    if (!providerAliases.has(segment)) providerAliases.set(segment, model.provider);
    if (!providerAliases.has(model.provider)) providerAliases.set(model.provider, model.provider);
    if (model.surface !== undefined && !surfaces.has(model.provider)) {
      surfaces.set(model.provider, model.surface);
    }
    if (model.operations !== undefined) {
      operationsKnown.add(model.provider);
      if (model.operations.includes("responses")) servesResponses.add(model.provider);
    }
    const key = `${model.provider}/${modelSegment(model.modelId)}`;
    if (!byKey.has(key)) byKey.set(key, model);
    if (!byModelId.has(model.modelId)) byModelId.set(model.modelId, model);
    for (const shortId of [model.id, ...model.aliases]) {
      if (!shortId.includes("/") && !byShortId.has(shortId)) byShortId.set(shortId, model);
    }
  }

  const routing = new Map<string, Readonly<VeryfrontCloudProviderRouting>>();
  for (const [provider, surface] of surfaces) {
    // A provider is native to the OpenAI surface when the platform serves the
    // Responses operation for one of its models. An API that serves no
    // operations yet leaves the protocol-named rule in place.
    const native = surface !== "openai"
      ? true
      : operationsKnown.has(provider)
      ? servesResponses.has(provider)
      : PROTOCOL_NAMED_PROVIDERS.has(provider);
    routing.set(provider, Object.freeze({ surface, native }));
  }

  return { providerAliases, routing, byKey, byShortId, byModelId };
}

/**
 * The scope synchronous reads use: the one a model build names, otherwise the
 * ambient Veryfront Cloud credentials. Undefined without credentials.
 */
function ambientScope():
  | { apiBaseUrl: string; apiToken: string; projectSlug?: string }
  | undefined {
  let bootstrap: ReturnType<typeof getVeryfrontCloudBootstrap>;
  try {
    bootstrap = getVeryfrontCloudBootstrap();
  } catch {
    return undefined;
  }
  if (!bootstrap.apiToken || !bootstrap.apiBaseUrl) return undefined;
  return {
    apiBaseUrl: bootstrap.apiBaseUrl,
    apiToken: bootstrap.apiToken,
    ...(bootstrap.projectSlug ? { projectSlug: bootstrap.projectSlug } : {}),
  };
}

/** The served catalog loaded for the scope reads use, or undefined before it loads. */
function loadedCatalog(): VeryfrontCloudCatalog | undefined {
  if (hasActiveVeryfrontCloudCatalogScope()) return peekVeryfrontCloudCatalog();
  const scope = ambientScope();
  // A scope-less read still sees a catalog fixed by a test hook.
  return scope ? peekVeryfrontCloudCatalog(scope) : peekVeryfrontCloudCatalog();
}

/**
 * Whether a served catalog has loaded for the scope reads use right now. While
 * it has not, reads fall back to the shipped list, which cannot know models
 * the platform added since, so a caller should not refuse a model on it alone.
 */
export function isVeryfrontCloudCatalogLoaded(): boolean {
  return loadedCatalog() !== undefined;
}

/**
 * The index reads use: the served catalog loaded for the current scope, or the
 * shipped list while none has loaded for it.
 */
function servedIndex(): ServedCatalogIndex {
  const catalog = loadedCatalog() ?? SHIPPED_VERYFRONT_CLOUD_CATALOG;
  let index = servedIndexes.get(catalog);
  if (!index) {
    index = buildServedIndex(catalog);
    servedIndexes.set(catalog, index);
  }
  return index;
}

/**
 * Canonical provider for a provider segment the catalog spells, for example
 * `google-ai-studio` for `google`. Undefined when neither the catalog nor the
 * protocol aliases name the segment.
 */
export function normalizeVeryfrontCloudProviderAlias(
  provider: string,
): VeryfrontCloudProviderId | undefined {
  return servedIndex().providerAliases.get(provider) ?? PROTOCOL_PROVIDER_ALIASES.get(provider);
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
  return PROVIDER_ID_PATTERN.test(provider) &&
      !RESERVED_PROVIDER_IDS.has(provider)
    ? provider
    : undefined;
}

/** Routing used for a provider the served catalog does not describe. */
const DEFAULT_PROVIDER_ROUTING: Readonly<VeryfrontCloudProviderRouting> = Object
  .freeze({
    surface: DEFAULT_VERYFRONT_CLOUD_SURFACE,
  });

/** Routing of a provider named after its protocol, used until the catalog describes it. */
const PROTOCOL_NAMED_ROUTING: ReadonlyMap<string, Readonly<VeryfrontCloudProviderRouting>> =
  new Map(
    [...PROTOCOL_NAMED_PROVIDERS].map((
      protocol,
    ) => [protocol, Object.freeze({ surface: protocol, native: true })]),
  );

/**
 * Gateway routing for a provider, as the served catalog describes it. Before
 * the catalog is loaded, and for a provider it does not describe, a provider
 * named after a protocol speaks that protocol natively and any other provider
 * speaks the default surface.
 */
export function resolveVeryfrontCloudProviderRouting(
  provider: string,
): Readonly<VeryfrontCloudProviderRouting> {
  const canonical = normalizeVeryfrontCloudProviderAlias(provider) ?? provider;
  return servedIndex().routing.get(canonical) ??
    PROTOCOL_NAMED_ROUTING.get(canonical) ??
    DEFAULT_PROVIDER_ROUTING;
}

/** Wire format the given provider's gateway endpoint speaks. */
export function resolveVeryfrontCloudSurface(
  provider: string,
): VeryfrontCloudSurfaceId {
  return resolveVeryfrontCloudProviderRouting(provider).surface;
}

/** Wire surfaces this package builds requests for. */
const WIRE_SURFACES: ReadonlySet<string> = new Set([
  "openai",
  "anthropic",
  "google",
]);

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
export function resolveVeryfrontCloudGatewayPath(
  provider: string,
): string | undefined {
  const providerId = resolveVeryfrontCloudProviderId(provider);
  if (!providerId) return undefined;
  const apiVersion = VENDOR_GATEWAY_API_VERSIONS.get(
    resolveVeryfrontCloudSurface(providerId),
  ) ?? DEFAULT_VENDOR_GATEWAY_API_VERSION;
  return `${VENDOR_GATEWAY_PATH_PREFIX}/${providerId}/${apiVersion}`;
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
  return resolveVeryfrontCloudProviderId(
    normalizedModelId.slice(0, slashIndex),
  );
}

/**
 * The key the capability rows are stored under: `<canonical provider>/<upstream id>`.
 *
 * A gateway model ID may carry the `veryfront-cloud/` prefix and may name its
 * provider by a listed alias (`google-ai-studio/...` for `google`); the rows are
 * keyed by the canonical provider, so both are normalized away here. An ID
 * with no provider segment is returned as normalized.
 */
export function canonicalVeryfrontCloudModelKey(modelId: string): string {
  const normalizedModelId = normalizeVeryfrontCloudModelId(modelId);
  const slashIndex = normalizedModelId.indexOf("/");
  if (slashIndex <= 0) return normalizedModelId;
  const provider = resolveVeryfrontCloudProviderId(
    normalizedModelId.slice(0, slashIndex),
  );
  return provider === undefined
    ? normalizedModelId
    : `${provider}/${normalizedModelId.slice(slashIndex + 1)}`;
}

/**
 * The served model a model ID names: by provider-qualified ID in any provider
 * spelling, or by short ID or bare alias. Undefined before the catalog is
 * loaded, or when the catalog does not list the model.
 */
function findServedModel(modelId: string): VeryfrontCloudCatalogModel | undefined {
  const index = servedIndex();
  return index.byKey.get(canonicalVeryfrontCloudModelKey(modelId)) ??
    index.byShortId.get(normalizeVeryfrontCloudModelId(modelId));
}

function isOpenAITransport(value: string | undefined): value is "chat-completions" | "responses" {
  return value === "chat-completions" || value === "responses";
}

function getVeryfrontCloudModelTransportCapabilities(
  modelId: string,
): Readonly<VeryfrontCloudModelTransportCapabilities> | undefined {
  const model = findServedModel(modelId);
  if (!model) return undefined;
  return {
    ...(model.surface === "anthropic" && model.reasoningMode === "adaptive"
      ? { anthropicThinkingMode: "adaptive" as const }
      : {}),
    ...(isOpenAITransport(model.transport) ? { openAITransport: model.transport } : {}),
    ...(model.chatCompletionsReasoningWithFunctionTools === undefined ? {} : {
      openAIChatReasoningWithFunctionTools: model.chatCompletionsReasoningWithFunctionTools,
    }),
    ...(model.chatCompletionsConsecutiveSystemMessages === undefined ? {} : {
      openAIChatPreserveSystemMessages: model.chatCompletionsConsecutiveSystemMessages,
    }),
  };
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

/** Resolves whether a verified Chat transport preserves system message boundaries. */
export function resolveVeryfrontCloudOpenAIChatSystemMessages(
  modelId: string,
): boolean | undefined {
  return getVeryfrontCloudModelTransportCapabilities(modelId)?.openAIChatPreserveSystemMessages;
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

const CHAT_COMPLETIONS_PINNED: VeryfrontCloudOpenAITransportPlan = Object
  .freeze({
    transport: "chat-completions" as const,
    pinned: true,
  });
const RESPONSES_PINNED: VeryfrontCloudOpenAITransportPlan = Object.freeze({
  transport: "responses" as const,
  pinned: true,
});
const CHAT_COMPLETIONS_ADAPTIVE: VeryfrontCloudOpenAITransportPlan = Object
  .freeze({
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
  if (routing.surface !== "openai" || routing.native !== true) {
    return CHAT_COMPLETIONS_PINNED;
  }

  const catalogModelId = `${provider}/${upstreamModelId}`;
  const declared = resolveVeryfrontCloudOpenAITransport(catalogModelId);
  if (declared !== undefined) {
    return declared === "responses" ? RESPONSES_PINNED : CHAT_COMPLETIONS_PINNED;
  }
  // A model the platform does not serve on Responses keeps to chat completions,
  // even when its provider serves Responses for other models.
  const operations = findServedModel(catalogModelId)?.operations;
  if (operations !== undefined && !operations.includes("responses")) {
    return CHAT_COMPLETIONS_PINNED;
  }
  if (resolveVeryfrontCloudModelThinking(catalogModelId)?.enabled === true) {
    return RESPONSES_PINNED;
  }
  if (
    isOpenAIReasoningModel(upstreamModelId, VERYFRONT_CLOUD_OPENAI_RUNTIME_NAME)
  ) {
    return RESPONSES_PINNED;
  }
  return CHAT_COMPLETIONS_ADAPTIVE;
}

/** @internal The catalog facts one built Veryfront Cloud model was built with. */
export interface VeryfrontCloudModelFacts {
  readonly provider: string;
  readonly surface: VeryfrontCloudSurfaceId;
  readonly native: boolean;
  readonly transportPlan: VeryfrontCloudOpenAITransportPlan;
  readonly openAITransport?: "chat-completions" | "responses";
  readonly openAIChatReasoningWithFunctionTools?: boolean;
  readonly openAIChatPreserveSystemMessages?: boolean;
}

const builtModelFacts = createPrivateWeakStore<ModelRuntime, () => VeryfrontCloudModelFacts>();

/** @internal Record where a built model's current facts are read from. */
export function registerVeryfrontCloudModelFacts(
  model: ModelRuntime,
  read: () => VeryfrontCloudModelFacts,
): void {
  builtModelFacts.set(model, read);
}

/**
 * @internal The facts a Veryfront Cloud model built by this package currently
 * calls with, so a record of a call describes the request actually sent.
 * Undefined for any other object.
 */
export function readVeryfrontCloudModelFacts(
  model: unknown,
): VeryfrontCloudModelFacts | undefined {
  if (model === null || (typeof model !== "object" && typeof model !== "function")) {
    return undefined;
  }
  return builtModelFacts.get(model as ModelRuntime)?.();
}

/** Transport one call uses, given whether that call carries a hosted tool. */
export function resolveVeryfrontCloudOpenAICallTransport(
  provider: string,
  upstreamModelId: string,
  usesHostedTool: boolean,
): "chat-completions" | "responses" {
  const plan = resolveVeryfrontCloudOpenAITransportPlan(
    provider,
    upstreamModelId,
  );
  if (plan.pinned) return plan.transport;
  return usesHostedTool ? "responses" : "chat-completions";
}

/**
 * Whether an id is a Mistral id under any spelling the runtime accepts: the
 * gateway prefix stripped and the provider segment resolved through the alias
 * table, so an alias of the provider is gated exactly as the canonical one.
 */
function isMistralModelId(modelId: string): boolean {
  return canonicalVeryfrontCloudModelKey(modelId).startsWith("mistral/");
}

/**
 * Model ids the gateway no longer serves, keyed by canonical provider.
 * Removing them from the catalog is not enough: explicit provider ids pass
 * through unlisted, and the shipped list still backs reads before the served
 * catalog loads, so the gateway boundary rejects these by name. They stay
 * usable with the vendor's own key.
 */
const RETIRED_VERYFRONT_CLOUD_MODEL_KEYS: ReadonlySet<string> = new Set([
  "openai/gpt-5.4-nano",
  "google/gemini-3.1-pro-preview",
  "mistral/mistral-large-2512",
]);

/** Whether the gateway has retired this model id, under any accepted spelling. */
export function isRetiredVeryfrontCloudModelId(modelId: string): boolean {
  return RETIRED_VERYFRONT_CLOUD_MODEL_KEYS.has(canonicalVeryfrontCloudModelKey(modelId));
}

/** Error for a retired model that would otherwise be sent to the gateway. */
export function createRetiredVeryfrontCloudModelError(modelId: string): Error {
  return NOT_SUPPORTED.create({
    detail: `Model "${modelId}" is no longer available through Veryfront Cloud. ` +
      `Choose another model, or configure the provider's own API key to call it directly.`,
  });
}

/**
 * Whether a Mistral model ID is one the catalog lists: the served catalog once
 * it has loaded for the current scope, otherwise the shipped list.
 */
export function isSupportedMistralModelId(modelId: string): boolean {
  const index = servedIndex();
  return index.byKey.get(canonicalVeryfrontCloudModelKey(modelId))?.provider === "mistral";
}

/** Normalizes Veryfront Cloud model ID. */
export function normalizeVeryfrontCloudModelId(modelId: string): string {
  return modelId.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX)
    ? modelId.slice(VERYFRONT_CLOUD_MODEL_PREFIX.length)
    : modelId;
}

/**
 * Return the Veryfront Cloud provider named by a model ID, including a provider this package does not list.
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

/** Return the Veryfront Cloud provider named by a model ID, including one this package does not list, or `undefined` when the ID names none. */
export function tryGetVeryfrontCloudProviderFromModelId(
  modelId: string,
): VeryfrontCloudProviderId | undefined {
  try {
    return getVeryfrontCloudProviderFromModelId(modelId);
  } catch {
    return undefined;
  }
}

/**
 * Provider-qualified ID of a short alias only the served catalog knows, for
 * example one the platform added after this release. Reads a catalog loaded
 * for the current scope, never the shipped list, and never a retired model.
 * Undefined when no served catalog has loaded or it does not name the alias.
 */
export function resolveServedVeryfrontCloudAlias(alias: string): string | undefined {
  if (alias.includes("/") || loadedCatalog() === undefined) return undefined;
  const model = servedIndex().byShortId.get(alias);
  if (!model || isRetiredVeryfrontCloudModelId(model.modelId)) return undefined;
  return model.modelId;
}

/**
 * Resolve a model ID or short alias to a provider-qualified model ID.
 *
 * No value resolves to the default model. A provider-qualified ID is returned
 * as written. A short ID or alias resolves through the served catalog, or
 * through the shipped list before the catalog has loaded; use
 * `loadVeryfrontCloudModelCatalog()` first to resolve an alias the platform
 * added since this release.
 */
export function resolveVeryfrontCloudModelId(alias?: string): string {
  const requestedModel = alias || resolveVeryfrontCloudDefaultModelId();
  const index = servedIndex();
  const catalogModel = index.byModelId.get(requestedModel);
  if (catalogModel) {
    // A stale served list may still name a model the gateway has retired.
    if (isRetiredVeryfrontCloudModelId(catalogModel.modelId)) {
      throw createRetiredVeryfrontCloudModelError(catalogModel.modelId);
    }
    return catalogModel.modelId;
  }

  if (requestedModel.includes("/")) {
    // Mistral models are gated by the catalog whitelist; reject ids we don't
    // list so callers get a clear error rather than a gateway-side failure.
    if (
      isMistralModelId(requestedModel) &&
      !isSupportedMistralModelId(requestedModel)
    ) {
      throw NOT_SUPPORTED.create({
        detail: `Unsupported Mistral model "${requestedModel}"`,
      });
    }
    if (isRetiredVeryfrontCloudModelId(requestedModel)) {
      throw createRetiredVeryfrontCloudModelError(requestedModel);
    }
    return requestedModel;
  }

  const model = index.byShortId.get(requestedModel);
  if (!model) {
    throw INVALID_ARGUMENT.create({
      detail: `Unknown model alias "${requestedModel}"`,
    });
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
  if (isMistralModelId(modelId) && !isSupportedMistralModelId(modelId)) {
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

  const model = findServedModel(modelId);
  const budgetTokens = requireThinkingBudgetTokens(model?.reasoningBudgetTokens);
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

/**
 * Prefix a model ID for a hosted run. Alias of
 * {@link resolveVeryfrontCloudGatewayModelId}, with the same contract: call it
 * only once Veryfront Cloud is the chosen backend, because it prefixes ANY
 * well-formed provider segment, including providers this package does not
 * list. Read that function's documentation before calling this one.
 */
export const resolveHostedVeryfrontCloudModelId = resolveVeryfrontCloudGatewayModelId;
