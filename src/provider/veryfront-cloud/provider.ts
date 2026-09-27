import { createAnthropicProviderModel } from "@veryfront/ext-llm-anthropic";
import { createGoogleProviderModel } from "@veryfront/ext-llm-google";

import { createError, toError } from "#veryfront/errors";
import { ensureBuiltinLLMProviders } from "#veryfront/extensions/builtin-extensions.ts";
import { getHostSecret } from "#veryfront/platform/compat/process/env.ts";

import type { ModelRuntime } from "../types.ts";
import { getCurrentVeryfrontCloudContext } from "./context.ts";
import {
  assertVeryfrontCloudModelListed,
  createVeryfrontCloudFetch,
  loadVeryfrontCloudModelCatalog,
  parseVeryfrontCloudModelId,
  requireVeryfrontCloudBootstrap,
  resolveVeryfrontCloudGatewayRoute,
} from "./shared.ts";
import {
  createVeryfrontCloudOpenAIModel,
  createVeryfrontCloudOpenAIResponsesModel,
} from "./openai.ts";
import {
  registerVeryfrontCloudModelFacts,
  requireVeryfrontCloudWireSurface,
  resolveVeryfrontCloudOpenAIChatFunctionToolReasoning,
  resolveVeryfrontCloudOpenAIChatSystemMessages,
  resolveVeryfrontCloudOpenAITransport,
  resolveVeryfrontCloudOpenAITransportPlan,
  resolveVeryfrontCloudProviderRouting,
  type VeryfrontCloudModelFacts,
} from "./model-catalog.ts";
import {
  isVeryfrontCloudCatalogFresh,
  loadVeryfrontCloudCatalog,
  withVeryfrontCloudCatalogScope,
} from "./catalog-client.ts";

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
const ReflectGet = Reflect.get;

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

/** Upper bound on how long a warm-up before a model call waits for the catalog. */
const CATALOG_WARM_UP_MAX_WAIT_MS = 3_000;

/**
 * @internal Load the catalog with the ambient credentials before a model call
 * reads facts synchronously, waiting at most a few seconds.
 */
export async function warmVeryfrontCloudCatalog(abortSignal?: AbortSignal): Promise<void> {
  await loadVeryfrontCloudModelCatalog({
    ...(abortSignal ? { signal: abortSignal } : {}),
    maxWaitMs: CATALOG_WARM_UP_MAX_WAIT_MS,
  });
}

/** Metadata keys a wrapped model forwards to the model it currently calls. */
const NON_FORWARDED_KEYS: ReadonlySet<PropertyKey> = new Set([
  "prepare",
  "doGenerate",
  "doStream",
  "constructor",
]);

/**
 * Optional members a model rebuilt onto another protocol can gain even when
 * the model it was first built as lacks them (the Google protocol adds
 * `_reconcileProviderMetadata`), so the wrapper forwards them regardless.
 */
const OPTIONAL_FORWARDED_KEYS: readonly PropertyKey[] = [
  "_reconcileProviderMetadata",
  "_generateViaStream",
  "runtimeCapabilities",
  "executionMode",
  "modelProvider",
  "specificationVersion",
];

/**
 * Wrap a built model so its first async step loads the served catalog. When
 * the catalog changes how the model is built, calls and metadata go to the
 * model rebuilt from it. Once the catalog is settled, calls go straight to the
 * current model.
 *
 * A settled model keeps the facts it settled with for its lifetime: a catalog
 * refreshed later applies to models constructed after the refresh.
 */
