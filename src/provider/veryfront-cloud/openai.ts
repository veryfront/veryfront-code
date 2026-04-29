import type { EmbeddingRuntime, ModelRuntime } from "#veryfront/provider/types.ts";
import { OpenAIProvider } from "../../../extensions/ext-openai/src/openai-provider.ts";

const openAIProvider = new OpenAIProvider();

interface VeryfrontCloudOpenAIConfig {
  apiToken: string;
  baseURL: string;
  fetch: typeof globalThis.fetch;
}

export function createVeryfrontCloudOpenAIModel(
  modelId: string,
  config: VeryfrontCloudOpenAIConfig,
): ModelRuntime {
  return openAIProvider.createModel(modelId, {
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
  return openAIProvider.createEmbedding(modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    fetch: config.fetch,
  });
}
