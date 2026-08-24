/**
 * Register in-process ONNX inference as the `local` LLM provider.
 *
 * @module extensions/ext-llm-onnx
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { LLMProviderRegistry } from "veryfront/extensions/llm";
import { LLMProviderRegistryName } from "veryfront/extensions/llm";
import { OnnxProvider } from "./onnx-provider.ts";

const extOnnx: ExtensionFactory = () => {
  const provider = new OnnxProvider();
  let registry: LLMProviderRegistry | undefined;
  let registeredProvider = false;

  return {
    name: "ext-llm-onnx",
    version: "0.1.0",
    contracts: {
      provides: ["LLMProvider:local"],
      requires: [LLMProviderRegistryName],
    },
    capabilities: [],
    setup(ctx) {
      registry = ctx.require<LLMProviderRegistry>(LLMProviderRegistryName);
      registeredProvider = !registry.has(provider.id);
      registry.register(provider);
      ctx.provide("LLMProvider:local", registry.get(provider.id) ?? provider);
      ctx.logger.debug("[ext-llm-onnx] Local ONNX provider registered");
    },
    teardown() {
      if (registeredProvider) registry?.unregister(provider.id);
      registeredProvider = false;
      registry = undefined;
    },
  };
};

export default extOnnx;
export { OnnxProvider } from "./onnx-provider.ts";
export { createLocalEmbeddingModel } from "./embedding-runtime-adapter.ts";
export { embedTexts } from "./local-embedding-engine.ts";
export {
  createLocalAIDisabledError,
  getLocalAIDevice,
  getLocalAIThinkingEnabled,
  isLocalAIDisabled,
  type LocalAIDevice,
  throwIfLocalAIDisabled,
} from "./env.ts";
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
  type ModelInfo,
  resolveLocalEmbeddingModel,
  resolveLocalModel,
} from "./model-catalog.ts";
export { createLocalModel } from "./model-runtime-adapter.ts";
