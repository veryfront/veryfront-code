import { createAnthropicProviderModel } from "@veryfront/ext-llm-anthropic";
import { createGoogleProviderModel } from "@veryfront/ext-llm-google";

import { createError, toError } from "#veryfront/errors";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { getHostSecret } from "#veryfront/platform/compat/process/env.ts";

import type { ModelRuntime } from "../types.ts";
import { getCurrentVeryfrontCloudContext } from "./context.ts";
import {
  createVeryfrontCloudFetch,
  parseVeryfrontCloudModelId,
  requireVeryfrontCloudBootstrap,
  resolveVeryfrontCloudGatewayRoute,
} from "./shared.ts";
import {
  createVeryfrontCloudOpenAIModel,
  createVeryfrontCloudOpenAIResponsesModel,
} from "./openai.ts";
import {
  requireVeryfrontCloudWireSurface,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAIChatSystemMessages,
  resolveVeryfrontCloudOpenAITransportPlan,
  resolveVeryfrontCloudProviderRouting,
} from "./model-catalog.ts";

const IntrinsicReflectApply = Reflect.apply;
const HostCrypto = globalThis.crypto;
const CryptoRandomUuid = HostCrypto.randomUUID;
const FunctionBind = Function.prototype.bind;
const ObjectCreate = Object.create;
const ObjectDefineProperties = Object.defineProperties;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectHasOwn = Object.hasOwn;
const ObjectPrototype = Object.prototype;
const ReflectOwnKeys = Reflect.ownKeys;

function bindModelMethod<T extends (...args: never[]) => unknown>(
  method: T,
  model: ModelRuntime,
): T {
  return IntrinsicReflectApply(FunctionBind, method, [model]) as T;
}

function wrapVeryfrontCloudModel(
  model: ModelRuntime,
  modelProvider: string,
): ModelRuntime {
  const wrapped = ObjectCreate(model, {
    _generateViaStream: { enumerable: true, value: true },
    modelProvider: { enumerable: true, value: modelProvider },
  });

  ObjectDefineProperties(wrapped, {
    doGenerate: { value: bindModelMethod(model.doGenerate, model) },
    doStream: { value: bindModelMethod(model.doStream, model) },
    ...(model.prepare ? { prepare: { value: bindModelMethod(model.prepare, model) } } : {}),
  });

  const forwardedAccessors = new Set<PropertyKey>();
  let source: object | null = model;
  while (source && source !== ObjectPrototype) {
    for (const key of ReflectOwnKeys(source)) {
      if (forwardedAccessors.has(key) || ObjectHasOwn(wrapped, key)) continue;

      forwardedAccessors.add(key);
      const descriptor = ObjectGetOwnPropertyDescriptor(source, key);
      if (!descriptor || (!descriptor.get && !descriptor.set)) continue;

      ObjectDefineProperty(wrapped, key, {
        ...descriptor,
        get: descriptor.get ? bindModelMethod(descriptor.get, model) : undefined,
        set: descriptor.set ? bindModelMethod(descriptor.set, model) : undefined,
      });
    }
    source = ObjectGetPrototypeOf(source);
  }

  return wrapped;
}

