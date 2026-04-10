/**
 * Local LLM Provider
 *
 * Zero-configuration local model inference using `@huggingface/transformers`.
 * Enables instant chat functionality without API keys by running small
 * language models (SmolLM2) directly on the server via ONNX Runtime.
 *
 * @module provider/local
 *
 * @example Create a local model runtime
 * ```ts
 * import { createLocalModel } from "./local/index.ts";
 *
 * const model = createLocalModel("smollm2-135m");
 * // Use with the framework runtime, streamText(), generateText(), etc.
 * ```
 */

export { createLocalModel } from "./model-runtime-adapter.ts";
export { isLocalAIDisabled } from "./env.ts";
export { createLocalEmbeddingModel } from "./embedding-runtime-adapter.ts";
export { embedTexts } from "./local-embedding-engine.ts";
export {
  generate,
  generateStream,
  getTransformers,
  isModelLoaded,
  preloadModel,
  verifyLocalRuntime,
} from "./local-engine.ts";
export type { ChatMessage, GenerateOptions } from "./local-engine.ts";
export {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_LOCAL_MODEL,
  getLocalModelIds,
  resolveLocalEmbeddingModel,
  resolveLocalModel,
} from "./model-catalog.ts";
export type { ModelInfo } from "./model-catalog.ts";
