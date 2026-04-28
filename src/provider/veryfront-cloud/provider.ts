import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { resolve } from "#veryfront/extensions/contracts.ts";
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

  const registry = resolve<AIProviderRegistry>(AIProviderRegistryName);

  switch (provider) {
    case "anthropic":
    case "google": {
      const p = registry.require(provider);
      return p.createModel(upstreamModelId, {
        credential: apiToken,
        authToken: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      });
    }

    case "openai":
    case "moonshotai": {
      const p = registry.require("openai");
      return p.createModel(upstreamModelId, {
        credential: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      });
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
