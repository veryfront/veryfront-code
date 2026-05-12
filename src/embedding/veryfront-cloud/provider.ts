import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { LLMProviderRegistry } from "#veryfront/extensions/interfaces/index.ts";
import { LLMProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
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

    case "google": {
      const registry = tryResolve<LLMProviderRegistry>(LLMProviderRegistryName);
      const google = registry?.get("google");
      if (google?.createEmbedding) {
        return google.createEmbedding(upstreamModelId, {
          credential: apiToken,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        });
      }
      throw toError(
        createError({
          type: "config",
          message:
            "Google provider not installed. Add @veryfront/ext-llm-google to use google/* embedding models via veryfront-cloud.",
        }),
      );
    }
  }

  throw toError(
    createError({
      type: "config",
      message: `Embedding provider "${provider}" is not supported for veryfront-cloud.`,
    }),
  );
}
