import type { EmbeddingModel } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  createVeryfrontCloudFetch,
  getVeryfrontCloudGatewayBaseUrl,
  parseVeryfrontCloudModelId,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";

export function createVeryfrontCloudEmbeddingModel(modelId: string): EmbeddingModel {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "embedding");
  const { apiBaseUrl, apiToken } = requireVeryfrontCloudBootstrap();
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken);

  switch (provider) {
    case "openai":
      return createOpenAI({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }).embedding(upstreamModelId);

    case "google":
      return createGoogleGenerativeAI({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }).textEmbeddingModel(upstreamModelId);
  }

  throw toError(
    createError({
      type: "config",
      message: `Embedding provider "${provider}" is not supported for veryfront-cloud.`,
    }),
  );
}
