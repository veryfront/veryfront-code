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
import {
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudOpenAITransport,
} from "./model-catalog.ts";

function wrapVeryfrontCloudModel(
  model: ModelRuntime,
  modelProvider: string,
): ModelRuntime {
  const wrapped = Object.create(model, {
    _generateViaStream: { enumerable: true, value: true },
    modelProvider: { enumerable: true, value: modelProvider },
  });

  Object.defineProperties(wrapped, {
    doGenerate: { value: model.doGenerate.bind(model) },
    doStream: { value: model.doStream.bind(model) },
    ...(model.prepare ? { prepare: { value: model.prepare.bind(model) } } : {}),
  });

  const forwardedAccessors = new Set<PropertyKey>();
  let source: object | null = model;
  while (source && source !== Object.prototype) {
    for (const key of Reflect.ownKeys(source)) {
      if (forwardedAccessors.has(key) || Object.hasOwn(wrapped, key)) continue;

      forwardedAccessors.add(key);
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor || (!descriptor.get && !descriptor.set)) continue;

      Object.defineProperty(wrapped, key, {
        ...descriptor,
        get: descriptor.get?.bind(model),
        set: descriptor.set?.bind(model),
      });
    }
    source = Object.getPrototypeOf(source);
  }

  return wrapped;
}

function shouldUseOpenAIResponsesRuntime(upstreamModelId: string): boolean {
  const transport = resolveVeryfrontCloudOpenAITransport(`openai/${upstreamModelId}`);
  if (transport !== undefined) return transport === "responses";
  return resolveVeryfrontCloudModelThinking(`openai/${upstreamModelId}`)?.enabled === true;
}

export function createVeryfrontCloudModel(modelId: string): ModelRuntime {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "language");
  const { apiBaseUrl, apiToken, projectSlug } = requireVeryfrontCloudBootstrap();
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken, baseURL, projectSlug);
  const registry = ensureBuiltinLLMProviders();

  switch (provider) {
    case "anthropic": {
      const anthropic = registry.get("anthropic");
      if (anthropic) {
        return wrapVeryfrontCloudModel(
          anthropic.createModel(upstreamModelId, {
            credential: apiToken,
            authToken: apiToken,
            baseURL,
            name: "veryfront-cloud",
            fetch,
          }),
          provider,
        );
      }
      break;
    }

    case "google": {
      const google = registry.get("google");
      if (google) {
        return wrapVeryfrontCloudModel(
          google.createModel(upstreamModelId, {
            credential: apiToken,
            baseURL,
            name: "veryfront-cloud",
            fetch,
          }),
          provider,
        );
      }
      break;
    }

    case "openai": {
      const openai = registry.get("openai");
      const openAITransport = resolveVeryfrontCloudOpenAITransport(
        `openai/${upstreamModelId}`,
      );
      if (shouldUseOpenAIResponsesRuntime(upstreamModelId)) {
        if (openai?.createResponses) {
          return wrapVeryfrontCloudModel(
            openai.createResponses(upstreamModelId, {
              credential: apiToken,
              baseURL,
              name: "veryfront-cloud",
              providerName: "veryfront-cloud",
              fetch,
            }),
            provider,
          );
        }
        return wrapVeryfrontCloudModel(
          createVeryfrontCloudOpenAIResponsesModel(upstreamModelId, {
            apiToken,
            baseURL,
            fetch,
          }),
          provider,
        );
      }

      if (openai) {
        return wrapVeryfrontCloudModel(
          openai.createModel(upstreamModelId, {
            credential: apiToken,
            baseURL,
            name: "veryfront-cloud",
            providerName: "veryfront-cloud",
            openAITransport,
            fetch,
          }),
          provider,
        );
      }
      return wrapVeryfrontCloudModel(
        createVeryfrontCloudOpenAIModel(upstreamModelId, {
          apiToken,
          baseURL,
          openAITransport,
          fetch,
        }),
        provider,
      );
    }

    case "mistral":
    case "moonshotai": {
      const openai = registry.get("openai");
      if (openai) {
        return wrapVeryfrontCloudModel(
          openai.createModel(upstreamModelId, {
            credential: apiToken,
            baseURL,
            name: "veryfront-cloud",
            providerName: "openai-compatible",
            fetch,
          }),
          provider,
        );
      }
      return wrapVeryfrontCloudModel(
        createVeryfrontCloudOpenAIModel(upstreamModelId, {
          apiToken,
          baseURL,
          fetch,
        }),
        provider,
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

  throw toError(
    createError({
      type: "config",
      message: `Language provider "${provider}" is not available for veryfront-cloud.`,
    }),
  );
}