function createVeryfrontCloudModelInternal(
  modelId: string,
  inferenceCredential?: string,
  options: {
    apiBaseUrl?: string;
    assertInferenceCredentialActive?: () => void;
    credentialSource?: "application";
    providerSelection?: "first-party";
    assertCredentialActive?: () => void;
  } = {},
): ModelRuntime {
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "language");
  const { apiBaseUrl, apiToken, projectSlug } = options.credentialSource === "application"
    ? requireApplicationBootstrap()
    : requireVeryfrontCloudBootstrap(inferenceCredential, options.apiBaseUrl);
  // Builders keep the upstream model id; on a vendor-neutral route the fetch
  // wrapper sends it as `<provider>/<id>`.
  const { baseURL, wireModelProvider } = resolveVeryfrontCloudGatewayRoute(apiBaseUrl, provider);
  const fetch = createVeryfrontCloudFetch(apiToken, baseURL, projectSlug, {
    inferenceCredential: inferenceCredential !== undefined,
    ...(wireModelProvider ? { wireModelProvider } : {}),
    ...(options.assertCredentialActive || options.assertInferenceCredentialActive
      ? {
        assertInferenceCredentialActive: options.assertCredentialActive ??
          options.assertInferenceCredentialActive,
      }
      : {}),
  });
  const usesHostPrivateCredential = inferenceCredential === undefined &&
    options.credentialSource !== "application" && getHostSecret("VERYFRONT_API_TOKEN") === apiToken;
  const usesPrivateCredential = inferenceCredential !== undefined || usesHostPrivateCredential ||
    options.credentialSource === "application";
  const useFirstPartyTransport = usesPrivateCredential ||
    options.providerSelection === "first-party";
  // Native provider request builders require a credential, but the guarded
  // gateway fetch owns the real authority token and replaces native auth.
  const providerCredential = usesPrivateCredential
    ? `vf-placeholder-${IntrinsicReflectApply(CryptoRandomUuid, HostCrypto, []) as string}`
    : apiToken;
  // Project extensions may replace registry providers. A signed inference
  // credential therefore uses only first-party transports that project code
  // cannot replace; ordinary project credentials retain extension behavior.
  const registry = useFirstPartyTransport ? undefined : ensureBuiltinLLMProviders();
  const routing = resolveVeryfrontCloudProviderRouting(provider);

  // A provider that only speaks the OpenAI wire format is promised the chat
  // completions surface and nothing else, so the transport is pinned on every
  // construction path. Left unset, a reasoning-style model ID or a hosted tool
  // would select the Responses runtime and request an endpoint that this
  // provider's surface does not serve.
  function createOpenAICompatibleModel(): ModelRuntime {
    const openAIChatPreserveSystemMessages = resolveVeryfrontCloudOpenAIChatSystemMessages(
      `${provider}/${upstreamModelId}`,
    );
    const chatCompletionsOnlyReason =
      `Veryfront Cloud provider "${provider}" speaks the OpenAI chat completions surface, ` +
      "which carries no hosted tools. Use a provider that implements the OpenAI surface " +
      "natively, or drop the hosted tool from the request.";

    if (useFirstPartyTransport) {
      return wrapVeryfrontCloudModel(
        createVeryfrontCloudOpenAIModel(upstreamModelId, {
          apiToken: providerCredential,
          baseURL,
          openAIChatCompletionsOnlyReason: chatCompletionsOnlyReason,
          openAIChatPreserveSystemMessages,
          openAITransport: "chat-completions",
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
          openAIChatCompletionsOnlyReason: chatCompletionsOnlyReason,
          openAIChatPreserveSystemMessages,
          openAITransport: "chat-completions",
          fetch,
        }),
        provider,
      );
    }
    return wrapVeryfrontCloudModel(
      createVeryfrontCloudOpenAIModel(upstreamModelId, {
        apiToken: providerCredential,
        baseURL,
        openAIChatCompletionsOnlyReason: chatCompletionsOnlyReason,
        openAIChatPreserveSystemMessages,
        openAITransport: "chat-completions",
        fetch,
      }),
      provider,
    );
  }

  switch (requireVeryfrontCloudWireSurface(routing.surface)) {
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
      if (useFirstPartyTransport) {
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
      if (useFirstPartyTransport) {
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
      // A provider that only speaks the OpenAI wire format keeps to Chat
      // Completions under the shared "openai-compatible" runtime name, which is
      // also what a provider this package does not list resolves to.
      if (!routing.native) return createOpenAICompatibleModel();

      const catalogModelId = `${provider}/${upstreamModelId}`;
      // One plan decides the transport here and in the durable model-call
      // context, so what a call records cannot drift from what it sends. An
      // adaptive plan stays unset, leaving the runtime free to move to the
      // Responses surface for a request that carries a hosted tool.
      const transportPlan = resolveVeryfrontCloudOpenAITransportPlan(provider, upstreamModelId);
      const openAITransport = transportPlan.pinned ? transportPlan.transport : undefined;
      const openAIChatReasoningWithFunctionTools =
        resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(catalogModelId);
      if (transportPlan.pinned && transportPlan.transport === "responses") {
        if (useFirstPartyTransport) {
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

      if (useFirstPartyTransport) {
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
  }

  throw toError(
    createError({
      type: "config",
      message: `Language provider "${provider}" is not available for veryfront-cloud.`,
    }),
  );
}

function requireApplicationBootstrap(): {
  apiBaseUrl: string;
  apiToken: string;
  projectSlug: string;
} {
  const context = getCurrentVeryfrontCloudContext();
  if (
    typeof context?.apiBaseUrl !== "string" || !context.apiBaseUrl ||
    typeof context.apiToken !== "string" || !context.apiToken ||
    typeof context.projectSlug !== "string"
  ) {
    throw new TypeError(
      "Application model construction requires explicit gateway, token, and project scope",
    );
  }
  // The broker's explicit application domain must not consult request,
  // runtime configuration, or host credential/project fallback sources.
  return {
    apiBaseUrl: context.apiBaseUrl,
    apiToken: context.apiToken,
    projectSlug: context.projectSlug,
  };
}

export function createVeryfrontCloudModel(
  modelId: string,
  /** @internal Broker construction policy, separate from model call/provider options. */
  options?: {
    credentialSource: "application";
    providerSelection: "first-party";
    assertCredentialActive?: () => void;
  },
): ModelRuntime {
  return createVeryfrontCloudModelInternal(modelId, undefined, options);
}

/** @internal Build a first-party gateway model with explicit run-scoped authority. */
export function createVeryfrontCloudInferenceModel(
  modelId: string,
  inferenceCredential: string,
  options: { apiBaseUrl?: string; assertInferenceCredentialActive?: () => void } = {},
): ModelRuntime {
  return createVeryfrontCloudModelInternal(modelId, inferenceCredential, options);
}
