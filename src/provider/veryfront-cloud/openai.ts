import type { EmbeddingRuntime, ModelRuntime } from "#veryfront/provider/types.ts";
import { OpenAIProvider } from "@veryfront/ext-llm-openai";

const openLLMProvider = new OpenAIProvider();
const IntrinsicReflectApply = Reflect.apply;
const openLLMProviderCreateModel = OpenAIProvider.prototype.createModel;
const openLLMProviderCreateResponses = OpenAIProvider.prototype.createResponses;
const openLLMProviderCreateEmbedding = OpenAIProvider.prototype.createEmbedding;

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
  return IntrinsicReflectApply(openLLMProviderCreateModel, openLLMProvider, [modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    providerName: "veryfront-cloud",
    openAIChatReasoningWithFunctionTools: config.openAIChatReasoningWithFunctionTools,
    openAITransport: config.openAITransport,
    fetch: config.fetch,
  }]) as ModelRuntime;
}

export function createVeryfrontCloudOpenAIResponsesModel(
  modelId: string,
  config: VeryfrontCloudOpenAIConfig,
): ModelRuntime {
  return IntrinsicReflectApply(openLLMProviderCreateResponses, openLLMProvider, [modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    providerName: "veryfront-cloud",
    fetch: config.fetch,
  }]) as ModelRuntime;
}

export function createVeryfrontCloudOpenAIEmbeddingModel(
  modelId: string,
  config: VeryfrontCloudOpenAIConfig,
): EmbeddingRuntime {
  return IntrinsicReflectApply(openLLMProviderCreateEmbedding, openLLMProvider, [modelId, {
    credential: config.apiToken,
    baseURL: config.baseURL,
    name: "veryfront-cloud",
    fetch: config.fetch,
  }]) as EmbeddingRuntime;
}
