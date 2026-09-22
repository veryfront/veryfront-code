/**
 * Veryfront Cloud model catalog data.
 *
 * Generated file. Do not edit by hand: run `deno task generate:model-catalog`,
 * read the diff, and open a pull request with it. Facts the served catalog
 * does not carry live in `scripts/build/model-catalog-overlay.ts`.
 *
 * Data only: this module holds the catalog tables and contains no logic. Every
 * export is a plain frozen value, and the only imports are types. Resolution
 * logic lives in `model-catalog.ts`, which is the module to import from.
 */
import type {
  KnownVeryfrontCloudProviderId,
  VeryfrontCloudChatModel,
  VeryfrontCloudProviderId,
  VeryfrontCloudSurfaceId,
} from "./model-catalog.ts";

/**
 * Gateway routing for one provider.
 *
 * The surface is the wire format the provider's gateway endpoint speaks. It is
 * the only fact routing needs, so a provider this package does not list is
 * reachable as soon as its surface is known.
 */
export type VeryfrontCloudProviderRouting = {
  /**
   * Wire format spoken by the provider's gateway endpoint. The catalog can
   * name one this package builds no request for; such a value is carried
   * here and refused when a request is built, never at import.
   */
  readonly surface: VeryfrontCloudSurfaceId;
  /**
   * Whether the provider implements the surface natively rather than only
   * speaking its wire format. On the OpenAI surface, native providers can use
   * the Responses transport; the others keep to Chat Completions.
   */
  readonly native?: boolean;
};

/** Model-specific transport capabilities that cannot be inferred from the provider family. */
export type VeryfrontCloudModelTransportCapabilities = {
  readonly anthropicThinkingMode?: "adaptive";
  readonly openAITransport?: "chat-completions" | "responses";
  readonly openAIChatReasoningWithFunctionTools?: boolean;
};

/**
 * Default Veryfront Cloud model ID used when no model is configured.
 * Update this when the current default is deprecated. Otherwise the default
 * path silently breaks for users who have not set an explicit model.
 */
export const DEFAULT_VERYFRONT_CLOUD_MODEL_ID = "gpt-5.4-nano";

/**
 * Accepted provider aliases mapped to their canonical provider ID.
 * Frozen entries in alias order; build a Map locally if lookup-by-key is needed.
 */
export const VERYFRONT_CLOUD_PROVIDER_ALIASES: ReadonlyArray<
  readonly [string, KnownVeryfrontCloudProviderId]
> = Object.freeze([
  Object.freeze(["anthropic", "anthropic"] as const),
  Object.freeze(["openai", "openai"] as const),
  Object.freeze(["google", "google"] as const),
  Object.freeze(["google-ai-studio", "google"] as const),
  Object.freeze(["mistral", "mistral"] as const),
  Object.freeze(["moonshotai", "moonshotai"] as const),
]);

/**
 * Gateway routing per provider. A provider missing from this table is routed
 * on the default surface, so the package reaches a provider it does not list
 * without a code change.
 * Frozen entries; build a Map locally if lookup-by-key is needed.
 */
export const VERYFRONT_CLOUD_PROVIDER_ROUTING: ReadonlyArray<
  readonly [VeryfrontCloudProviderId, Readonly<VeryfrontCloudProviderRouting>]
> = Object.freeze([
  Object.freeze(
    ["anthropic", Object.freeze({ surface: "anthropic" as const, native: true })] as const,
  ),
  Object.freeze(["openai", Object.freeze({ surface: "openai" as const, native: true })] as const),
  Object.freeze(["google", Object.freeze({ surface: "google" as const, native: true })] as const),
  Object.freeze(["mistral", Object.freeze({ surface: "openai" as const })] as const),
  Object.freeze(["moonshotai", Object.freeze({ surface: "openai" as const })] as const),
]);

/** Surface used for a provider the routing table does not list. */
export const DEFAULT_VERYFRONT_CLOUD_SURFACE = "openai";

/** Leading gateway path segments, shared by every surface. */
export const VERYFRONT_CLOUD_GATEWAY_PATH_PREFIX = "ai/gateway";

/**
 * Gateway API version per surface, appended after the provider segment.
 * Frozen entries; build a Map locally if lookup-by-key is needed.
 */
export const VERYFRONT_CLOUD_SURFACE_GATEWAY_API_VERSIONS: ReadonlyArray<
  readonly [string, string]
> = Object.freeze([
  Object.freeze(["anthropic", "v1"] as const),
  Object.freeze(["openai", "v1"] as const),
  Object.freeze(["google", "v1beta"] as const),
]);

/** Gateway API version used for a surface without its own entry. */
export const DEFAULT_VERYFRONT_CLOUD_GATEWAY_API_VERSION = "v1";

/**
 * Transport capabilities keyed by canonical provider/model ID. Both
 * provider-specific and provider-neutral option resolution consult this table
 * so the two representations cannot contradict each other.
 * Frozen entries; build a Map locally if lookup-by-key is needed.
 */
export const VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES: ReadonlyArray<
  readonly [string, Readonly<VeryfrontCloudModelTransportCapabilities>]
> = Object.freeze([
  Object.freeze(
    [
      "anthropic/claude-opus-4-7",
      Object.freeze({ anthropicThinkingMode: "adaptive" as const }),
    ] as const,
  ),
  Object.freeze(
    [
      "anthropic/claude-opus-4-8",
      Object.freeze({ anthropicThinkingMode: "adaptive" as const }),
    ] as const,
  ),
  Object.freeze(
    [
      "openai/gpt-5.4",
      Object.freeze({
        openAITransport: "chat-completions" as const,
        openAIChatReasoningWithFunctionTools: false,
      }),
    ] as const,
  ),
  Object.freeze(
    [
      "openai/gpt-5.5",
      Object.freeze({
        openAITransport: "chat-completions" as const,
        openAIChatReasoningWithFunctionTools: false,
      }),
    ] as const,
  ),
]);

