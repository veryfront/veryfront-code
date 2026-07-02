import type { EmbeddingRuntime, ModelRuntime } from "#veryfront/provider/types.ts";
import { OpenAIProvider } from "@veryfront/ext-llm-openai";

const openLLMProvider = new OpenAIProvider();

interface VeryfrontCloudOpenAIConfig {
  apiToken: string;
  baseURL: string;
  fetch: typeof globalThis.fetch;
}

export function createVeryfrontCloudOpenAIModel(
  modelId: string,
  config: VeryfrontCloudOpenAIConfig,
): ModelRuntime {
  return openLLMProvider.createModel(modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    fetch: config.fetch,
  });
}

export function createVeryfrontCloudOpenAIResponsesModel(
  modelId: string,
  config: VeryfrontCloudOpenAIConfig,
): ModelRuntime {
  return openLLMProvider.createResponses(modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    fetch: config.fetch,
  });
}

export function createVeryfrontCloudOpenAIEmbeddingModel(
  modelId: string,
  config: VeryfrontCloudOpenAIConfig,
): EmbeddingRuntime {
  return openLLMProvider.createEmbedding(modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    fetch: config.fetch,
  });
}
