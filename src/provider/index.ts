/**
 * AI SDK Model Provider Registry
 *
 * Maps "provider/model" strings to AI SDK LanguageModel instances.
 * Auto-initializes providers from environment variables on first use.
 *
 * @module provider
 *
 * @example Register and resolve a model
 * ```ts
 * import { registerModelProvider, resolveModel } from "veryfront/provider";
 * import { createOpenAI } from "@ai-sdk/openai";
 *
 * registerModelProvider("openai", (id) => createOpenAI({ apiKey })(id));
 * const model = resolveModel("openai/gpt-4o");
 * ```
 */

export {
  clearModelProviders,
  ensureModelReady,
  getRegisteredModelProviders,
  hasModelProvider,
  registerModelProvider,
  resolveModel,
} from "./model-registry.ts";
export type { ModelProviderFactory } from "./model-registry.ts";
