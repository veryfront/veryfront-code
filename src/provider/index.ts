/**
 * Unified LLM interface for Anthropic, Google, and OpenAI.
 *
 * @module provider
 *
 * @example Initialize providers
 * ```ts
 * import { initializeProviders } from "veryfront/provider";
 *
 * initializeProviders({
 *   openai: { apiKey: getEnv("OPENAI_API_KEY") },
 * });
 * ```
 *
 * @example Route to model
 * ```ts
 * import { initializeProviders, getProviderFromModel } from "veryfront/provider";
 *
 * initializeProviders({
 *   openai: { apiKey: getEnv("OPENAI_API_KEY") },
 *   anthropic: { apiKey: getEnv("ANTHROPIC_API_KEY") },
 * });
 *
 * const { provider, model } = getProviderFromModel("openai/gpt-4o");
 * const response = await provider.complete({
 *   model,
 *   messages: [{ role: "user", content: "Hello" }],
 * });
 * ```
 */

export type {
  AnthropicConfig,
  CompletionRequest,
  CompletionResponse,
  GoogleConfig,
  OpenAIConfig,
  Provider,
  ProviderConfig,
  ProvidersConfig,
} from "./types.ts";

export { BaseProvider } from "./base.ts";
export { AnthropicProvider } from "./anthropic.ts";
export { GoogleProvider } from "./google.ts";
export { OpenAIProvider } from "./openai.ts";
export { getProvider, getProviderFromModel, initializeProviders } from "./factory.ts";
