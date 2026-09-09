import { getPrivateAsyncIterator } from "#veryfront/security/private-iterator.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import {
  chainPrivatePromise as chain,
  createPrivateDeferred,
  observePrivatePromise,
  resolvePrivatePromise,
} from "#veryfront/security/private-promise.ts";
import type { JsonValue } from "#veryfront/schemas/index.ts";
import {
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
  tryGetVeryfrontCloudProviderFromModelId,
  VERYFRONT_CLOUD_MODEL_PREFIX,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { getExecutorModelAdditiveReasoningTokens } from "#veryfront/agent/hosted/executor-model-grant.ts";
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
  parseDiscoveryData,
} from "#veryfront/agent/hosted/executor-discovery-schema.ts";
import { verifyHostedRuntimeSourceBinding } from "#veryfront/agent/hosted/runtime-source-binding.ts";
import {
  resolveHostedRuntimeAllowedProviderTools,
  resolveHostedRuntimeAllowedTools,
} from "#veryfront/agent/hosted/runtime-request-config.ts";
import { resolveHostedRuntimeAllowedToolNames } from "#veryfront/agent/hosted/runtime-essential-tools.ts";
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
  getExecutorRuntimeSteeringSchema,
  parseRuntimePreparationData,
} from "#veryfront/agent/hosted/executor-runtime-prepare-schema.ts";

const apply = Reflect.apply;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const hasOwn = Object.hasOwn;
const objectSetPrototypeOf = Object.setPrototypeOf;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const objectEntries = Object.entries;
const arrayIncludes = Array.prototype.includes;
const arrayIsArray = Array.isArray;
const abortController = AbortController.prototype.abort;
const abortSignalAny = AbortSignal.any;
const AbortSignalConstructor = AbortSignal;
const mathMin = Math.min;
const numberIsSafeInteger = Number.isSafeInteger;
const addEventListener = EventTarget.prototype.addEventListener;
const removeEventListener = EventTarget.prototype.removeEventListener;
const iteratorSymbol = Symbol.iterator;

function combineSignals(...signals: AbortSignal[]): AbortSignal {
  const inputs = createPrivateSet(signals);
  defineOwnDataProperty(signals, iteratorSymbol, () => inputs.values());
  return apply(abortSignalAny, AbortSignalConstructor, [signals]) as AbortSignal;
}

function filter<T>(values: readonly T[], predicate: (value: T) => boolean): T[] {
  const filtered: T[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index] as T;
    if (!predicate(value)) continue;
    defineOwnDataProperty(
      filtered,
      filtered.length,
      value,
      { enumerable: true, configurable: true, writable: true },
    );
  }
  return filtered;
}
function includes<T>(values: readonly T[], value: T): boolean {
  return apply(arrayIncludes, values, [value]) as boolean;
}

function privateMapGet<K, V>(map: ReadonlyMap<K, V>, key: K): V | undefined {
  return apply(mapGet, map, [key]) as V | undefined;
}
function privateMapHas<K, V>(map: ReadonlyMap<K, V>, key: K): boolean {
  return apply(mapHas, map, [key]) as boolean;
}

function selectAllowedHostTools(
  tools: HostToolSet,
  allowedNames: readonly string[],
): HostToolSet {
  const allowed = createPrivateSet(allowedNames);
  const entries = apply(objectEntries, Object, [tools]) as Array<
    [string, HostToolSet[string]]
  >;
  const selected: HostToolSet = {};
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === undefined || !allowed.has(entry[0])) continue;
    defineOwnDataProperty(
      selected,
      entry[0],
      entry[1],
      { enumerable: true, configurable: true, writable: true },
    );
  }
  return selected;
}

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
    refresh(
      signal: AbortSignal,
      availableToolNames?: readonly string[],
    ): Promise<AgentSystem> | AgentSystem;
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
    createPrivateSet(parsed.models.map((model) => model.id)).size !== parsed.models.length
  ) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
  objectSetPrototypeOf(parsed, null);
  objectSetPrototypeOf(parsed.execution, null);
  return parsed;
}

