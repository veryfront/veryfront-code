import type { EmbeddingRuntime, ModelRuntime } from "#veryfront/provider/types.ts";
import {
  createOpenAIProviderEmbedding,
  createOpenAIProviderModel,
  createOpenAIProviderResponses,
} from "@veryfront/ext-llm-openai";

interface VeryfrontCloudOpenAIConfig {
  apiToken: string;
  baseURL: string;
  openAIChatReasoningWithFunctionTools?: boolean;
  openAITransport?: "chat-completions" | "responses";
  fetch: typeof globalThis.fetch;
}

export function createVeryfrontCloudOpenAIModel(
  modelId: string,
  config: VeryfrontCloudOpenAIConfig,
): ModelRuntime {
  return createOpenAIProviderModel(modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    providerName: "veryfront-cloud",
    openAIChatReasoningWithFunctionTools: config.openAIChatReasoningWithFunctionTools,
    openAITransport: config.openAITransport,
    fetch: config.fetch,
  });
}

export function createVeryfrontCloudOpenAIResponsesModel(
  modelId: string,
  config: VeryfrontCloudOpenAIConfig,
): ModelRuntime {
  return createOpenAIProviderResponses(modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    providerName: "veryfront-cloud",
    fetch: config.fetch,
  });
}

export function createVeryfrontCloudOpenAIEmbeddingModel(
  modelId: string,
  config: VeryfrontCloudOpenAIConfig,
): EmbeddingRuntime {
  return createOpenAIProviderEmbedding(modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    fetch: config.fetch,
  });
}
