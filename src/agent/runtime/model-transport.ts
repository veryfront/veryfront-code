/**
 * Model transport resolution for the agent runtime.
 *
 * @module agent/runtime/model-transport
 */

import { type AgentConfig } from "../types.ts";
import { type ModelRuntime, resolveModel } from "#veryfront/provider";
import { resolveProviderOptionsWithDefaults } from "./default-provider-options.ts";
import { resolveConfiguredAgentModel, resolveRuntimeModel } from "./model-resolution.ts";

export type ResolvedModelTransport = {
  requestedModel: string;
  resolvedModelString: string;
  languageModel: ModelRuntime;
  headers?: HeadersInit;
  providerOptions?: Record<string, unknown>;
};

export interface ResolveAgentModelTransportInput {
  agentId: string;
  config: AgentConfig;
  context: Record<string, unknown> | undefined;
  modelOverride: string | undefined;
  mode: "generate" | "stream";
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

  return {
    requestedModel,
    resolvedModelString,
    languageModel: transport?.model ?? resolveModel(resolvedModelString),
    headers: transport?.headers,
    providerOptions: resolveProviderOptionsWithDefaults(
      resolvedModelString,
      transport?.providerOptions,
    ),
  };
}
