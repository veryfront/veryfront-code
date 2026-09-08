import type { ExecutorChannel } from "../executor/channel.ts";
import type { HostToolSet } from "#veryfront/tool/host-tools.ts";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool/types.ts";
import { revokeModelRuntimeResolver } from "../runtime/model-transport.ts";
import type { ExecutorRuntimeFacades } from "./executor-runtime-prepare.ts";
import type { ExecutorRuntimeInstall } from "./executor-runtime-install-schema.ts";
import { createExecutorModelRuntimeResolver } from "./executor-model-bridge.ts";
import { createExecutorRemoteToolSources } from "./executor-tool-remote-facade.ts";
import { createExecutorPersistenceFacades } from "./executor-persistence-bridge.ts";

/** Executor-local capability views; cleanup revokes these views, never their shared channel. */
export async function createExecutorRuntimeFacades(options: {
  input: ExecutorRuntimeInstall;
  channel: ExecutorChannel;
  signal: AbortSignal;
}): Promise<ExecutorRuntimeFacades> {
  const { input, channel } = options;
  const lifetime = new AbortController();
  const signal = AbortSignal.any([options.signal, channel.signal, lifetime.signal]);
  const resolveModelRuntime = await createExecutorModelRuntimeResolver({
    channel,
    allowedModelIds: new Set(input.grant.models.map((model) => model.id)),
    signal,
  });
  function cleanup(): Promise<void> {
    revokeModelRuntimeResolver(resolveModelRuntime);
    lifetime.abort();
    return Promise.resolve();
  }
  try {
    signal.throwIfAborted();
    const hostIds = new Set(input.grant.hostToolFacadeIds);
    const remoteIds = new Set(input.grant.remoteToolSourceIds);
    const expected = new Set([...hostIds, ...remoteIds]);
    if (expected.size !== hostIds.size + remoteIds.size) {
      throw new TypeError("Ambiguous executor tool source grant");
    }
    const sources = expected.size ? await createExecutorRemoteToolSources({ channel, signal }) : [];
    if (sources.length !== expected.size || sources.some((source) => !expected.has(source.id))) {
      throw new TypeError("Executor tool sources do not match installation");
    }
    const hostTools = new Map<string, HostToolSet>();
    const remoteToolSources = new Map<string, RemoteToolSource>();
    for (const source of sources) {
      if (remoteIds.has(source.id)) {
        remoteToolSources.set(source.id, source);
        continue;
      }
      const definitions = await source.listTools({ abortSignal: signal });
      const tools: HostToolSet = Object.create(null);
      for (const definition of definitions) {
        tools[definition.name] = {
          id: definition.name,
          title: definition.title,
          description: definition.description,
          inputSchemaJson: definition.parameters,
          async execute(args: unknown, context?: ToolExecutionContext) {
            signal.throwIfAborted();
            if (!args || typeof args !== "object" || Array.isArray(args)) {
              throw new TypeError("Invalid executor tool arguments");
            }
            return await source.executeTool(
              definition.name,
              args as Record<string, unknown>,
              context,
            );
          },
        };
      }
      hostTools.set(source.id, tools);
    }
    const persistence = createExecutorPersistenceFacades({
      channel,
      signal,
      capabilityIds: input.capabilities.persistence,
      initialToolExposureCheckpoint: input.checkpointState?.toolExposure,
      initialProviderReplayCheckpoints: input.checkpointState?.providerReplay,
    });
    const state = input.capabilities.projectSteering || input.capabilities.conversationUserText
      ? (await import("./executor-state-bridge.ts")).createExecutorStateFacades({
        channel,
        capabilityIds: {
          projectSteering: input.capabilities.projectSteering,
          conversationUserText: input.capabilities.conversationUserText,
        },
        agentId: input.grant.agentId,
        projectId: input.grant.execution.projectId,
        branchId: input.grant.execution.branchId,
        signal,
      })
      : {};
    signal.throwIfAborted();
    return { resolveModelRuntime, hostTools, remoteToolSources, ...persistence, ...state, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
