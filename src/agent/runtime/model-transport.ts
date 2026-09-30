/**
 * Model transport resolution for the agent runtime.
 *
 * @module agent/runtime/model-transport
 */

import { type AgentConfig, type RuntimeReasoningOption } from "../types.ts";
import { type ModelRuntime, resolveModel } from "#veryfront/provider";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { warmVeryfrontCloudCatalog } from "#veryfront/provider/veryfront-cloud/provider.ts";
import { readVeryfrontCloudModelFacts } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";
import { resolveProviderOptionsWithDefaults } from "./default-provider-options.ts";
import {
  resolveConfiguredAgentModel,
  resolveModelProviderOptionKey,
  resolveRuntimeModel,
} from "./model-resolution.ts";
import {
  isVeryfrontCloudAnthropicSurfaceModel,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
  VERYFRONT_CLOUD_MODEL_PREFIX,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { hasDisabledThinking } from "./model-capabilities.ts";

const IntrinsicReflectApply = Reflect.apply;
const IntrinsicObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const StringStartsWith = String.prototype.startsWith;
const NativeAbortController = AbortController;
const AbortControllerAbort = AbortController.prototype.abort;
const EventTargetAddEventListener = EventTarget.prototype.addEventListener;
const EventTargetRemoveEventListener = EventTarget.prototype.removeEventListener;

function requireAbortIntrinsic<T>(getter: (() => T) | undefined, property: string): () => T {
  if (!getter) throw new TypeError(`Abort intrinsic ${property} is unavailable`);
  return getter;
}

const AbortControllerSignalGetter = requireAbortIntrinsic<AbortSignal>(
  IntrinsicObjectGetOwnPropertyDescriptor(AbortController.prototype, "signal")?.get,
  "signal",
);
const AbortSignalAbortedGetter = requireAbortIntrinsic<boolean>(
  IntrinsicObjectGetOwnPropertyDescriptor(AbortSignal.prototype, "aborted")?.get,
  "aborted",
);
const AbortSignalReasonGetter = requireAbortIntrinsic<unknown>(
  IntrinsicObjectGetOwnPropertyDescriptor(AbortSignal.prototype, "reason")?.get,
  "reason",
);

export type ResolvedModelTransport = {
  requestedModel: string;
  resolvedModelString: string;
  languageModel: ModelRuntime;
  providerOptionKey?: string;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
  reasoning?: RuntimeReasoningOption;
};

/** @internal Framework-owned model resolver for private transport authority. */
export type AgentModelRuntimeResolver = (modelId: string) => ModelRuntime | undefined;

type RevokerState = {
  revoked: boolean;
  revoke: () => void;
};

const modelRuntimeResolverRevokers = createPrivateWeakStore<
  AgentModelRuntimeResolver,
  RevokerState
>();

/**
 * The served catalog a private resolver's own credential sees: `load` fetches
 * it with that credential, and `read` runs synchronous catalog reads against
 * it. A resolver drawn at call time (a project-run execution) registers one so
 * its default-model and served-model decisions come from the same credential
 * as its model call, never from the ambient one.
 */
export type ModelRuntimeResolverCatalog = {
  load(): Promise<void>;
  read<T>(fn: () => T): T;
};

const modelRuntimeResolverCatalogs = createPrivateWeakStore<
  AgentModelRuntimeResolver,
  ModelRuntimeResolverCatalog
>();

/** @internal Attach the credential-scoped served catalog to a private resolver. */
export function registerModelRuntimeResolverCatalog(
  resolver: AgentModelRuntimeResolver,
  catalog: ModelRuntimeResolverCatalog,
): void {
  modelRuntimeResolverCatalogs.set(resolver, catalog);
}

/** @internal Attach invocation-scoped cleanup to a privately resolved model runtime. */
export function registerModelRuntimeResolverRevoker(
  resolver: AgentModelRuntimeResolver,
  revoke: () => void,
): void {
  modelRuntimeResolverRevokers.set(resolver, { revoked: false, revoke });
}

/** @internal Revoke invocation-scoped authority attached to a private resolver, if any. */
export function revokeModelRuntimeResolver(resolver: AgentModelRuntimeResolver | undefined): void {
  if (!resolver) return;
  const state = modelRuntimeResolverRevokers.get(resolver);
  if (!state || state.revoked) return;
  state.revoked = true;
  state.revoke();
}

/** @internal Revoke private model authority before caller abort listeners run. */
export function createModelRuntimeResolverAbortGuard(
  resolver: AgentModelRuntimeResolver | undefined,
  signal?: AbortSignal,
): {
  revoke: () => void;
  dispose: () => void;
} {
  const revoke = () => revokeModelRuntimeResolver(resolver);
  if (signal) {
    const aborted: boolean = IntrinsicReflectApply(AbortSignalAbortedGetter, signal, []);
    if (aborted) revoke();
    else {
      IntrinsicReflectApply(EventTargetAddEventListener, signal, ["abort", revoke, { once: true }]);
    }
  }

  return {
    revoke,
    dispose: () => {
      if (signal) {
        IntrinsicReflectApply(EventTargetRemoveEventListener, signal, ["abort", revoke]);
      }
      revoke();
    },
  };
}

/** @internal Couple private model authority to a child cancellation signal. */
export function createModelRuntimeResolverAbortScope(
  resolver: AgentModelRuntimeResolver | undefined,
  upstreamSignal?: AbortSignal,
): {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  revoke: () => void;
  dispose: () => void;
} {
  const controller = new NativeAbortController();
  const signal: AbortSignal = IntrinsicReflectApply(AbortControllerSignalGetter, controller, []);
  const revoke = () => revokeModelRuntimeResolver(resolver);
  const abort = (reason?: unknown) => {
    revoke();
    const aborted: boolean = IntrinsicReflectApply(AbortSignalAbortedGetter, signal, []);
    if (!aborted) {
      IntrinsicReflectApply(AbortControllerAbort, controller, [reason]);
    }
  };
  const abortFromUpstream = () => {
    const reason = upstreamSignal
      ? IntrinsicReflectApply(AbortSignalReasonGetter, upstreamSignal, [])
      : undefined;
    abort(reason);
  };

  if (upstreamSignal) {
    const upstreamAborted: boolean = IntrinsicReflectApply(
      AbortSignalAbortedGetter,
      upstreamSignal,
      [],
    );
    if (upstreamAborted) abortFromUpstream();
    else {
      IntrinsicReflectApply(EventTargetAddEventListener, upstreamSignal, [
        "abort",
        abortFromUpstream,
        { once: true },
      ]);
    }
  }

  return {
    signal,
    abort,
    revoke,
    dispose: () => {
      if (upstreamSignal) {
        IntrinsicReflectApply(EventTargetRemoveEventListener, upstreamSignal, [
          "abort",
          abortFromUpstream,
        ]);
      }
      revoke();
    },
  };
}

export interface ResolveAgentModelTransportInput {
  agentId: string;
  config: AgentConfig;
  context: Record<string, unknown> | undefined;
  modelOverride: string | undefined;
  mode: "generate" | "stream";
  resolveModelRuntime?: AgentModelRuntimeResolver;
  modelCallThinking?: RuntimeReasoningOption & { enabled: boolean };
}

function resolveReasoningWithDefaults(
  modelString: string,
  existing: RuntimeReasoningOption | undefined,
  providerOptions: Record<string, unknown> | undefined,
): RuntimeReasoningOption | undefined {
  if (existing) {
    return existing;
  }

  if (hasDisabledThinking(providerOptions)) {
    return { enabled: false };
  }

  if (isVeryfrontCloudAnthropicSurfaceModel(modelString)) {
    return undefined;
  }

  const thinking = resolveVeryfrontCloudModelThinking(modelString);
  return resolveVeryfrontCloudReasoningOption(modelString, thinking);
}

export async function resolveAgentModelTransport(
  input: ResolveAgentModelTransportInput,
): Promise<ResolvedModelTransport> {
  const configuredModel = input.modelOverride || input.config.model;
  const startsWithCloudPrefix = (model: string): boolean =>
    IntrinsicReflectApply(StringStartsWith, model, [VERYFRONT_CLOUD_MODEL_PREFIX]) as boolean;
  // Every decision below reads the served catalog: which model an omitted or
  // `auto` model means, whether an explicit provider model is served through
  // Veryfront Cloud, and the thinking defaults. An ambient run that can reach
  // Veryfront Cloud loads the catalog before any of them. A run with a private
  // model resolver was prepared from the catalog as it stood then, and its call
  // must keep what that preparation reserved, so it does not load it here.
  //
  // A private resolver that carries its own catalog (a project-run execution)
  // loads and reads that catalog with its own credential instead: the ambient
  // credential must not decide which model its credential pays for.
  const privateCatalog = input.resolveModelRuntime
    ? modelRuntimeResolverCatalogs.get(input.resolveModelRuntime)
    : undefined;
  const isLocalModel = typeof configuredModel === "string" && configuredModel.startsWith("local/");
  if (privateCatalog) {
    if (!isLocalModel) await privateCatalog.load();
  } else if (!input.resolveModelRuntime && isVeryfrontCloudEnabled() && !isLocalModel) {
    await warmVeryfrontCloudCatalog();
  }
  const readCatalog = <T>(fn: () => T): T => privateCatalog ? privateCatalog.read(fn) : fn();
  const requestedModel = readCatalog(() => resolveConfiguredAgentModel(configuredModel));
  const resolvedModelString = readCatalog(() => resolveRuntimeModel(configuredModel));
  const usesVeryfrontCloud = startsWithCloudPrefix(resolvedModelString);
  const privatelyResolvedModel = input.resolveModelRuntime && usesVeryfrontCloud
    ? input.resolveModelRuntime(resolvedModelString)
    : undefined;
  const transport = privatelyResolvedModel
    ? undefined
    : await input.config.resolveModelTransport?.({
      agentId: input.agentId,
      requestedModel,
      resolvedModel: resolvedModelString,
      context: input.context,
      mode: input.mode,
    });

  const privateThinking = privatelyResolvedModel
    ? input.modelCallThinking ??
      readCatalog(() => resolveVeryfrontCloudModelThinking(resolvedModelString))
    : undefined;
  const privateReasoning = readCatalog(() =>
    resolveVeryfrontCloudReasoningOption(resolvedModelString, privateThinking)
  );
  // Private managed calls carry audited neutral controls. Only adaptive
  // Anthropic thinking needs native call data; legacy native temperature
  // overrides would replace the broker's persisted neutral input.
  const providerOptions = privatelyResolvedModel
    ? privateThinking?.enabled && privateReasoning === undefined
      ? readCatalog(() =>
        resolveVeryfrontCloudThinkingProviderOptions(resolvedModelString, privateThinking)
      )
      : undefined
    : readCatalog(() =>
      resolveProviderOptionsWithDefaults(resolvedModelString, transport?.providerOptions)
    );
  const languageModel = privatelyResolvedModel ?? transport?.model ??
    resolveModel(resolvedModelString);
  // A Veryfront Cloud model settles its protocol and capabilities on its first
  // async step. Settle it here, before anything reads them: the provider option
  // key below and the runtime's tool-calling, structured-output and replay
  // checks. A failure surfaces again when the model is called.
  if (
    readVeryfrontCloudModelFacts(languageModel) !== undefined &&
    typeof languageModel.prepare === "function"
  ) {
    await Promise.resolve(languageModel.prepare()).catch(() => {});
  }
  const providerOptionKey = readCatalog(() =>
    resolveModelProviderOptionKey(resolvedModelString, languageModel)
  );

  return {
    requestedModel,
    resolvedModelString,
    languageModel,
    ...(providerOptionKey ? { providerOptionKey } : {}),
    headers: transport?.headers,
    providerOptions,
    reasoning: privatelyResolvedModel
      ? privateReasoning
      : readCatalog(() =>
        resolveReasoningWithDefaults(resolvedModelString, transport?.reasoning, providerOptions)
      ),
  };
}