/**
 * Chat model entries in display order. The order is user-visible. Each entry is
 * frozen here, so the data is immutable for any module that imports it.
 */
export const VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES: readonly VeryfrontCloudChatModel[] = Object.freeze(
  [
    Object.freeze({
      id: "opus",
      modelId: "anthropic/claude-opus-4-8",
      provider: "anthropic",
      name: "Claude Opus 4.8",
      description: "Most capable for ambitious work",
      thinkingBudgetTokens: 2048,
    }),
    Object.freeze({
      id: "claude-opus-4-6",
      modelId: "anthropic/claude-opus-4-6",
      provider: "anthropic",
      name: "Claude Opus 4.6",
      description: "Previous Opus generation for compatibility-sensitive agents",
      thinkingBudgetTokens: 2048,
    }),
    Object.freeze({
      id: "sonnet",
      modelId: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
      name: "Claude Sonnet 4.6",
      description: "Most efficient for everyday tasks",
      thinkingBudgetTokens: 2048,
    }),
    Object.freeze({
      id: "haiku",
      modelId: "anthropic/claude-haiku-4-5-20251001",
      provider: "anthropic",
      name: "Claude Haiku 4.5",
      description: "Fastest for quick answers",
      thinkingBudgetTokens: 1024,
    }),
    Object.freeze({
      id: "gpt-5.5",
      modelId: "openai/gpt-5.5",
      provider: "openai",
      name: "GPT-5.5",
      description: "Most capable OpenAI model",
      thinking: true,
    }),
    Object.freeze({
      id: "gpt-5.4-mini",
      modelId: "openai/gpt-5.4-mini",
      provider: "openai",
      name: "GPT-5.4 Mini",
      description: "Fast OpenAI model for cost-efficient everyday work",
      thinking: true,
    }),
    Object.freeze({
      id: "gpt-5.4",
      modelId: "openai/gpt-5.4",
      provider: "openai",
      name: "GPT-5.4",
      description: "Production-proven OpenAI frontier model",
      thinking: true,
    }),
    Object.freeze({
      id: "gpt-5.4-nano",
      modelId: "openai/gpt-5.4-nano",
      provider: "openai",
      name: "GPT-5.4 Nano",
      description: "Lowest-cost OpenAI model for lightweight work",
      thinking: true,
    }),
    Object.freeze({
      id: "gpt-5.2",
      modelId: "openai/gpt-5.2",
      provider: "openai",
      name: "GPT-5.2",
      description: "Previous OpenAI frontier generation",
      thinking: true,
    }),
    Object.freeze({
      id: "gemini-3.1-pro-preview",
      modelId: "google-ai-studio/gemini-3.1-pro-preview",
      provider: "google",
      name: "Gemini 3.1 Pro Preview",
      description: "Advanced reasoning and analysis",
      thinking: true,
    }),
    Object.freeze({
      id: "gemini-3.5-flash",
      modelId: "google-ai-studio/gemini-3.5-flash",
      provider: "google",
      name: "Gemini 3.5 Flash",
      description: "Fast and cost-efficient",
    }),
    Object.freeze({
      id: "gemini-2.5-pro",
      modelId: "google-ai-studio/gemini-2.5-pro",
      provider: "google",
      name: "Gemini 2.5 Pro",
      description: "Previous Google Pro model",
      thinking: true,
    }),
    Object.freeze({
      id: "gemini-2.5-flash",
      modelId: "google-ai-studio/gemini-2.5-flash",
      provider: "google",
      name: "Gemini 2.5 Flash",
      description: "Previous Google Flash model",
    }),
    Object.freeze({
      id: "mistral-large-2512",
      modelId: "mistral/mistral-large-2512",
      provider: "mistral",
      name: "Mistral Large 3",
      description: "Most capable Mistral model",
    }),
    Object.freeze({
      id: "mistral-small-2503",
      modelId: "mistral/mistral-small-2503",
      provider: "mistral",
      name: "Mistral Small 3.1",
      description: "Open-weight Mistral model served in the EU",
    }),
    Object.freeze({
      id: "kimi-k2.6",
      modelId: "moonshotai/kimi-k2.6",
      provider: "moonshotai",
      name: "Kimi K2.6",
      description: "Deep thinking and multimodal",
      thinking: true,
    }),
    Object.freeze({
      id: "kimi-k2.5",
      modelId: "moonshotai/kimi-k2.5",
      provider: "moonshotai",
      name: "Kimi K2.5",
      description: "Previous Kimi generation",
      thinking: true,
    }),
  ],
);

/**
 * Provider display order. The order is user-visible. Literal, so the label
 * table below can be typed by exactly these providers.
 */
export const VERYFRONT_CLOUD_PROVIDER_ORDER = Object.freeze(
  [
    "anthropic",
    "openai",
    "google",
    "mistral",
    "moonshotai",
  ] as const,
) satisfies readonly KnownVeryfrontCloudProviderId[];

/**
 * Display label for each DISPLAYED provider: the providers in the display
 * order, not every known one. A known provider the catalog lists no chat
 * model for keeps its alias and routing rows but has no label row, and the
 * type says so rather than requiring one.
 */
export const VERYFRONT_CLOUD_PROVIDER_LABELS: Readonly<
  Record<(typeof VERYFRONT_CLOUD_PROVIDER_ORDER)[number], string>
> = Object.freeze({
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  moonshotai: "Kimi",
  mistral: "Mistral",
});