function withServedCatalog(
  model: ModelRuntime,
  current: () => ModelRuntime,
  settled: () => ModelRuntime | undefined,
  ready: (abortSignal?: AbortSignal) => Promise<ModelRuntime>,
): ModelRuntime {
  const readSignal = (options: unknown): AbortSignal | undefined =>
    options !== null && typeof options === "object"
      ? (options as { abortSignal?: AbortSignal }).abortSignal
      : undefined;
  const wrapped = ObjectCreate(model, {
    prepare: {
      value: async (abortSignal?: AbortSignal): Promise<void> => {
        const target = settled() ?? await ready(abortSignal);
        if (target.prepare) await target.prepare(abortSignal);
      },
    },
    doGenerate: {
      value: (options: unknown) => {
        const target = settled();
        if (target) return target.doGenerate(options);
        return (async () => await (await ready(readSignal(options))).doGenerate(options))();
      },
    },
    doStream: {
      value: (options: unknown) => {
        const target = settled();
        if (target) return target.doStream(options);
        return (async () => await (await ready(readSignal(options))).doStream(options))();
      },
    },
  });

  // Metadata (provider attribution, capabilities, model ID) follows the model
  // the calls go to, so a rebuild never leaves the construction-time values.
  const forwarded = new Set<PropertyKey>();
  const forward = (key: PropertyKey): void => {
    if (forwarded.has(key) || NON_FORWARDED_KEYS.has(key)) return;
    forwarded.add(key);
    ObjectDefineProperty(wrapped, key, {
      configurable: false,
      enumerable: true,
      get: () => {
        const target = current();
        const value: unknown = IntrinsicReflectApply(ReflectGet, undefined, [target, key]);
        return typeof value === "function"
          ? IntrinsicReflectApply(FunctionBind, value, [target])
          : value;
      },
    });
  };
  let source: object | null = model;
  while (source && source !== ObjectPrototype) {
    for (const key of ReflectOwnKeys(source)) forward(key);
    source = ObjectGetPrototypeOf(source);
  }
  for (const key of OPTIONAL_FORWARDED_KEYS) forward(key);
  return wrapped;
}

type VeryfrontCloudModelOptions = {
  apiBaseUrl?: string;
  assertInferenceCredentialActive?: () => void;
  credentialSource?: "application";
  providerSelection?: "first-party";
  assertCredentialActive?: () => void;
};

