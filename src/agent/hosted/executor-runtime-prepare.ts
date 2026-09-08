import type { JsonValue } from "#veryfront/schemas/index.ts";
import { VERYFRONT_CLOUD_MODEL_PREFIX } from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import type { HostToolSet, RemoteToolSource } from "#veryfront/tool";
import { isToolVisibleTo } from "#veryfront/tool";
import { isSkillInfrastructureToolId } from "#veryfront/skill/types.ts";
import type { AgentSystem } from "#veryfront/agent/types.ts";
import {
  type AgentModelRuntimeResolver,
  registerModelRuntimeResolverRevoker,
  revokeModelRuntimeResolver,
} from "#veryfront/agent/runtime/model-transport.ts";
import { wrapRemoteToolSourceWithMcpPolicy } from "#veryfront/agent/mcp-tool-policy.ts";
import type { RuntimeAgentMarkdownDefinition } from "#veryfront/agent/runtime/agent-definition.ts";
import {
  type ExecutorBinding,
  getExecutorBindingSchema,
} from "#veryfront/agent/executor/protocol.ts";
import type {
  ExecutorOperation,
  ExecutorOperationContext,
} from "#veryfront/agent/executor/channel.ts";
import type { ExecutorDiscovery } from "#veryfront/agent/hosted/executor-discovery.ts";
import {
  type ExecutorDiscoverySource,
  getExecutorAgentDescribeResultSchema,
  getExecutorDiscoverySourceSchema,
} from "#veryfront/agent/hosted/executor-discovery-schema.ts";
import { verifyHostedRuntimeSourceBinding } from "#veryfront/agent/hosted/runtime-source-binding.ts";
import {
  resolveHostedRuntimeAllowedProviderTools,
  resolveHostedRuntimeAllowedTools,
} from "#veryfront/agent/hosted/runtime-request-config.ts";
import {
  executorAgentFailureCode,
  executorAgentJson,
} from "#veryfront/agent/hosted/executor-agent-schema.ts";
import { createExecutorAgentOperations } from "#veryfront/agent/hosted/executor-agent-bridge.ts";
import { createHostedChatRuntimeDataStream } from "#veryfront/agent/hosted/chat-runtime-agent-adapter.ts";
import {
  createPreparedHostedRuntimeAgent,
  incrementSteeringRevision,
  type PreparedHostedRuntimeAgentOptions,
  scopeHostedRuntimeToolResults,
} from "#veryfront/agent/hosted/default-chat-runtime.ts";
import {
  prepareFacadedHostedChatRuntimeToolAssembly,
  resolveOwnerScopedToolNames,
} from "#veryfront/agent/hosted/chat-runtime-tool-assembly.ts";
import type {
  HostedChatRuntimeCreationOptions,
  HostedChatRuntimeProjectSteering,
} from "#veryfront/agent/hosted/chat-runtime-contract.ts";
import type { RuntimeAgentThinkingConfig } from "#veryfront/agent/runtime/agent-definition.ts";
import { resolveRuntimeSkillSelectorForAgent } from "#veryfront/agent/runtime/skill-metadata.ts";
import { runWithProjectAgentRuntime } from "#veryfront/agent/project/agent-runtime.ts";
import {
  applyDefaultResearchArtifactPath,
  shouldRetryCreateResearchArtifactAsUpdate,
} from "#veryfront/agent/artifacts/default-research-artifact-support.ts";
import { buildInteractiveVeryfrontCloudRuntimeInstructions } from "#veryfront/agent/hosted/cloud-runtime-system-messages.ts";
import {
  type ExecutorRuntimeGrantData,
  ExecutorRuntimePreparationError,
  type ExecutorRuntimePrepareRequest,
  getExecutorRuntimeGrantDataSchema,
  getExecutorRuntimePrepareRequestSchema,
  parseRuntimePreparationData,
} from "#veryfront/agent/hosted/executor-runtime-prepare-schema.ts";

type CreationOptions = HostedChatRuntimeCreationOptions<
  RuntimeAgentMarkdownDefinition,
  RuntimeAgentThinkingConfig
