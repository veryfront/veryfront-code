import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  createAnthropicModelRuntime,
  createGoogleModelRuntime,
  createOpenAIModelRuntime,
} from "../runtime-loader.ts";
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
    case "moonshotai":
      return createOpenAIModelRuntime({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      }, upstreamModelId);

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
