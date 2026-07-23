/**
 * Contract interface for LLM provider extensions.
 *
 * A single `LLMProviderRegistry` impl lives in the contract registry under
 * {@link LLMProviderRegistryName}. Each provider extension resolves the
 * registry in its `setup()` and calls `registry.register(provider)`.
 * Core consumers (model-registry, veryfront-cloud) resolve the registry
 * and dispatch on provider id parsed from `"provider/model"` strings.
 *
 * @module extensions/llm/llm-provider
 */

import type { EmbeddingRuntime, ModelRuntime } from "#veryfront/provider/types.ts";

export type { EmbeddingRuntime, ModelRuntime } from "#veryfront/provider/types.ts";

/** Config passed to any provider's create* method. */
export interface LLMProviderConfig {
  /** API credential mapped to the provider's authentication option. */
  credential: string;
  /** Override the provider's base URL (e.g. Azure OpenAI, self-hosted gateway). */
  baseURL?: string;
  /** Override fetch (veryfront-cloud uses this to inject project auth headers). */
  fetch?: typeof fetch;
  /** Display name shown in errors + telemetry. Defaults to provider id. */
  name?: string;
  /** Provider-specific extras. */
  [key: string]: unknown;
}

/**
 * An LLM provider implementation. Extensions register one of these with the
 * {@link LLMProviderRegistry} during setup(). `createModel` is required;
 * `createEmbedding` and `createResponses` are optional and absent on
 * providers that don't support them.
 */
export interface LLMProvider {
  /** Stable id using 1 to 128 alphanumeric, `.`, `_`, `:`, or `-` characters. */
  readonly id: string;
  /** Create a text model runtime for `modelId`. */
  createModel(modelId: string, config: LLMProviderConfig): ModelRuntime;
  /** Create an embedding runtime when the provider supports embeddings. */
  createEmbedding?(modelId: string, config: LLMProviderConfig): EmbeddingRuntime;
  /** Create a Responses API runtime when the provider supports it. */
  createResponses?(modelId: string, config: LLMProviderConfig): ModelRuntime;
}

/** Registry contract. Single impl created at bootstrap. */
export interface LLMProviderRegistry {
  /** Register up to 256 providers. Conflicting duplicate ids throw. */
  register(provider: LLMProvider): void;
  /** Remove the provider registered for `id`. */
  unregister(id: string): void;
  /** Return the provider registered for `id`, if one exists. */
  get(id: string): LLMProvider | undefined;
  /** Return the provider registered for `id` or throw. */
  require(id: string): LLMProvider;
  /** Return registered providers in insertion order. */
  list(): LLMProvider[];
  /** Return whether a provider is registered for `id`. */
  has(id: string): boolean;
}

/** Contract name used for `resolve()` / `provide()`. */
export const LLMProviderRegistryName = "LLMProviderRegistry" as const;
