import { createAnthropicProviderModel } from "@veryfront/ext-llm-anthropic";
import { createGoogleProviderModel } from "@veryfront/ext-llm-google";

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
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAITransport,
} from "./model-catalog.ts";

const GATEWAY_PROVIDER_CREDENTIAL = "veryfront-cloud-gateway";

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

function createVeryfrontCloudModelInternal(
  modelId: string,
  inferenceCredential?: string,
): ModelRuntime {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "language");
  const { apiBaseUrl, apiToken, projectSlug } = requireVeryfrontCloudBootstrap(
    inferenceCredential,
  );
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken, baseURL, projectSlug, {
    inferenceCredential: inferenceCredential !== undefined,
  });
  // Native provider request builders require a credential, but the guarded
  // gateway fetch owns the real run-scoped token and replaces native auth.
  const providerCredential = inferenceCredential ? GATEWAY_PROVIDER_CREDENTIAL : apiToken;
  // Project extensions may replace registry providers. A signed inference
  // credential therefore uses only first-party transports that project code
  // cannot replace; ordinary project credentials retain extension behavior.
  const registry = inferenceCredential ? undefined : ensureBuiltinLLMProviders();

  switch (provider) {
    case "anthropic": {
      const anthropic = registry?.get("anthropic");
      if (anthropic) {
        return wrapVeryfrontCloudModel(
          anthropic.createModel(upstreamModelId, {
            credential: providerCredential,
            authToken: providerCredential,
            baseURL,
            name: "veryfront-cloud",
            fetch,
          }),
          provider,
        );
      }
      if (inferenceCredential) {
        return wrapVeryfrontCloudModel(
          createAnthropicProviderModel(upstreamModelId, {
            credential: providerCredential,
            authToken: providerCredential,
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
      const google = registry?.get("google");
      if (google) {
        return wrapVeryfrontCloudModel(
          google.createModel(upstreamModelId, {
            credential: providerCredential,
            baseURL,
            name: "veryfront-cloud",
            fetch,
          }),
          provider,
        );
      }
      if (inferenceCredential) {
        return wrapVeryfrontCloudModel(
          createGoogleProviderModel(upstreamModelId, {
            credential: providerCredential,
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
      const openAITransport = resolveVeryfrontCloudOpenAITransport(
        `openai/${upstreamModelId}`,
      );
      const openAIChatReasoningWithFunctionTools =
        resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(
          `openai/${upstreamModelId}`,
        );
      if (shouldUseOpenAIResponsesRuntime(upstreamModelId)) {
        if (inferenceCredential) {
          return wrapVeryfrontCloudModel(
            createVeryfrontCloudOpenAIResponsesModel(upstreamModelId, {
              apiToken: providerCredential,
              baseURL,
              fetch,
            }),
            provider,
          );
        }
        const openai = registry?.get("openai");
        if (openai?.createResponses) {
          return wrapVeryfrontCloudModel(
            openai.createResponses(upstreamModelId, {
              credential: providerCredential,
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
            apiToken: providerCredential,
            baseURL,
            fetch,
          }),
          provider,
        );
      }

      if (inferenceCredential) {
        return wrapVeryfrontCloudModel(
          createVeryfrontCloudOpenAIModel(upstreamModelId, {
            apiToken: providerCredential,
            baseURL,
            openAIChatReasoningWithFunctionTools,
            openAITransport,
            fetch,
          }),
          provider,
        );
      }
      const openai = registry?.get("openai");
      if (openai) {
        return wrapVeryfrontCloudModel(
          openai.createModel(upstreamModelId, {
            credential: providerCredential,
            baseURL,
            name: "veryfront-cloud",
            providerName: "veryfront-cloud",
            openAIChatReasoningWithFunctionTools,
            openAITransport,
            fetch,
          }),
          provider,
        );
      }
      return wrapVeryfrontCloudModel(
        createVeryfrontCloudOpenAIModel(upstreamModelId, {
          apiToken: providerCredential,
          baseURL,
          openAIChatReasoningWithFunctionTools,
          openAITransport,
          fetch,
        }),
        provider,
      );
    }

    case "mistral":
    case "moonshotai": {
      if (inferenceCredential) {
        return wrapVeryfrontCloudModel(
          createVeryfrontCloudOpenAIModel(upstreamModelId, {
            apiToken: providerCredential,
            baseURL,
            fetch,
          }),
          provider,
        );
      }
      const openai = registry?.get("openai");
      if (openai) {
        return wrapVeryfrontCloudModel(
          openai.createModel(upstreamModelId, {
            credential: providerCredential,
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
          apiToken: providerCredential,
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

export function createVeryfrontCloudModel(modelId: string): ModelRuntime {
  return createVeryfrontCloudModelInternal(modelId);
}

/** @internal Build a first-party gateway model with explicit run-scoped authority. */
export function createVeryfrontCloudInferenceModel(
  modelId: string,
  inferenceCredential: string,
): ModelRuntime {
  return createVeryfrontCloudModelInternal(modelId, inferenceCredential);
}
