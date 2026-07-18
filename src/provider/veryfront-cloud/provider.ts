import { createError, toError } from "#veryfront/errors";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import type { ModelRuntime } from "../types.ts";
import {
  createVeryfrontCloudFetch,
  getVeryfrontCloudGatewayBaseUrl,
  parseVeryfrontCloudModelId,
  requireVeryfrontCloudBootstrap,
} from "./shared.ts";
import {
  createVeryfrontCloudOpenAIModel,
  createVeryfrontCloudOpenAIResponsesModel,
} from "./openai.ts";
import { resolveVeryfrontCloudModelThinking } from "./model-catalog.ts";

function preferStreamedGenerate(model: ModelRuntime): ModelRuntime {
  return Object.assign(model, { _generateViaStream: true as const });
}

function shouldUseOpenAIResponsesRuntime(upstreamModelId: string): boolean {
  return resolveVeryfrontCloudModelThinking(`openai/${upstreamModelId}`)?.enabled === true;
}

export function createVeryfrontCloudModel(modelId: string): ModelRuntime {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "language");
  const { apiBaseUrl, apiToken, projectSlug } = requireVeryfrontCloudBootstrap();
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken, projectSlug);
  const registry = ensureBuiltinLLMProviders();

  switch (provider) {
    case "anthropic": {
      const anthropic = registry.get("anthropic");
      if (anthropic) {
        return preferStreamedGenerate(anthropic.createModel(upstreamModelId, {
          credential: apiToken,
          authToken: apiToken,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        }));
      }
      break;
    }

    case "google": {
      const google = registry.get("google");
      if (google) {
        return preferStreamedGenerate(google.createModel(upstreamModelId, {
          credential: apiToken,
          baseURL,
          name: "veryfront-cloud",
          fetch,
        }));
      }
      break;
    }

    case "openai": {
      const openai = registry.get("openai");
      if (shouldUseOpenAIResponsesRuntime(upstreamModelId)) {
        if (openai?.createResponses) {
          return preferStreamedGenerate(openai.createResponses(upstreamModelId, {
            credential: apiToken,
            baseURL,
            name: "veryfront-cloud",
            providerName: "veryfront-cloud",
            fetch,
          }));
        }
        return preferStreamedGenerate(createVeryfrontCloudOpenAIResponsesModel(upstreamModelId, {
          apiToken,
          baseURL,
          fetch,
        }));
      }

      if (openai) {
        return preferStreamedGenerate(openai.createModel(upstreamModelId, {
          credential: apiToken,
          baseURL,
          name: "veryfront-cloud",
          providerName: "veryfront-cloud",
          fetch,
        }));
      }
      return preferStreamedGenerate(createVeryfrontCloudOpenAIModel(upstreamModelId, {
        apiToken,
        baseURL,
        fetch,
      }));
    }

    case "mistral":
    case "moonshotai": {
      const openai = registry.get("openai");
      if (openai) {
        return preferStreamedGenerate(openai.createModel(upstreamModelId, {
          credential: apiToken,
          baseURL,
          name: "veryfront-cloud",
          providerName: "openai-compatible",
          fetch,
        }));
      }
      return preferStreamedGenerate(createVeryfrontCloudOpenAIModel(upstreamModelId, {
        apiToken,
        baseURL,
        fetch,
      }));
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

  throw toError(
    createError({
      type: "config",
      message: `Language provider "${provider}" is not available for veryfront-cloud.`,
    }),
  );
}