function snapshotCheckpointFacade<I, C>(
  facade: { initial?: I; persist: (checkpoint: C) => void | Promise<void> } | undefined,
): { initial?: I; persist: (checkpoint: C) => void | Promise<void> } | undefined {
  if (!facade) return undefined;
  const descriptor = objectGetOwnPropertyDescriptor(facade, "initial");
  const initial = descriptor && hasOwn(descriptor, "value") ? descriptor.value as I : undefined;
  const persist = snapshotFacadeMethod(facade, "persist");
  const snapshot = {
    initial,
    persist: typeof persist === "function"
      ? (checkpoint: C) =>
        chain(
          resolvePrivatePromise(),
          () => apply(persist, facade, [checkpoint]) as void | Promise<void>,
        )
      : persist,
  };
  objectSetPrototypeOf(snapshot, null);
  return snapshot;
}

function snapshotFacadeMethod<T extends object, K extends keyof T>(facade: T, key: K): T[K] {
  let current: object | null = facade;
  for (let depth = 0; current !== null && current !== objectPrototype && depth < 128; depth++) {
    const descriptor = objectGetOwnPropertyDescriptor(current, key);
    if (descriptor) {
      const method = hasOwn(descriptor, "value") ? descriptor.value : undefined;
      return (typeof method === "function"
        ? (...args: unknown[]) => apply(method, facade, args)
        : undefined) as T[K];
    }
    current = objectGetPrototypeOf(current);
  }
  return undefined as T[K];
}

function snapshotSteeringFacade(
  facade: ExecutorRuntimeFacades["projectSteering"],
): ExecutorRuntimeFacades["projectSteering"] {
  if (!facade) return undefined;
  const snapshot = {
    prepare: snapshotFacadeMethod(facade, "prepare"),
    refresh: snapshotFacadeMethod(facade, "refresh"),
  };
  objectSetPrototypeOf(snapshot, null);
  return snapshot;
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
  return filter(
    granted,
    (name) =>
      (source === undefined || source === true || includes(source, name)) &&
      (requested === undefined || includes(requested, name)) && !includes(denied, name),
  );
}

/**
 * One allocation's fixed-project preparation/stream dispatcher. Metadata never
 * installs execution authority; project navigation requires separate broker support.
 */
