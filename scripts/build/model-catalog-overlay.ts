/**
 * Catalog facts this package acts on that the served catalog does not carry.
 *
 * The generator merges this overlay into the data it builds from the served
 * catalog, so the generated module keeps behaviour the served payload cannot
 * express yet. Keep the overlay small: an entry belongs here only while no
 * served field evidences the same fact, and must be deleted as soon as one
 * does. Never add an entry here to override a field the catalog does serve.
 *
 * Served facts win. The overlay only adds what the platform does not serve, so
 * an entry that presumes a served capability is dropped when the catalog says
 * that capability is off: a thinking budget says how much a model thinks, not
 * that it thinks, and is not emitted for a model served as non-reasoning.
 *
 * The surface a provider's gateway endpoint speaks used to live here, because
 * the catalog served a list of provider ids and nothing else about routing.
 * The catalog now serves a surface per model, so the generator derives the
 * routing table from it and this file no longer names a vendor's surface. What
 * remains below is client-side: which providers this package may use a native
 * transport with, the surface it assumes for a provider the catalog says
 * nothing about, and the gateway path it builds.
 *
 * @module scripts/build/model-catalog-overlay
 */

/** Model-specific transport capabilities, as the generated module declares them. */
export type OverlayTransportCapabilities = {
  readonly anthropicThinkingMode?: "adaptive";
  readonly openAITransport?: "chat-completions" | "responses";
  readonly openAIChatReasoningWithFunctionTools?: boolean;
};

/** Every hand-maintained fact the generator merges into the catalog data. */
export type ModelCatalogOverlay = {
  /**
   * Providers that implement their surface natively rather than only speaking
   * its wire format. The served catalog names the surface a provider's gateway
   * endpoint speaks, never how the provider relates to it, and the runtime
   * reads this per provider: on the OpenAI surface a native provider may use
   * the Responses transport, and the others keep to Chat Completions.
   */
  readonly nativeProviders: readonly string[];
  /**
   * Surface assumed for a provider the served catalog names no surface for.
   * Which surfaces this package can speak at all is its own fact, not the
   * platform's.
   */
  readonly defaultSurface: string;
  /** Leading gateway path segments, shared by every surface. */
  readonly gatewayPathPrefix: string;
  /** Gateway API version per surface. */
  readonly surfaceGatewayApiVersions: readonly (readonly [string, string])[];
  /** Gateway API version used for a surface without its own entry. */
  readonly defaultGatewayApiVersion: string;
  /**
   * Entry ID published for a model whose served ID is not the short ID users
   * type. The served payload lists accepted aliases but designates none of
   * them as the published ID, so the choice cannot be derived from it.
   * Keyed by canonical model ID.
   */
  readonly entryIds: readonly (readonly [string, string])[];
  /**
   * Default thinking budget in tokens, keyed by canonical model ID. The
   * served catalog reports whether a model reasons, never a budget.
   */
  readonly thinkingBudgetTokens: readonly (readonly [string, number])[];
  /**
   * Whether a model's Chat transport can combine reasoning with function
   * tools, keyed by canonical model ID. The served catalog names the
   * transport but not this constraint on it.
   */
  readonly openAIChatReasoningWithFunctionTools:
    readonly (readonly [string, boolean])[];
  /**
   * Transport capabilities for models the catalog no longer serves but this
   * package still resolves options for, keyed by canonical model ID. Dropping
   * one would silently change how an existing request is built, so it is kept
   * until nothing in `src/` names the model. An entry here is ignored once the
   * catalog serves the model again.
   */
  readonly retainedTransportCapabilities:
    readonly (readonly [string, OverlayTransportCapabilities])[];
  /**
   * Provider aliases the runtime keeps accepting whether or not the served
   * catalog still implies them. The generator derives an alias from every
   * served model id whose provider segment differs from its provider
   * (`google-ai-studio/foo` for `google`), but that derivation lasts only as
   * long as a served model spells it. An alias here is a contract with
   * existing callers, so it stays in the table after the catalog moves on.
   * Keyed by alias; the value is the canonical provider, which the catalog
   * must still serve.
   */
  readonly retainedProviderAliases: readonly (readonly [string, string])[];
};

/** The overlay the generator merges. Edit this by hand; edit nothing generated. */
export const MODEL_CATALOG_OVERLAY: ModelCatalogOverlay = {
  nativeProviders: ["anthropic", "openai", "google"],
  defaultSurface: "openai",
  gatewayPathPrefix: "ai/gateway",
  surfaceGatewayApiVersions: [
    ["anthropic", "v1"],
    ["openai", "v1"],
    ["google", "v1beta"],
  ],
  defaultGatewayApiVersion: "v1",
  entryIds: [
    ["anthropic/claude-opus-4-8", "opus"],
    ["anthropic/claude-sonnet-4-6", "sonnet"],
    ["anthropic/claude-haiku-4-5-20251001", "haiku"],
  ],
  thinkingBudgetTokens: [
    ["anthropic/claude-opus-4-8", 2048],
    ["anthropic/claude-opus-4-6", 2048],
    ["anthropic/claude-sonnet-4-6", 2048],
    ["anthropic/claude-haiku-4-5-20251001", 1024],
  ],
  openAIChatReasoningWithFunctionTools: [
    ["openai/gpt-5.4", false],
    ["openai/gpt-5.5", false],
  ],
  retainedTransportCapabilities: [
    // Still named by `src/agent/runtime/model-capabilities.ts` and pinned by
    // the catalog and hosted-runtime tests, so the package keeps resolving
    // adaptive thinking for it after the catalog stopped listing it.
    ["anthropic/claude-opus-4-7", { anthropicThinkingMode: "adaptive" }],
  ],
  retainedProviderAliases: [
    // Pinned by `src/provider/veryfront-cloud/gateway-routing.test.ts`: a
    // `google-ai-studio/...` id routes through Google whatever the catalog
    // currently spells its Gemini ids as.
    ["google-ai-studio", "google"],
  ],
};
