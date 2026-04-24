import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  createAnthropicModelRuntime,
  createGoogleModelRuntime,
  createOpenAIModelRuntime,
} from "../runtime-loader.ts";
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
    case "anthropic":
      return createAnthropicModelRuntime({
        authToken: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }, upstreamModelId);

    case "google":
      return createGoogleModelRuntime({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }, upstreamModelId);

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
      return createOpenAIModelRuntime({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }, upstreamModelId);
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
