import { createError, toError } from "#veryfront/errors";
import { AsyncLocalStorage } from "node:async_hooks";
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
import { AnthropicProvider } from "@veryfront/ext-llm-anthropic";
import { GoogleProvider } from "@veryfront/ext-llm-google";

const trustedAnthropicProvider = new AnthropicProvider();
const trustedGoogleProvider = new GoogleProvider();

const inferenceCredentialStorage = new AsyncLocalStorage<string>();
const IntrinsicReflectApply = Reflect.apply;
const IntrinsicObjectDefineProperty = Object.defineProperty;
const AsyncLocalStorageGetStore = AsyncLocalStorage.prototype.getStore;
const AsyncLocalStorageRun = AsyncLocalStorage.prototype.run;
IntrinsicObjectDefineProperty(inferenceCredentialStorage, "getStore", {
  configurable: false,
  value: AsyncLocalStorageGetStore,
  writable: false,
});
IntrinsicObjectDefineProperty(inferenceCredentialStorage, "run", {
  configurable: false,
  value: AsyncLocalStorageRun,
  writable: false,
});

/** @internal Keep run-bound gateway authority outside public/project credential contexts. */
export function runWithVeryfrontCloudInferenceCredential<T>(
  credential: string | undefined,
  operation: () => T,
): T {
  if (!credential) return operation();
  return IntrinsicReflectApply(AsyncLocalStorageRun, inferenceCredentialStorage, [
    credential,
    operation,
  ]) as T;
}

function getCurrentInferenceCredential(): string | undefined {
  return IntrinsicReflectApply(
    AsyncLocalStorageGetStore,
    inferenceCredentialStorage,
    [],
  ) as string | undefined;
}

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
  const inferenceCredential = getCurrentInferenceCredential();
  const { apiBaseUrl, apiToken, projectSlug } = requireVeryfrontCloudBootstrap(
    inferenceCredential,
  );
  const baseURL = getVeryfrontCloudGatewayBaseUrl(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken, baseURL, projectSlug);
  // Project extensions may replace registry providers. A signed inference
  // credential therefore uses only first-party transports that project code
  // cannot replace; ordinary project credentials retain extension behavior.
  const registry = inferenceCredential ? undefined : ensureBuiltinLLMProviders();

  switch (provider) {
    case "anthropic": {
      const anthropic = inferenceCredential ? trustedAnthropicProvider : registry?.get("anthropic");
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
      const google = inferenceCredential ? trustedGoogleProvider : registry?.get("google");
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
      const openai = registry?.get("openai");
      const openAITransport = resolveVeryfrontCloudOpenAITransport(
        `openai/${upstreamModelId}`,
      );
      const openAIChatReasoningWithFunctionTools =
        resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(
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
            openAIChatReasoningWithFunctionTools,
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
          openAIChatReasoningWithFunctionTools,
          openAITransport,
          fetch,
        }),
        provider,
      );
    }

    case "mistral":
    case "moonshotai": {
      const openai = registry?.get("openai");
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
