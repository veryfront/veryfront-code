/**
 * OpenAI provider — implements the {@link AIProvider} contract.
 *
 * Delegates to the legacy `createOpenAI*Runtime` factories still living in
 * core's `runtime-loader.ts`. Task 14 moves those factories into this file.
 */

import type {
  AIProvider,
  AIProviderConfig,
} from "veryfront/extensions/interfaces";
import type { EmbeddingRuntime, ModelRuntime } from "veryfront/provider/types";
import {
  createOpenAIEmbeddingRuntime,
  createOpenAIModelRuntime,
  createOpenAIResponsesRuntime,
} from "../../../src/provider/runtime-loader.ts";

export class OpenAIProvider implements AIProvider {
  readonly id = "openai";

  createModel(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIModelRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createEmbedding(modelId: string, config: AIProviderConfig): EmbeddingRuntime {
    return createOpenAIEmbeddingRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }

  createResponses(modelId: string, config: AIProviderConfig): ModelRuntime {
    return createOpenAIResponsesRuntime(
      {
        apiKey: config.credential,
        baseURL: config.baseURL,
        name: config.name ?? "openai",
        fetch: config.fetch,
      },
      modelId,
    );
  }
}
