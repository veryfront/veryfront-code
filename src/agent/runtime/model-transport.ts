/**
 * Model transport resolution for the agent runtime.
 *
 * @module agent/runtime/model-transport
 */

import { type AgentConfig, type RuntimeReasoningOption } from "../types.ts";
import { type ModelRuntime, resolveModel } from "#veryfront/provider";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { resolveProviderOptionsWithDefaults } from "./default-provider-options.ts";
import {
  resolveConfiguredAgentModel,
  resolveModelProviderOptionKey,
  resolveRuntimeModel,
} from "./model-resolution.ts";
import {
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudReasoningOption,
  tryGetVeryfrontCloudProviderFromModelId,
  VERYFRONT_CLOUD_MODEL_PREFIX,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { hasDisabledThinking } from "./model-capabilities.ts";

const IntrinsicReflectApply = Reflect.apply;
const StringStartsWith = String.prototype.startsWith;

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
  signal?.addEventListener("abort", revoke, { once: true });

  return {
    revoke,
    dispose: () => {
      signal?.removeEventListener("abort", revoke);
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
  const controller = new AbortController();
  const revoke = () => revokeModelRuntimeResolver(resolver);
  const abort = (reason?: unknown) => {
    revoke();
    if (!controller.signal.aborted) controller.abort(reason);
  };
  const abortFromUpstream = () => abort(upstreamSignal?.reason);

  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  return {
    signal: controller.signal,
    abort,
    revoke,
    dispose: () => {
      upstreamSignal?.removeEventListener("abort", abortFromUpstream);
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

  if (tryGetVeryfrontCloudProviderFromModelId(modelString) === "anthropic") {
    return undefined;
  }

  const thinking = resolveVeryfrontCloudModelThinking(modelString);
  return resolveVeryfrontCloudReasoningOption(modelString, thinking);
}

export async function resolveAgentModelTransport(
  input: ResolveAgentModelTransportInput,
): Promise<ResolvedModelTransport> {
  const requestedModel = resolveConfiguredAgentModel(input.modelOverride || input.config.model);
  const resolvedModelString = resolveRuntimeModel(input.modelOverride || input.config.model);
  const privatelyResolvedModel = input.resolveModelRuntime &&
      IntrinsicReflectApply(StringStartsWith, resolvedModelString, [VERYFRONT_CLOUD_MODEL_PREFIX])
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

  const providerOptions = resolveProviderOptionsWithDefaults(
    resolvedModelString,
    transport?.providerOptions,
  );
  const languageModel = privatelyResolvedModel ?? transport?.model ??
    resolveModel(resolvedModelString);
  const providerOptionKey = resolveModelProviderOptionKey(resolvedModelString, languageModel);

  return {
    requestedModel,
    resolvedModelString,
    languageModel,
    ...(providerOptionKey ? { providerOptionKey } : {}),
    headers: transport?.headers,
    providerOptions,
    reasoning: resolveReasoningWithDefaults(
      resolvedModelString,
      transport?.reasoning,
      providerOptions,
    ),
  };
}
