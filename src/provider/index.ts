/**
 * Model provider registry and runtime resolution.
 *
 * @module provider
 *
 * @example Resolve a model
 * ```ts
 * import { resolveModel } from "veryfront/provider";
 *
 * const model = resolveModel("veryfront-cloud/openai/gpt-5-nano");
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
export type { ModelProviderFactory, ModelProviderRegistrationDisposer } from "./model-registry.ts";
export type { ModelRuntime } from "./types.ts";
export type {
  VeryfrontCloudModelId,
  VeryfrontCloudProviderId,
  VeryfrontCloudRuntimeModelId,
} from "./veryfront-cloud/model-catalog.ts";
export {
  DEFAULT_VERYFRONT_CLOUD_MODEL_ID,
  findVeryfrontCloudModel,
  findVeryfrontCloudModelByModelId,
  getVeryfrontCloudProviderFromModelId,
  groupVeryfrontCloudModelsByProvider,
  normalizeVeryfrontCloudModelId,
  resolveHostedVeryfrontCloudModelId,
  resolveVeryfrontCloudDefaultModelId,
  resolveVeryfrontCloudGatewayModelId,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
  tryGetVeryfrontCloudProviderFromModelId,
  VERYFRONT_CLOUD_CHAT_MODELS,
  VERYFRONT_CLOUD_MODEL_PREFIX,
} from "./veryfront-cloud/model-catalog.ts";
export { loadVeryfrontCloudModelCatalog } from "./veryfront-cloud/shared.ts";
export type {
  VeryfrontCloudChatModel,
  VeryfrontCloudModelThinkingConfig,
} from "./veryfront-cloud/model-catalog.ts";
