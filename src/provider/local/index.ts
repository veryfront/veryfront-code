/**
 * Local LLM Provider
 *
 * Zero-configuration local model inference using `@huggingface/transformers`.
 * Enables instant chat functionality without API keys by running small
 * language models (SmolLM2) directly on the server via ONNX Runtime.
 *
 * @module provider/local
 *
 * @example Create a local model for AI SDK
 * ```ts
 * import { createLocalModel } from "./local/index.ts";
 *
 * const model = createLocalModel("smollm2-135m");
 * // Use with streamText(), generateText(), useChat(), etc.
 * ```
 */

export { createLocalModel } from "./ai-sdk-adapter.ts";
export { generate, generateStream, isModelLoaded, preloadModel } from "./local-engine.ts";
export type { ChatMessage, GenerateOptions } from "./local-engine.ts";
export { DEFAULT_LOCAL_MODEL, getLocalModelIds, resolveLocalModel } from "./model-catalog.ts";
export type { ModelInfo } from "./model-catalog.ts";
