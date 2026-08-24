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

/** Config passed to any provider's create* method. */
export interface LLMProviderConfig {
  /** Optional API credential. Credentialed providers validate it at their boundary. */
  credential?: string;
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
  /** Stable id used in model strings: "openai" / "anthropic" / "google". */
  readonly id: string;
  /** Provider model id used when automatic embedding selection chooses this provider. */
  readonly defaultEmbeddingModelId?: string;
  createModel(modelId: string, config: LLMProviderConfig): ModelRuntime;
  createEmbedding?(modelId: string, config: LLMProviderConfig): EmbeddingRuntime;
  createResponses?(modelId: string, config: LLMProviderConfig): ModelRuntime;
}

/** Require a non-empty credential at a credentialed provider boundary. */
export function requireLLMProviderCredential(
  config: LLMProviderConfig,
  providerName: string,
): string {
  const credential = config.credential;
  if (typeof credential !== "string" || credential.trim().length === 0) {
    throw new TypeError(`${providerName} provider requires a credential`);
  }
  return credential;
}

/** Registry contract. Single impl created at bootstrap. */
export interface LLMProviderRegistry {
  register(provider: LLMProvider): void;
  unregister(id: string): void;
  get(id: string): LLMProvider | undefined;
  require(id: string): LLMProvider;
  list(): LLMProvider[];
  has(id: string): boolean;
}

/** Contract name used for `resolve()` / `provide()`. */
export const LLMProviderRegistryName = "LLMProviderRegistry" as const;
