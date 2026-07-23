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

/** Enable streamed generation without breaking class or private-field runtime receivers. */
export function preferStreamedGenerate(model: ModelRuntime): ModelRuntime {
  try {
    Object.defineProperty(model, "_generateViaStream", {
      configurable: false,
      enumerable: true,
      value: true,
      writable: false,
    });
    return model;
  } catch {
    try {
      const wrapperTarget = Object.create(Object.getPrototypeOf(model)) as ModelRuntime;
      return new Proxy(wrapperTarget, {
        get(_target, property) {
          if (property === "_generateViaStream") return true;
          const value = Reflect.get(model, property, model);
          return typeof value === "function" ? value.bind(model) : value;
        },
        has(_target, property) {
          return property === "_generateViaStream" || Reflect.has(model, property);
        },
        set(_target, property, value) {
          return Reflect.set(model, property, value, model);
        },
      });
    } catch {
      throw toError(createError({
        type: "config",
        message: "Veryfront Cloud provider returned an invalid model runtime.",
      }));
    }
  }
}

function shouldUseOpenAIResponsesRuntime(upstreamModelId: string): boolean {
  return resolveVeryfrontCloudModelThinking(`openai/${upstreamModelId}`)?.enabled === true;
}

export function createVeryfrontCloudModel(modelId: string): ModelRuntime {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "language");
  const { apiBaseUrl, apiToken, projectSlug } = requireVeryfrontCloudBootstrap();
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken, projectSlug, baseURL);
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
