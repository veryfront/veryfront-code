/**
 * Model transport resolution for the agent runtime.
 *
 * @module agent/runtime/model-transport
 */

import { type AgentConfig, type RuntimeReasoningOption } from "../types.ts";
import { type ModelRuntime, resolveModel } from "#veryfront/provider";
import { runWithVeryfrontCloudInferenceCredential } from "#veryfront/provider/veryfront-cloud/provider.ts";
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

export interface ResolveAgentModelTransportInput {
  agentId: string;
  config: AgentConfig;
  context: Record<string, unknown> | undefined;
  modelOverride: string | undefined;
  mode: "generate" | "stream";
  /** @internal Framework-owned credential used only while resolving the model. */
  inferenceAuthToken?: string;
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
  const transport = await input.config.resolveModelTransport?.({
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
  const languageModel = transport?.model ?? runWithVeryfrontCloudInferenceCredential(
    input.inferenceAuthToken,
    () => resolveModel(resolvedModelString),
  );
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
