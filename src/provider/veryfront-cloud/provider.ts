import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { AIProviderRegistry } from "#veryfront/extensions/interfaces/index.ts";
import { AIProviderRegistryName } from "#veryfront/extensions/interfaces/index.ts";
import type { ModelRuntime } from "../types.ts";
import {
  createVeryfrontCloudFetch,
  getVeryfrontCloudGatewayBaseUrl,
  parseVeryfrontCloudModelId,
  requireVeryfrontCloudBootstrap,
} from "./shared.ts";

export function createVeryfrontCloudModel(modelId: string): ModelRuntime {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "language");
  const { apiBaseUrl, apiToken, projectSlug } = requireVeryfrontCloudBootstrap();
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken, projectSlug);

  switch (provider) {
    case "anthropic": {
      const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
      const anthropic = registry?.get("anthropic");
      if (anthropic) {
        return anthropic.createModel(upstreamModelId, {
          credential: apiToken,
          authToken: apiToken,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        });
      }
      throw new Error(
        "Anthropic provider not installed. Add @veryfront/ext-anthropic to use anthropic/* models via veryfront-cloud.",
      );
    }

    case "google": {
      const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
      const google = registry?.get("google");
      if (google) {
        return google.createModel(upstreamModelId, {
          credential: apiToken,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        });
      }
      throw new Error(
        "Google provider not installed. Add @veryfront/ext-google to use google/* models via veryfront-cloud.",
      );
    }

    case "openai":
    case "moonshotai": {
      const registry = tryResolve<AIProviderRegistry>(AIProviderRegistryName);
      const openai = registry?.get("openai");
      if (openai) {
        return openai.createModel(upstreamModelId, {
          credential: apiToken,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        });
      }
      throw new Error(
        "OpenAI provider not installed. Add @veryfront/ext-openai to use openai/moonshotai models via veryfront-cloud.",
      );
    }

    default: {
      const _exhaustive: never = provider;
      throw toError(
        createError({
          type: "config",
          message: `Language provider "${_exhaustive}" is not supported for veryfront-cloud.`,
        }),
      );
    }
  }
}
