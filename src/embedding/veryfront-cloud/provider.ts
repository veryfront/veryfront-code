import { createError, toError } from "#veryfront/errors";
import { createGoogleProviderEmbedding } from "@veryfront/ext-llm-google";
import { getHostSecret } from "#veryfront/platform/compat/process/env.ts";
import type { EmbeddingRuntime } from "#veryfront/provider/types.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { LLMProviderRegistry } from "#veryfront/extensions/llm/index.ts";
import { LLMProviderRegistryName } from "#veryfront/extensions/llm/index.ts";
import {
  createVeryfrontCloudFetch,
  getVeryfrontCloudGatewayBaseUrl,
  parseVeryfrontCloudModelId,
  requireVeryfrontCloudBootstrap,
} from "#veryfront/provider/veryfront-cloud/shared.ts";
import { createVeryfrontCloudOpenAIEmbeddingModel } from "#veryfront/provider/veryfront-cloud/openai.ts";

const randomUUID = crypto.randomUUID.bind(crypto);

export function createVeryfrontCloudEmbeddingModel(modelId: string): EmbeddingRuntime {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "embedding");
  const { apiBaseUrl, apiToken } = requireVeryfrontCloudBootstrap();
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken, baseURL);
  const usesHostPrivateCredential = getHostSecret("VERYFRONT_API_TOKEN") === apiToken;
  const providerCredential = usesHostPrivateCredential
    ? `vf-placeholder-${randomUUID()}`
    : apiToken;

  switch (provider) {
    case "openai":
      return createVeryfrontCloudOpenAIEmbeddingModel(upstreamModelId, {
        apiToken: providerCredential,
        baseURL,
        fetch,
      });

    case "google": {
      if (usesHostPrivateCredential) {
        return createGoogleProviderEmbedding(upstreamModelId, {
          credential: providerCredential,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        });
      }
      const registry = tryResolve<LLMProviderRegistry>(LLMProviderRegistryName);
      const google = registry?.get("google");
      if (google?.createEmbedding) {
        return google.createEmbedding(upstreamModelId, {
          credential: providerCredential,
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
