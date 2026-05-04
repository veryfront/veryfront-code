import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { createGoogleEmbeddingRuntime } from "#veryfront/provider/runtime-loader.ts";
import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import {
  createVeryfrontCloudFetch,
  getVeryfrontCloudGatewayBaseUrl,
  parseVeryfrontCloudModelId,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";
import { createVeryfrontCloudOpenAIEmbeddingModel } from "#veryfront/provider/veryfront-cloud/openai.ts";

export function createVeryfrontCloudEmbeddingModel(modelId: string): EmbeddingRuntime {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "embedding");
  const { apiBaseUrl, apiToken } = requireVeryfrontCloudBootstrap();
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken);

  switch (provider) {
    case "openai":
      return createVeryfrontCloudOpenAIEmbeddingModel(upstreamModelId, {
        apiToken,
        baseURL,
        fetch,
      });

    case "google":
      return createGoogleEmbeddingRuntime({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }, upstreamModelId);
  }

  throw toError(
    createError({
      type: "config",
      message: `Embedding provider "${provider}" is not supported for veryfront-cloud.`,
    }),
  );
}
