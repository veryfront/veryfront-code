/**
 * Veryfront Cloud model catalog data.
 *
 * Data only: this module holds the catalog tables and contains no logic. Every
 * export is a plain frozen value, and the only imports are types. Resolution
 * logic lives in `model-catalog.ts`, which is the module to import from.
 *
 * The tables are kept in one place so that they can be produced by a generator.
 * Do not add functions, computed values, or side effects here.
 */
import type {
  KnownVeryfrontCloudProviderId,
  VeryfrontCloudChatModel,
  VeryfrontCloudProviderId,
  VeryfrontCloudWireSurface,
} from "./model-catalog.ts";

/**
 * Gateway routing for one provider.
 *
 * The surface is the wire format the provider's gateway endpoint speaks. It is
 * the only fact routing needs, so a provider this package does not list is
 * reachable as soon as its surface is known.
 */
export type VeryfrontCloudProviderRouting = {
  /** Wire format spoken by the provider's gateway endpoint. */
  readonly surface: VeryfrontCloudWireSurface;
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

/** Accepted provider aliases mapped to their canonical provider ID. */
export const VERYFRONT_CLOUD_PROVIDER_ALIASES: ReadonlyMap<string, KnownVeryfrontCloudProviderId> =
  new Map<string, KnownVeryfrontCloudProviderId>([
    ["anthropic", "anthropic"],
    ["openai", "openai"],
    ["google", "google"],
    ["google-ai-studio", "google"],
    ["mistral", "mistral"],
    ["moonshotai", "moonshotai"],
  ]);

/**
 * Gateway routing per provider. A provider missing from this table is routed
 * on the default surface, so the package reaches a provider it does not list
 * without a code change.
 */
export const VERYFRONT_CLOUD_PROVIDER_ROUTING: ReadonlyMap<
  VeryfrontCloudProviderId,
  Readonly<VeryfrontCloudProviderRouting>
> = new Map<VeryfrontCloudProviderId, Readonly<VeryfrontCloudProviderRouting>>([
  ["anthropic", Object.freeze({ surface: "anthropic", native: true })],
  ["openai", Object.freeze({ surface: "openai", native: true })],
  ["google", Object.freeze({ surface: "google", native: true })],
  ["mistral", Object.freeze({ surface: "openai" })],
  ["moonshotai", Object.freeze({ surface: "openai" })],
]);

/** Surface used for a provider the routing table does not list. */
export const DEFAULT_VERYFRONT_CLOUD_SURFACE = "openai";

/** Leading gateway path segments, shared by every surface. */
export const VERYFRONT_CLOUD_GATEWAY_PATH_PREFIX = "ai/gateway";

/** Gateway API version per surface, appended after the provider segment. */
export const VERYFRONT_CLOUD_SURFACE_GATEWAY_API_VERSIONS: ReadonlyMap<string, string> = new Map([
  ["anthropic", "v1"],
  ["openai", "v1"],
  ["google", "v1beta"],
]);

/** Gateway API version used for a surface without its own entry. */
export const DEFAULT_VERYFRONT_CLOUD_GATEWAY_API_VERSION = "v1";

/** Model ID prefixes accepted for gateway models, one per provider alias, in alias order. */
export const VERYFRONT_CLOUD_GATEWAY_MODEL_PROVIDER_PREFIXES: readonly string[] = Object.freeze([
  "anthropic/",
  "openai/",
  "google/",
  "google-ai-studio/",
  "mistral/",
  "moonshotai/",
]);

/**
 * Transport capabilities keyed by canonical provider/model ID. Both
 * provider-specific and provider-neutral option resolution consult this table
 * so the two representations cannot contradict each other.
 */
export const VERYFRONT_CLOUD_MODEL_TRANSPORT_CAPABILITIES: ReadonlyMap<
  string,
  Readonly<VeryfrontCloudModelTransportCapabilities>
> = new Map<string, Readonly<VeryfrontCloudModelTransportCapabilities>>([
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

/** Display label for each provider. */
export const VERYFRONT_CLOUD_PROVIDER_LABELS: Readonly<
  Record<KnownVeryfrontCloudProviderId, string>
> = Object.freeze({
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  moonshotai: "Kimi",
  mistral: "Mistral",
});

/** Provider display order. The order is user-visible. */
export const VERYFRONT_CLOUD_PROVIDER_ORDER: readonly KnownVeryfrontCloudProviderId[] = Object
  .freeze([
    "anthropic",
    "openai",
    "google",
    "mistral",
    "moonshotai",
  ]);
