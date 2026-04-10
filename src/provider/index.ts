/**
 * Provider registry.
 *
 * Maps "provider/model" strings to framework-compatible model runtimes.
 * Auto-initializes built-in providers from environment variables on first use.
 *
 * @module provider
 *
 * @example Resolve a model
 * ```ts
 * import { resolveModel } from "veryfront/provider";
 *
 * const model = resolveModel("veryfront-cloud/openai/gpt-5.2");
 * ```
 */

export {
  clearModelProviders,
  ensureModelReady,
  findAvailableCloudModel,
  getRegisteredModelProviders,
  hasModelProvider,
  registerModelProvider,
  resolveModel,
} from "./model-registry.ts";
export type { ModelProviderFactory } from "./model-registry.ts";
export type { ModelRuntime } from "./types.ts";
export {
  runWithVeryfrontCloudContext,
  runWithVeryfrontCloudContextAsync,
} from "./veryfront-cloud/context.ts";
export type { VeryfrontCloudContext } from "./veryfront-cloud/context.ts";
