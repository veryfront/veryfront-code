/**
 * Catalog facts this package acts on that the served catalog does not carry.
 *
 * The generator merges this overlay into the data it builds from the served
 * catalog, so the generated module keeps behaviour the served payload cannot
 * express yet. Keep the overlay small: an entry belongs here only while no
 * served field evidences the same fact, and must be deleted as soon as one
 * does. Never add an entry here to override a field the catalog does serve.
 *
 * @module scripts/build/model-catalog-overlay
 */

/** Gateway routing for one provider, as the generated module declares it. */
export type OverlayProviderRouting = {
  /** Wire format spoken by the provider's gateway endpoint. */
  readonly surface: string;
  /** Whether the provider implements the surface natively. */
  readonly native?: boolean;
};

/** Model-specific transport capabilities, as the generated module declares them. */
export type OverlayTransportCapabilities = {
  readonly anthropicThinkingMode?: "adaptive";
  readonly openAITransport?: "chat-completions" | "responses";
  readonly openAIChatReasoningWithFunctionTools?: boolean;
};

/** Every hand-maintained fact the generator merges into the catalog data. */
export type ModelCatalogOverlay = {
  /**
   * Gateway routing per provider. The served catalog names no wire surface,
   * so routing cannot be derived from it.
   */
  readonly providerRouting:
    readonly (readonly [string, OverlayProviderRouting])[];
  /** Surface used for a provider this overlay does not list. */
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
};

/** The overlay the generator merges. Edit this by hand; edit nothing generated. */
export const MODEL_CATALOG_OVERLAY: ModelCatalogOverlay = {
  providerRouting: [
    ["anthropic", { surface: "anthropic", native: true }],
    ["openai", { surface: "openai", native: true }],
    ["google", { surface: "google", native: true }],
    ["mistral", { surface: "openai" }],
    ["moonshotai", { surface: "openai" }],
  ],
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
};