function createVeryfrontCloudModelInternal(
  modelId: string,
  inferenceCredential?: string,
  options: VeryfrontCloudModelOptions = {},
): ModelRuntime {
  // Parsed here so a malformed or retired ID fails at construction. Whether the
  // catalog lists the model is checked against this model's own catalog: now
  // when it has loaded, otherwise once the first async step has loaded it.
  parseVeryfrontCloudModelId(modelId, "language", { catalogChecks: false });
  const { apiBaseUrl, apiToken, projectSlug } = options.credentialSource === "application"
    ? requireApplicationBootstrap()
    : requireVeryfrontCloudBootstrap(inferenceCredential, options.apiBaseUrl);
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

  const catalogScope = { apiBaseUrl, apiToken, ...(projectSlug ? { projectSlug } : {}) };

  // The catalog facts a build reads, from this model's own credentials and
  // project. A model built before the catalog loaded is rebuilt at its first
  // async step when these differ.
  function readFacts(): VeryfrontCloudModelFacts {
    return withVeryfrontCloudCatalogScope(catalogScope, () => {
      const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(
        modelId,
        "language",
        { catalogChecks: false },
      );
      const catalogModelId = `${provider}/${upstreamModelId}`;
      const routing = resolveVeryfrontCloudProviderRouting(provider);
      const openAIChatReasoningWithFunctionTools =
        resolveVeryfrontCloudOpenAIChatFunctionToolReasoning(catalogModelId);
      const openAIChatPreserveSystemMessages = resolveVeryfrontCloudOpenAIChatSystemMessages(
        catalogModelId,
      );
      const openAITransport = resolveVeryfrontCloudOpenAITransport(catalogModelId);
      return Object.freeze({
        provider,
        surface: routing.surface,
        native: routing.native === true,
        transportPlan: resolveVeryfrontCloudOpenAITransportPlan(provider, upstreamModelId),
        ...(openAITransport === undefined ? {} : { openAITransport }),
        ...(openAIChatReasoningWithFunctionTools === undefined
          ? {}
          : { openAIChatReasoningWithFunctionTools }),
        ...(openAIChatPreserveSystemMessages === undefined
          ? {}
          : { openAIChatPreserveSystemMessages }),
      });
    });
  }
  const factsKey = (value: VeryfrontCloudModelFacts): string =>
    [
      value.provider,
      value.surface,
      String(value.native),
      value.transportPlan.transport,
      String(value.transportPlan.pinned),
      String(value.openAITransport),
      String(value.openAIChatReasoningWithFunctionTools),
      String(value.openAIChatPreserveSystemMessages),
    ].join("\n");

  const build = (): ModelRuntime =>
    withVeryfrontCloudCatalogScope(catalogScope, () =>
      buildVeryfrontCloudModel({
        modelId,
        inferenceCredential,
        options,
        apiBaseUrl,
        apiToken,
        projectSlug,
        providerCredential,
        registry,
        useFirstPartyTransport,
      }));
  // The listing check runs in this model's own scope, against a catalog
  // actually loaded for it; before that, the platform answers for the model.
  const assertListed = (): void =>
    withVeryfrontCloudCatalogScope(catalogScope, () => {
      const parsed = parseVeryfrontCloudModelId(modelId, "language", { catalogChecks: false });
      assertVeryfrontCloudModelListed(parsed.provider, parsed.modelId);
    });
  // Refuse at construction only against a fresh catalog: a stale one may miss a
  // model enabled since, so the check waits for the refresh on the first call.
  if (isVeryfrontCloudCatalogFresh(catalogScope)) assertListed();
  let facts = readFacts();
  const built = build();
  let current = built;
  let isSettled = false;
  const rebuildIfChanged = (settle: boolean): ModelRuntime => {
    const next = readFacts();
    if (settle) assertListed();
    if (factsKey(next) !== factsKey(facts)) current = build();
    facts = next;
    // Only a catalog actually obtained settles the model: after a failed or
    // abandoned load, the next call tries again.
    if (settle) isSettled = true;
    return current;
  };
  // A fresh cached catalog settles the model without waiting on anything.
  const settled = (): ModelRuntime | undefined => {
    if (isSettled) return current;
    if (!isVeryfrontCloudCatalogFresh(catalogScope)) return undefined;
    return rebuildIfChanged(true);
  };
  // Each caller waits on its own signal. Concurrent callers share only the
  // underlying catalog request (one per credentials and project, in the
  // catalog client), so one caller giving up never decides for another.
  const ready = async (abortSignal?: AbortSignal): Promise<ModelRuntime> => {
    const catalog = await loadVeryfrontCloudCatalog({
      ...catalogScope,
      fresh: true,
      ...(abortSignal ? { signal: abortSignal } : {}),
    });
    // Settle (and run the listing check) only on a fresh catalog. A stale one
    // answers this call, and a later call tries the refresh again.
    return rebuildIfChanged(catalog !== undefined && isVeryfrontCloudCatalogFresh(catalogScope));
  };
  const wrapped = withServedCatalog(built, () => current, settled, ready);
  registerVeryfrontCloudModelFacts(wrapped, () => facts);
  return wrapped;
}

interface VeryfrontCloudModelBuild {
  readonly modelId: string;
  readonly inferenceCredential: string | undefined;
  readonly options: VeryfrontCloudModelOptions;
  readonly apiBaseUrl: string;
  readonly apiToken: string;
  readonly projectSlug: string | undefined;
  readonly providerCredential: string;
  readonly registry: ReturnType<typeof ensureBuiltinLLMProviders> | undefined;
  readonly useFirstPartyTransport: boolean;
}

/** Build a model from the served facts as they stand now. */
function buildVeryfrontCloudModel(build: VeryfrontCloudModelBuild): ModelRuntime {
  const {
    modelId,
    inferenceCredential,
    options,
    apiBaseUrl,
    apiToken,
    projectSlug,
    providerCredential,
    registry,
    useFirstPartyTransport,
  } = build;
  const { provider, modelId: upstreamModelId } = parseVeryfrontCloudModelId(modelId, "language", {
    catalogChecks: false,
  });
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
