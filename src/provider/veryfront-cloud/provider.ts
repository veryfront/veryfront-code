import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import {
  createVeryfrontCloudFetch,
  getVeryfrontCloudGatewayBaseUrl,
  parseVeryfrontCloudModelId,
  requireVeryfrontCloudBootstrap,
} from "./shared.ts";

export function createVeryfrontCloudModel(modelId: string): LanguageModel {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "language");
  const { apiBaseUrl, apiToken } = requireVeryfrontCloudBootstrap();
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken);

  switch (provider) {
    case "anthropic":
      return createAnthropic({
        authToken: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      })(upstreamModelId);

    case "openai":
      return createOpenAI({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      })(upstreamModelId);

    case "google":
      return createGoogleGenerativeAI({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      })(upstreamModelId);

    case "moonshotai":
      return createOpenAI({
        apiKey: apiToken,
        baseURL,
        name: "veryfront-cloud",
        fetch,
      })(upstreamModelId);

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