>;
export type ExecutorRuntimePreparationGrant = Omit<ExecutorRuntimeGrantData, "models"> & {
  /** Preparation selections only. Invocation-wide call accounting is enforced by the broker. */
  models: ReadonlyMap<string, { maxOutputTokens: number; providerToolNames: readonly string[] }>;
};
export interface ExecutorRuntimeFacades {
  /** Must be the invocation's granted model proxy; missing models throw instead of using provider defaults. */
  resolveModelRuntime: AgentModelRuntimeResolver;
  hostTools: ReadonlyMap<string, HostToolSet>;
  remoteToolSources: ReadonlyMap<string, RemoteToolSource>;
  projectSteering?: {
    prepare(
      input: {
        definition: RuntimeAgentMarkdownDefinition;
        projectId: string | null;
        branchId?: string | null;
        signal: AbortSignal;
      },
    ): Promise<HostedChatRuntimeProjectSteering<RuntimeAgentMarkdownDefinition>>;
    refresh(): Promise<AgentSystem> | AgentSystem;
  };
  latestConversationUserText?: (signal: AbortSignal) => Promise<string | null>;
  publishParentRunEvents?: NonNullable<CreationOptions["publishParentRunEvents"]>;
  toolExposureCheckpoint?: {
    initial?: CreationOptions["serverResolvedToolExposureCheckpoint"];
    persist: NonNullable<CreationOptions["persistToolExposureCheckpoint"]>;
  };
  providerReplayCheckpoint?: {
    initial?: CreationOptions["serverResolvedProviderReplayCheckpoints"];
    persist: NonNullable<CreationOptions["persistProviderReplayCheckpoint"]>;
  };
  /** Own partial facade setup and prepared runtime resources, not the channel/allocation. */
  cleanup(): Promise<void>;
}
interface Options {
  binding: ExecutorBinding;
  source: ExecutorDiscoverySource;
  discovery: ExecutorDiscovery;
  grant?: ExecutorRuntimePreparationGrant;
  facades: ExecutorRuntimeFacades;
}

function refuse(code: ConstructorParameters<typeof ExecutorRuntimePreparationError>[0]): never {
  throw new ExecutorRuntimePreparationError(code);
}
function snapshotGrant(
  grant: ExecutorRuntimePreparationGrant | undefined,
): ExecutorRuntimeGrantData | undefined {
  if (!grant) return undefined;
  if (!(grant.models instanceof Map)) return refuse("EXECUTOR_RUNTIME_INVALID_INPUT");
  const parsed = parseRuntimePreparationData(getExecutorRuntimeGrantDataSchema(), {
    ...grant,
    models: [...grant.models].map(([id, policy]) => ({ id, ...policy })),
  });
  if (
    parsed.models.some((model) =>
      !model.id.startsWith(VERYFRONT_CLOUD_MODEL_PREFIX) ||
      model.id.length === VERYFRONT_CLOUD_MODEL_PREFIX.length
    ) || !parsed.models.some((model) => model.id === parsed.defaultModelId) ||
    new Set(parsed.models.map((model) => model.id)).size !== parsed.models.length
  ) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
  return parsed;
}
function sameBinding(left: ExecutorBinding, right: ExecutorBinding) {
  return left.allocationId === right.allocationId && left.generation === right.generation &&
    left.invocationId === right.invocationId;
}
function intersectNames(
  granted: readonly string[],
  source: true | readonly string[] | undefined,
  requested: readonly string[] | undefined,
  denied: readonly string[] = [],
) {
  return granted.filter((name) =>
    (source === undefined || source === true || source.includes(name)) &&
    (requested === undefined || requested.includes(name)) && !denied.includes(name)
  );
}

/**
 * One allocation's fixed-project preparation/stream dispatcher. Metadata never
 * installs execution authority; project navigation requires separate broker support.
 */
