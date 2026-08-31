/**
 * Model transport resolution for the agent runtime.
 *
 * @module agent/runtime/model-transport
 */

import { type AgentConfig, type RuntimeReasoningOption } from "../types.ts";
import { type ModelRuntime, resolveModel } from "#veryfront/provider";
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
export type AgentModelRuntimeResolver = (modelId: string) => ModelRuntime;

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
      resolvedModelString.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX)
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
    input.resolveModelRuntime?.(resolvedModelString) ??
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
