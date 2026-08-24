import type { LLMProvider, LLMProviderConfig } from "veryfront/extensions/llm";
import type { EmbeddingRuntime, ModelRuntime } from "veryfront/provider/types";
import { createLocalEmbeddingModel } from "./embedding-runtime-adapter.ts";
import { DEFAULT_LOCAL_EMBEDDING_MODEL } from "./model-catalog.ts";
import { createLocalModel } from "./model-runtime-adapter.ts";

/** In-process ONNX provider exposed through the stable `local/*` model prefix. */
export class OnnxProvider implements LLMProvider {
  readonly id = "local";
  readonly defaultEmbeddingModelId = DEFAULT_LOCAL_EMBEDDING_MODEL;

  createModel(modelId: string, _config: LLMProviderConfig): ModelRuntime {
    return createLocalModel(modelId);
  }

  createEmbedding(modelId: string, _config: LLMProviderConfig): EmbeddingRuntime {
    return createLocalEmbeddingModel(modelId);
  }
}