export function createExecutorRuntimePreparation(input: Options) {
  const grant = snapshotGrant(input.grant);
  const modelGrants = new Map(grant?.models.map((model) => [model.id, model]) ?? []);
  const binding = parseRuntimePreparationData(getExecutorBindingSchema(), input.binding);
  const source = parseRuntimePreparationData(getExecutorDiscoverySourceSchema(), input.source);
  objectSetPrototypeOf(binding, null);
  objectSetPrototypeOf(source, null);
  const installedModelResolver = input.facades.resolveModelRuntime;
  const facades: ExecutorRuntimeFacades = {
    resolveModelRuntime: snapshotFacadeMethod(input.facades, "resolveModelRuntime"),
    cleanup: snapshotFacadeMethod(input.facades, "cleanup"),
    projectSteering: snapshotSteeringFacade(input.facades.projectSteering),
    latestConversationUserText: snapshotFacadeMethod(input.facades, "latestConversationUserText"),
    publishParentRunEvents: snapshotFacadeMethod(input.facades, "publishParentRunEvents"),
    hostTools: new Map(input.facades.hostTools),
    remoteToolSources: new Map(input.facades.remoteToolSources),
    toolExposureCheckpoint: snapshotCheckpointFacade(input.facades.toolExposureCheckpoint),
    providerReplayCheckpoint: snapshotCheckpointFacade(input.facades.providerReplayCheckpoint),
  };
  objectSetPrototypeOf(facades, null);
  const lifetime = new AbortController();
  let preparation: Promise<JsonValue> | undefined;
  let preparedOperations: ReadonlyMap<string, ExecutorOperation> | undefined;
  let closing: Promise<void> | undefined;
  let resourcesStarted = false;
  let cleanup: Promise<void> | undefined;
  let startup: Promise<ReadableStream<Uint8Array>> | undefined;
  let producerCompletion: Promise<void> | undefined;
  let streamSignal = lifetime.signal;
  const settled = createPrivateDeferred<void>();
  void chain(settled.promise, () => {}, () => {});
  const assertActive = () => {
    if (lifetime.signal.aborted || input.discovery.signal.aborted) {
      refuse("EXECUTOR_RUNTIME_CLOSED");
    }
  };
  const release = () => {
    cleanup ??= chain(resolvePrivatePromise(), async () => {
      // Startup can still reserve producer work. Join both before releasing
      // facades, without joining the stream handler that calls this cleanup.
      if (startup) await chain(startup, () => {}, () => {});
      if (producerCompletion) await observePrivatePromise(producerCompletion);
      if (resourcesStarted) await observePrivatePromise(facades.cleanup());
    });
    return cleanup;
  };
  function close(): Promise<void> {
    if (closing) return closing;
    closing = chain(resolvePrivatePromise(), async () => {
      if (preparation) await chain(preparation, () => {}, () => {});
      let failed = false;
      try {
        await release();
      } catch {
        failed = true;
      }
      try {
        await observePrivatePromise(input.discovery.close());
      } catch {
        failed = true;
      }
      preparedOperations = undefined;
      if (failed) refuse("EXECUTOR_RUNTIME_CLEANUP_FAILED");
    });
    void chain(closing, settled.resolve, settled.reject);
    apply(abortController, lifetime, []);
    apply(removeEventListener, input.discovery.signal, ["abort", onDiscoveryAbort]);
    return closing;
  }
  const onDiscoveryAbort = () => {
    void chain(close(), () => {}, () => {});
  };
  apply(addEventListener, input.discovery.signal, ["abort", onDiscoveryAbort, { once: true }]);
  if (input.discovery.signal.aborted) onDiscoveryAbort();

  function requireFacades(
    definition: RuntimeAgentMarkdownDefinition,
    effective: ExecutorRuntimeGrantData,
  ) {
    if (
      typeof facades.resolveModelRuntime !== "function" || typeof facades.cleanup !== "function"
    ) refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
    for (let index = 0; index < effective.hostToolFacadeIds.length; index++) {
      const id = effective.hostToolFacadeIds[index];
      if (id === undefined) continue;
      if (!privateMapHas(facades.hostTools, id)) refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
    }
    for (let index = 0; index < effective.remoteToolSourceIds.length; index++) {
      const id = effective.remoteToolSourceIds[index];
      if (id === undefined) continue;
      if (!privateMapHas(facades.remoteToolSources, id)) {
        refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
      }
    }
    const configuredServers = definition.mcpServers ?? [];
    for (let index = 0; index < configuredServers.length; index++) {
      const server = configuredServers[index];
      if (server === undefined) continue;
      if (!includes(effective.remoteToolSourceIds, server.id ?? server.kind)) {
        refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
      }
    }
    if (
      (effective.execution.projectId !== null ||
        includes(effective.requiredCapabilities ?? [], "project-steering")) &&
      (typeof facades.projectSteering?.prepare !== "function" ||
        typeof facades.projectSteering?.refresh !== "function")
    ) refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
    if (
      includes(effective.requiredCapabilities ?? [], "conversation-user-text") &&
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
      const operation = privateMapGet(input.discovery.operations, "agent.describe");
      if (operation?.mode !== "unary") refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
      const described = parseDiscoveryData(
        getExecutorAgentDescribeResultSchema(),
        await chain(
          resolvePrivatePromise(),
          () => operation.handle({ agentId: request.agentId }, context),
        ),
        true,
      );
      if (
        !described.ok || described.value.definition.id !== grant.agentId ||
        verifyHostedRuntimeSourceBinding(source, described.value.source)
      ) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
      const definition = described.value.definition;
      const modelId = request.modelId ?? grant.defaultModelId;
      const modelGrant = privateMapGet(modelGrants, modelId);
      if (
        !modelGrant || (request.maxSteps !== undefined && request.maxSteps > grant.maxSteps) ||
        (request.maxOutputTokens !== undefined &&
          request.maxOutputTokens > modelGrant.maxOutputTokens)
      ) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
      const thinking = request.thinking ?? definition.thinking ??
        resolveVeryfrontCloudModelThinking(modelId);
      let availableOutputTokens = modelGrant.maxOutputTokens;
      const modelProvider = tryGetVeryfrontCloudProviderFromModelId(modelId);
      if (modelProvider === "anthropic") {
        try {
          const effectiveThinking = thinking ?? resolveVeryfrontCloudModelThinking(modelId);
          const model = { id: modelId, modelId, provider: modelProvider };
          const options = {
            reasoning: resolveVeryfrontCloudReasoningOption(modelId, effectiveThinking),
            providerOptions: resolveVeryfrontCloudThinkingProviderOptions(
              modelId,
              effectiveThinking,
            ),
          };
          objectSetPrototypeOf(model, null);
          objectSetPrototypeOf(options, null);
          availableOutputTokens -= getExecutorModelAdditiveReasoningTokens({ model, options });
        } catch {
          refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
        }
      }
      const maxOutputTokens = request.maxOutputTokens ?? availableOutputTokens;
      if (
        !numberIsSafeInteger(maxOutputTokens) || maxOutputTokens <= 0 ||
        maxOutputTokens > availableOutputTokens
      ) {
        refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
      }
      requireFacades(definition, grant);
      const runtime = input.discovery.getRuntime();
      // Enroll only after agent.describe returns: a failed discovery operation
      // can await discovery.close(). No remaining preparation work awaits it.
      input.discovery.retainRuntimeTask(preparation!);
      let localTools: HostToolSet = Object.fromEntries(
        filter(
          [...runtime.tools],
          ([id, value]) =>
            !isSkillInfrastructureToolId(id) && isToolVisibleTo(value, { agentId: definition.id }),
        ),
      );
      for (let index = 0; index < grant.hostToolFacadeIds.length; index++) {
        const id = grant.hostToolFacadeIds[index];
        if (id === undefined) continue;
        // Object spread creates own data properties without invoking mutable
        // Object.assign or inherited setters with private facade values.
        localTools = { ...localTools, ...privateMapGet(facades.hostTools, id) };
      }
      const normalizeToolNames = (names: readonly string[]) => [
        ...resolveOwnerScopedToolNames({
          toolNames: names,
          agentId: definition.id,
          localTools,
        })!,
      ];
      const deniedToolSet = createPrivateSet(definition.deniedTools ?? []);
      const normalizedDenials = normalizeToolNames(definition.deniedTools ?? []);
      for (let index = 0; index < normalizedDenials.length; index++) {
        const name = normalizedDenials[index];
        if (name !== undefined) deniedToolSet.add(name);
      }
      const deniedToolNames = [...deniedToolSet];
      const sourceToolNames = resolveHostedRuntimeAllowedTools({
        configuredTools: definition.tools,
        configuredDeniedTools: definition.deniedTools,
        configuredDelegates: definition.delegates,
        configuredSkills: definition.skills,
        requestedTools: undefined,
      });
      let allowedToolNames = intersectNames(
        normalizeToolNames(grant.allowedToolNames),
        arrayIsArray(sourceToolNames) ? normalizeToolNames(sourceToolNames) : sourceToolNames,
        request.allowedToolNames === undefined
          ? undefined
          : normalizeToolNames(request.allowedToolNames),
        deniedToolNames,
      );
      if (includes(allowedToolNames, "studio_open_project")) {
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
        if (!privateMapHas(modelGrants, id)) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
        return facades.resolveModelRuntime(id) ?? refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
      };
      registerModelRuntimeResolverRevoker(
        resolveModelRuntime,
        () => revokeModelRuntimeResolver(installedModelResolver),
      );
      // The first facade call can reserve resources before throwing.
      resourcesStarted = true;
      resolveModelRuntime(modelId);
      const execution = grant.execution;
      const steeringResult = facades.projectSteering
        ? await observePrivatePromise(facades.projectSteering.prepare({
          definition,
          projectId: execution.projectId,
          branchId: execution.branchId,
          signal: context.signal,
        }))
        : undefined;
      const steering = steeringResult === undefined ? undefined : parseRuntimePreparationData(
        getExecutorRuntimeSteeringSchema(),
        steeringResult,
      );
      assertActive();
      if (steering && steering.agent.id !== definition.id) refuse("EXECUTOR_RUNTIME_NOT_GRANTED");
      const skills = resolveRuntimeSkillSelectorForAgent({
        skills: steering?.initialSkills ?? [],
        agentId: definition.id,
        selector: definition.skills === false ? [] : definition.skills,
      });
      if (sourceToolNames !== undefined || request.allowedToolNames === undefined) {
        const effectiveSourceTools = resolveHostedRuntimeAllowedToolNames({
          allowedToolNames: normalizeToolNames(sourceToolNames ?? allowedToolNames),
          localToolNames: filter(
            normalizeToolNames(grant.allowedToolNames),
            (name) => hasOwn(localTools, name),
          ),
          availableSkillIds: skills.allowedSkillIds,
          configDerivedSelector: request.allowedToolNames === undefined &&
            !(definition.tools === true && (definition.deniedTools?.length ?? 0) > 0),
        });
        allowedToolNames = intersectNames(
          normalizeToolNames(grant.allowedToolNames),
          effectiveSourceTools === null ? undefined : [...effectiveSourceTools],
          request.allowedToolNames === undefined
            ? undefined
            : normalizeToolNames(request.allowedToolNames),
          deniedToolNames,
        );
      }
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
      objectSetPrototypeOf(taskContext, null);
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
              skills: includes(allowedToolNames, "load_skill") ? skills.definitions : [],
              environmentContext: steering.environmentContext,
              availableToolNames: allowedToolNames,
            })
            : definition.system ?? definition.instructions),
        temperature: request.temperature ?? definition.temperature,
        thinking,
        maxSteps: mathMin(
          request.maxSteps ?? grant.maxSteps,
          definition.maxSteps ?? grant.maxSteps,
          grant.maxSteps,
        ),
        maxOutputTokens,
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
      objectSetPrototypeOf(options, null);
      const remoteToolSources: RemoteToolSource[] = [];
      for (let index = 0; index < grant.remoteToolSourceIds.length; index++) {
        const id = grant.remoteToolSourceIds[index];
        if (id === undefined) continue;
        let remoteToolSource = privateMapGet(facades.remoteToolSources, id)!;
        const servers = filter(
          definition.mcpServers ?? [],
          (server) => (server.id ?? server.kind) === id,
        );
        for (let serverIndex = 0; serverIndex < servers.length; serverIndex++) {
          const server = servers[serverIndex];
          if (server !== undefined) {
            remoteToolSource = wrapRemoteToolSourceWithMcpPolicy(
              remoteToolSource,
              server.toolPolicy,
            );
          }
        }
        defineOwnDataProperty(
          remoteToolSources,
          remoteToolSources.length,
          remoteToolSource,
          { enumerable: true, configurable: true, writable: true },
        );
      }
      const facadeAllowedToolSet = createPrivateSet<string>();
      for (let index = 0; index < allowedToolNames.length; index++) {
        const name = allowedToolNames[index];
        if (name !== undefined) facadeAllowedToolSet.add(name);
      }
      for (let index = 0; index < providerToolNames.length; index++) {
        const name = providerToolNames[index];
        if (name !== undefined) facadeAllowedToolSet.add(name);
      }
      const facadeAllowedToolNames = [...facadeAllowedToolSet];
      const assemblyInput: Parameters<typeof prepareFacadedHostedChatRuntimeToolAssembly>[0] = {
        signal: context.signal,
        taskContext,
        instructions: options.instructions,
        localTools: selectAllowedHostTools(localTools, facadeAllowedToolNames),
        sourceIntegrationPolicy: runtime.sourceIntegrationPolicy,
        hostToolPolicy: { allow: facadeAllowedToolNames },
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
        remoteToolSources,
        onSteeringMutation: (mutation) => {
          if (mutation.instructionsChanged || mutation.skillsChanged) {
            incrementSteeringRevision(taskContext);
          }
        },
        loadLatestConversationUserText: facades.latestConversationUserText,
      };
      objectSetPrototypeOf(assemblyInput, null);
      const toolAssembly = await observePrivatePromise(
        prepareFacadedHostedChatRuntimeToolAssembly(assemblyInput),
      );
      assertActive();
      for (const name of toolAssembly.normalizedAllowedToolNames ?? []) {
        if (!includes(toolAssembly.authorizedToolNames, name)) {
          refuse("EXECUTOR_RUNTIME_CAPABILITY_UNAVAILABLE");
        }
      }
      const scopedAssembly = {
        ...toolAssembly,
        runtimeTools: scopeHostedRuntimeToolResults(toolAssembly.runtimeTools),
      };
      objectSetPrototypeOf(scopedAssembly, null);
      const runtimeInput: PreparedHostedRuntimeAgentOptions = {
        options,
        taskContext,
        toolAssembly: scopedAssembly,
        modelId,
        sourceIntegrationPolicy: runtime.sourceIntegrationPolicy,
        refreshSystem: facades.projectSteering
          ? () => facades.projectSteering!.refresh(streamSignal, allowedToolNames)
          : undefined,
      };
      const runtimeOptions: NonNullable<Parameters<typeof createPreparedHostedRuntimeAgent>[1]> = {
        resolveModelRuntime,
        preserveToolCatalog: true,
        onStreamCompletion: (completion) => {
          producerCompletion = completion;
          input.discovery.retainRuntimeTask(completion);
        },
      };
      objectSetPrototypeOf(runtimeInput, null);
      objectSetPrototypeOf(runtimeOptions, null);
      const runtimeAgent = runWithProjectAgentRuntime(
        runtime,
        () => createPreparedHostedRuntimeAgent(runtimeInput, runtimeOptions),
      );
      assertActive();
      const preparedRuntimeHandle = crypto.randomUUID();
      preparedOperations = createExecutorAgentOperations({
        preparedRuntimeHandle,
        startStream: (streamInput) => {
          streamSignal = streamInput.abortSignal;
          startup = chain(resolvePrivatePromise(), () => {
            assertActive();
            const streamOptions: Parameters<typeof createHostedChatRuntimeDataStream>[0] = {
              runtimeAgent,
              sourceIntegrationPolicy: runtime.sourceIntegrationPolicy,
              agentId: definition.id,
              projectId: execution.projectId ?? undefined,
              projectSlug: execution.projectSlug,
              ...(execution.kind === "canonical"
                ? { runId: execution.runId, conversationId: execution.conversationId }
                : {}),
              maxOutputTokens: options.maxOutputTokens,
            };
            objectSetPrototypeOf(streamOptions, null);
            return createHostedChatRuntimeDataStream(streamOptions, streamInput);
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
          void chain(close(), () => {}, () => {});
        };
        apply(addEventListener, context.signal, ["abort", cancel, { once: true }]);
        preparation = prepare(request, {
          ...context,
          signal: combineSignals(context.signal, lifetime.signal),
        });
        if (context.signal.aborted) cancel();
        try {
          return await observePrivatePromise(preparation);
        } finally {
          apply(removeEventListener, context.signal, ["abort", cancel]);
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
      const operation = preparedOperations === undefined
        ? undefined
        : privateMapGet(preparedOperations, "agent.stream");
      if (operation?.mode !== "stream") refuse("EXECUTOR_RUNTIME_NOT_PREPARED");
      yield* getPrivateAsyncIterator(operation.handle(value, {
        ...context,
        signal: combineSignals(context.signal, lifetime.signal),
      }));
    },
  });
  return { operations, close, settled: settled.promise, signal: lifetime.signal };
}