export function createExecutorRuntimePreparation(input: Options) {
  const grant = snapshotGrant(input.grant);
  const binding = parseRuntimePreparationData(getExecutorBindingSchema(), input.binding);
  const source = parseRuntimePreparationData(getExecutorDiscoverySourceSchema(), input.source);
  const facades: ExecutorRuntimeFacades = {
    ...input.facades,
    hostTools: new Map(input.facades.hostTools),
    remoteToolSources: new Map(input.facades.remoteToolSources),
  };
  const lifetime = new AbortController();
  let preparation: Promise<JsonValue> | undefined;
  let preparedOperations: ReadonlyMap<string, ExecutorOperation> | undefined;
  let closing: Promise<void> | undefined;
  let resourcesStarted = false;
  let cleanup: Promise<void> | undefined;
  let startup: Promise<ReadableStream<Uint8Array>> | undefined;
  let producerCompletion: Promise<void> | undefined;
  const settled = Promise.withResolvers<void>();
  void settled.promise.catch(() => {});
  const assertActive = () => {
    if (lifetime.signal.aborted || input.discovery.signal.aborted) {
      refuse("EXECUTOR_RUNTIME_CLOSED");
    }
  };
  const release = () => {
    cleanup ??= Promise.resolve().then(async () => {
      // Startup can still reserve producer work. Join both before releasing
      // facades, without joining the stream handler that calls this cleanup.
      await startup?.catch(() => {});
      await producerCompletion;
      if (resourcesStarted) await facades.cleanup();
    });
    return cleanup;
  };
  function close(): Promise<void> {
    if (closing) return closing;
    closing = Promise.resolve().then(async () => {
      await preparation?.catch(() => {});
      let failed = false;
      try {
        await release();
      } catch {
        failed = true;
      }
      try {
        await input.discovery.close();
      } catch {
        failed = true;
      }
      preparedOperations = undefined;
      if (failed) refuse("EXECUTOR_RUNTIME_CLEANUP_FAILED");
    });
    void closing.then(settled.resolve, settled.reject);
    lifetime.abort();
    input.discovery.signal.removeEventListener("abort", onDiscoveryAbort);
    return closing;
  }
  const onDiscoveryAbort = () => {
    void close().catch(() => {});
  };
  input.discovery.signal.addEventListener("abort", onDiscoveryAbort, { once: true });
  if (input.discovery.signal.aborted) onDiscoveryAbort();

  function requireFacades(
    definition: RuntimeAgentMarkdownDefinition,
    effective: ExecutorRuntimeGrantData,
  ) {
    if (
      typeof facades.resolveModelRuntime !== "function" || typeof facades.cleanup !== "function"
    ) refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
    for (const id of effective.hostToolFacadeIds) {
      if (!facades.hostTools.has(id)) refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
    }
    for (const id of effective.remoteToolSourceIds) {
      if (!facades.remoteToolSources.has(id)) refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
    }
    for (const server of definition.mcpServers ?? []) {
      if (!effective.remoteToolSourceIds.includes(server.id ?? server.kind)) {
        refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
      }
    }
    if (
      (effective.execution.projectId !== null ||
        effective.requiredCapabilities?.includes("project-steering")) &&
      (typeof facades.projectSteering?.prepare !== "function" ||
        typeof facades.projectSteering?.refresh !== "function")
    ) refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
    if (
      effective.requiredCapabilities?.includes("conversation-user-text") &&
      typeof facades.latestConversationUserText !== "function"
    ) refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
    if (effective.execution.kind === "canonical") {
      if (
        typeof facades.publishParentRunEvents !== "function" ||
        typeof facades.toolExposureCheckpoint?.persist !== "function"
      ) {
        refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
      }
      if (
        effective.execution.providerReplay === "required" &&
        typeof facades.providerReplayCheckpoint?.persist !== "function"
      ) refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
    }
  }

  async function prepare(
    request: ExecutorRuntimePrepareRequest,
    context: ExecutorOperationContext,
  ): Promise<JsonValue> {
    try {
      assertActive();
      if (!grant || grant.agentId !== request.agentId || !sameBinding(binding, context.binding)) {
        refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
      }
      const operation = input.discovery.operations.get("agent.describe");
      if (operation?.mode !== "unary") refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
      const described = getExecutorAgentDescribeResultSchema().parse(
        await operation.handle({ agentId: request.agentId }, context),
      );
      if (
        !described.ok || described.value.definition.id !== grant.agentId ||
        verifyHostedRuntimeSourceBinding(source, described.value.source)
      ) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
      const definition = described.value.definition;
      const modelId = request.modelId ?? grant.defaultModelId;
      const modelGrant = grant.models.find((model) => model.id === modelId);
      if (
        !modelGrant || (request.maxSteps !== undefined && request.maxSteps > grant.maxSteps) ||
        (request.maxOutputTokens !== undefined &&
          request.maxOutputTokens > modelGrant.maxOutputTokens)
      ) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
      requireFacades(definition, grant);
      const runtime = input.discovery.getRuntime();
      // Enroll only after agent.describe returns: a failed discovery operation
      // can await discovery.close(). No remaining preparation work awaits it.
      input.discovery.retainRuntimeTask(preparation!);
      const localTools: HostToolSet = Object.fromEntries(
        [...runtime.tools].filter(([id, value]) =>
          !isSkillInfrastructureToolId(id) && isToolVisibleTo(value, { agentId: definition.id })
        ),
      );
      for (const id of grant.hostToolFacadeIds) {
        Object.assign(localTools, facades.hostTools.get(id));
      }
      const normalizeToolNames = (names: readonly string[]) => [
        ...resolveOwnerScopedToolNames({
          toolNames: names,
          agentId: definition.id,
          localTools,
        })!,
      ];
      const deniedToolNames = [
        ...new Set([
          ...definition.deniedTools ?? [],
          ...normalizeToolNames(definition.deniedTools ?? []),
        ]),
      ];
      const sourceToolNames = resolveHostedRuntimeAllowedTools({
        configuredTools: definition.tools,
        configuredDeniedTools: definition.deniedTools,
        configuredDelegates: definition.delegates,
        configuredSkills: definition.skills,
        requestedTools: undefined,
      });
      const allowedToolNames = intersectNames(
        normalizeToolNames(grant.allowedToolNames),
        Array.isArray(sourceToolNames) ? normalizeToolNames(sourceToolNames) : sourceToolNames,
        request.allowedToolNames === undefined
          ? undefined
          : normalizeToolNames(request.allowedToolNames),
        deniedToolNames,
      );
      if (allowedToolNames.includes("studio_open_project")) {
        refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
      }
      const providerToolNames = intersectNames(
        modelGrant.providerToolNames,
        resolveHostedRuntimeAllowedProviderTools({
          configuredProviderTools: definition.providerTools,
          requestedTools: undefined,
        }),
        request.providerToolNames,
        definition.deniedTools,
      );
      const resolveModelRuntime: AgentModelRuntimeResolver = (id) => {
        assertActive();
        if (!grant.models.some((entry) => entry.id === id)) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
        return facades.resolveModelRuntime(id) ?? refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
      };
      registerModelRuntimeResolverRevoker(
        resolveModelRuntime,
        () => revokeModelRuntimeResolver(facades.resolveModelRuntime),
      );
      // The first facade call can reserve resources before throwing.
      resourcesStarted = true;
      resolveModelRuntime(modelId);
      const execution = grant.execution;
      const steering = facades.projectSteering
        ? await facades.projectSteering.prepare({
          definition,
          projectId: execution.projectId,
          branchId: execution.branchId,
          signal: lifetime.signal,
        })
        : undefined;
      assertActive();
      if (steering && steering.agent.id !== definition.id) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
      const skills = resolveRuntimeSkillSelectorForAgent({
        skills: steering?.initialSkills ?? [],
        agentId: definition.id,
        selector: definition.skills === false ? [] : definition.skills,
      });
      const taskContext = {
        ...execution,
        steeringRevision: 0,
        agentId: definition.id,
        model: modelId,
        availableSkillIds: skills.allowedSkillIds,
        ...(execution.kind === "canonical"
          ? { parentRunId: execution.runId, parentMessageId: execution.messageId }
          : {}),
      };
      const options: PreparedHostedRuntimeAgentOptions["options"] = {
        ...execution,
        agentId: definition.id,
        model: modelId,
        instructions: request.instructions ??
          (steering
            ? buildInteractiveVeryfrontCloudRuntimeInstructions({
              agentConfig: definition,
              projectId: execution.projectId,
              branchId: execution.branchId,
              instructions: steering.initialProjectInstructions ?? "",
              skills: allowedToolNames.includes("load_skill") ? skills.definitions : [],
              environmentContext: steering.environmentContext,
              availableToolNames: allowedToolNames,
            })
            : definition.system ?? definition.instructions),
        temperature: request.temperature ?? definition.temperature,
        thinking: request.thinking ?? definition.thinking,
        maxSteps: Math.min(
          request.maxSteps ?? grant.maxSteps,
          definition.maxSteps ?? grant.maxSteps,
          grant.maxSteps,
        ),
        maxOutputTokens: request.maxOutputTokens ?? modelGrant.maxOutputTokens,
        allowedTools: allowedToolNames,
        allowedProviderTools: providerToolNames,
        availableSkillIds: skills.allowedSkillIds,
        skillSelectorPolicy: skills.policy,
        skillSourcePaths: skills.skillSourcePaths,
        ...(steering
          ? {
            liveProjectSteering: {
              ...steering,
              agent: definition,
              initialSkills: skills.definitions,
            },
          }
          : {}),
        ...(execution.kind === "canonical"
          ? {
            parentRunId: execution.runId,
            parentMessageId: execution.messageId,
            publishParentRunEvents: facades.publishParentRunEvents,
            persistToolExposureCheckpoint: facades.toolExposureCheckpoint!.persist,
            serverResolvedToolExposureCheckpoint: facades.toolExposureCheckpoint!.initial,
            requireToolExposureCheckpointPersistence: true,
            ...(execution.providerReplay === "required"
              ? {
                persistProviderReplayCheckpoint: facades.providerReplayCheckpoint!.persist,
                serverResolvedProviderReplayCheckpoints: facades.providerReplayCheckpoint!.initial,
                providerReplayCheckpointMessageId: execution.messageId,
                requireProviderReplayCheckpointPersistence: true,
              }
              : {}),
          }
          : {}),
      };
      const toolAssembly = await prepareFacadedHostedChatRuntimeToolAssembly({
        signal: context.signal,
        taskContext,
        instructions: options.instructions,
        localTools,
        sourceIntegrationPolicy: runtime.sourceIntegrationPolicy,
        hostToolPolicy: { allow: allowedToolNames },
        allowedToolNames,
        deniedToolNames,
        allowedProviderToolNames: providerToolNames,
        sourceProviderToolNames: definition.providerTools,
        prepareRemoteToolInput: ({ toolName, toolInput }) =>
          applyDefaultResearchArtifactPath(toolName, toolInput, taskContext),
        shouldRetryWithRemoteTool: ({ toolName, toolInput, error }) =>
          shouldRetryCreateResearchArtifactAsUpdate({
            toolName,
            toolInput,
            taskContext,
            error,
          }),
        remoteToolSources: grant.remoteToolSourceIds.map((id) =>
          (definition.mcpServers ?? []).filter((server) => (server.id ?? server.kind) === id)
            .reduce(
              (source, server) => wrapRemoteToolSourceWithMcpPolicy(source, server.toolPolicy),
              facades.remoteToolSources.get(id)!,
            )
        ),
        onSteeringMutation: (mutation) => {
          if (mutation.instructionsChanged || mutation.skillsChanged) {
            incrementSteeringRevision(taskContext);
          }
        },
        loadLatestConversationUserText: facades.latestConversationUserText,
      });
      assertActive();
      for (const name of toolAssembly.normalizedAllowedToolNames ?? []) {
        if (!toolAssembly.authorizedToolNames.includes(name)) {
          refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
        }
      }
      const runtimeAgent = runWithProjectAgentRuntime(
        runtime,
        () =>
          createPreparedHostedRuntimeAgent({
            options,
            taskContext,
            toolAssembly: {
              ...toolAssembly,
              runtimeTools: scopeHostedRuntimeToolResults(toolAssembly.runtimeTools),
            },
            modelId,
            sourceIntegrationPolicy: runtime.sourceIntegrationPolicy,
            refreshSystem: facades.projectSteering?.refresh.bind(facades.projectSteering),
          }, {
            resolveModelRuntime,
            preserveToolCatalog: true,
            onStreamCompletion: (completion) => {
              producerCompletion = completion;
              input.discovery.retainRuntimeTask(completion);
            },
          }),
      );
      assertActive();
      const preparedRuntimeHandle = crypto.randomUUID();
      preparedOperations = createExecutorAgentOperations({
        preparedRuntimeHandle,
        startStream: (streamInput) => {
          startup = Promise.resolve().then(() => {
            assertActive();
            return createHostedChatRuntimeDataStream({
              runtimeAgent,
              sourceIntegrationPolicy: runtime.sourceIntegrationPolicy,
              agentId: definition.id,
              projectId: execution.projectId ?? undefined,
              projectSlug: execution.projectSlug,
              ...(execution.kind === "canonical"
                ? { runId: execution.runId, conversationId: execution.conversationId }
                : {}),
              maxOutputTokens: options.maxOutputTokens,
            }, streamInput);
          });
          input.discovery.retainRuntimeTask(startup);
          return startup;
        },
        cleanup: release,
      });
      return executorAgentJson({
        ok: true,
        value: { preparedRuntimeHandle, runtimeKind: "framework", modelId },
      }, "EXECUTOR_AGENT_INPUT_TOO_LARGE");
    } catch (error) {
      try {
        await release();
      } catch {
        return { ok: false, code: "EXECUTOR_RUNTIME_CLEANUP_FAILED" };
      }
      const knownFailure = executorAgentFailureCode(error, "EXECUTOR_AGENT_SETUP_FAILED");
      const code = lifetime.signal.aborted
        ? "ABORTED"
        : error instanceof ExecutorRuntimePreparationError
        ? error.code
        : knownFailure === "EXECUTOR_AGENT_SETUP_FAILED"
        ? "EXECUTOR_RUNTIME_PREPARATION_FAILED"
        : knownFailure;
      return { ok: false, code };
    }
  }

  const operations = new Map(input.discovery.operations);
  operations.set("runtime.prepare", {
    mode: "unary",
    async handle(value, context) {
      try {
        assertActive();
        if (preparation) refuse("EXECUTOR_RUNTIME_ALREADY_PREPARED");
        const request = parseRuntimePreparationData(
          getExecutorRuntimePrepareRequestSchema(),
          value,
        );
        executorAgentJson(request, "EXECUTOR_AGENT_INPUT_TOO_LARGE");
        const cancel = () => {
          void close().catch(() => {});
        };
        context.signal.addEventListener("abort", cancel, { once: true });
        preparation = prepare(request, {
          ...context,
          signal: AbortSignal.any([context.signal, lifetime.signal]),
        });
        if (context.signal.aborted) cancel();
        try {
          return await preparation;
        } finally {
          context.signal.removeEventListener("abort", cancel);
        }
      } catch (error) {
        return {
          ok: false,
          code: error instanceof ExecutorRuntimePreparationError
            ? error.code
            : "EXECUTOR_RUNTIME_INVALID_INPUT",
        };
      }
    },
  });
  operations.set("agent.stream", {
    mode: "stream",
    async *handle(value, context) {
      assertActive();
      if (!sameBinding(binding, context.binding)) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
      const operation = preparedOperations?.get("agent.stream");
      if (operation?.mode !== "stream") refuse("EXECUTOR_RUNTIME_NOT_PREPARED");
      yield* operation.handle(value, {
        ...context,
        signal: AbortSignal.any([context.signal, lifetime.signal]),
      });
    },
  });
  return { operations, close, settled: settled.promise, signal: lifetime.signal };
}
