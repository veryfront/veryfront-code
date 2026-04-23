/**
 * Contract interface for LLM provider extensions.
 *
 * A single `AIProviderRegistry` impl lives in the contract registry under
 * {@link AIProviderRegistryName}. Each provider extension resolves the
 * registry in its `setup()` and calls `registry.register(provider)`.
 * Core consumers (model-registry, veryfront-cloud) resolve the registry
 * and dispatch on provider id parsed from `"provider/model"` strings.
 *
 * @module extensions/interfaces/ai-provider
 */

import type { EmbeddingRuntime, ModelRuntime } from "../../provider/types.ts";

/** Config passed to any provider's create* method. */
export interface AIProviderConfig {
  /** API credential — maps to OpenAI `apiKey`, Anthropic `authToken`, Google `apiKey` internally. */
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
 * {@link AIProviderRegistry} during setup(). `createModel` is required;
 * `createEmbedding` and `createResponses` are optional and absent on
 * providers that don't support them.
 */
export interface AIProvider {
  /** Stable id used in model strings: "openai" / "anthropic" / "google". */
  readonly id: string;
  createModel(modelId: string, config: AIProviderConfig): ModelRuntime;
  createEmbedding?(modelId: string, config: AIProviderConfig): EmbeddingRuntime;
  createResponses?(modelId: string, config: AIProviderConfig): ModelRuntime;
}

/** Registry contract. Single impl created at bootstrap. */
export interface AIProviderRegistry {
  register(provider: AIProvider): void;
  unregister(id: string): void;
  get(id: string): AIProvider | undefined;
  require(id: string): AIProvider;
  list(): AIProvider[];
  has(id: string): boolean;
}

/** Contract name used for `resolve()` / `provide()`. */
export const AIProviderRegistryName = "AIProviderRegistry" as const;
