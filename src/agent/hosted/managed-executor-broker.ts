import {
  parseSourceIntegrationPolicyManifest,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import { snapshotOwnDataRecords } from "#veryfront/security/own-data-record.ts";
import { reserveExecutorToolMetadata } from "#veryfront/agent/hosted/executor-tool-schema.ts";
import type {
  TrustedManagedRuntime,
  TrustedManagedRuntimeFactory,
} from "#veryfront/agent/hosted/trusted-managed-runtime-contract.ts";
import { EXECUTOR_PROJECT_TOOL_SOURCE_ID } from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import {
  type ExecutorProjectToolInstall,
  getExecutorProjectToolInstallSchema,
} from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import type { AgentModelRuntimeResolver } from "../runtime/model-transport.ts";
import {
  createExecutorOperationGate,
  type ExecutorOperationGate,
} from "../executor/operation-gate.ts";
import type { ExecutorBinding } from "../executor/protocol.ts";
import type { HostedChatRuntimeAgent } from "#veryfront/agent/hosted/chat-runtime-contract.ts";
import {
  createHostedExecutorSessionPool,
  type HostedExecutorSessionPoolOptions,
} from "#veryfront/agent/hosted/executor-session-pool.ts";
import {
  createHostedExecutorSessionClock,
  type HostedExecutorOwnedWork,
  type HostedExecutorSessionCloseResult,
  type HostedExecutorSessionOptions,
} from "#veryfront/agent/hosted/executor-session.ts";
import {
  getHostedExecutorAllocationRequestSchema,
  parseHostedExecutorData,
  sameHostedExecutorOwner,
} from "#veryfront/agent/hosted/executor-session-schema.ts";
import { verifyHostedRuntimeSourceBinding } from "#veryfront/agent/hosted/runtime-source-binding.ts";
import {
  type ExecutorRuntimeInstall,
  getExecutorRuntimeInstallSchema,
  parseExecutorInstallation,
} from "#veryfront/agent/hosted/executor-runtime-install-schema.ts";
import {
  ExecutorRuntimePreparationError,
  type ExecutorRuntimePrepareRequest,
  getExecutorRuntimePrepareRequestSchema,
  getExecutorRuntimePrepareResultSchema,
  isExecutorRuntimePreparationFailureCode,
  parseRuntimePreparationData,
} from "#veryfront/agent/hosted/executor-runtime-prepare-schema.ts";
import {
  ExecutorDiscoveryError,
  getExecutorAgentDescribeResultSchema,
  parseDiscoveryData,
} from "#veryfront/agent/hosted/executor-discovery-schema.ts";
import { ExecutorAgentError } from "#veryfront/agent/hosted/executor-agent-schema.ts";
import { createExecutorHostedChatRuntimeAgent } from "#veryfront/agent/hosted/executor-agent-bridge.ts";
import {
  createEphemeralHostedExecutorModelBroker,
  createHostedExecutorModelBroker,
} from "#veryfront/agent/hosted/executor-model-dispatch.ts";
import type { ExecutorModelGrant } from "#veryfront/agent/hosted/executor-model-grant.ts";
import {
  createExecutorToolBroker,
  type ExecutorToolCapability,
} from "#veryfront/agent/hosted/executor-tool-bridge.ts";
import {
  type ExecutorToolLimits,
  executorToolLimits,
} from "#veryfront/agent/hosted/executor-tool-schema.ts";
import { createExecutorPersistenceBroker } from "#veryfront/agent/hosted/executor-persistence-bridge.ts";
import { executorInitialCheckpointsOperation } from "#veryfront/agent/hosted/executor-checkpoint-state.ts";
import { createExecutorStateBroker } from "#veryfront/agent/hosted/executor-state-bridge.ts";
import { executorStateOperations } from "#veryfront/agent/hosted/executor-state-schema.ts";
import type { ExecutorOperation } from "../executor/channel.ts";

type SessionInput = Omit<HostedExecutorSessionOptions, "createOperations">;
type InstallInput = Omit<ExecutorRuntimeInstall, "binding">;
type PersistenceInput = Omit<
  Parameters<typeof createExecutorPersistenceBroker>[0],
  "expectedBinding" | "capabilityIds"
>;
type StateInput = Omit<
  Parameters<typeof createExecutorStateBroker>[0],
  "expectedBinding" | "capabilityIds" | "agentId" | "projectId" | "branchId" | "allowedToolNames"
>;

/** Prepared executor handle with broker-owned execution and retirement. */
export interface ManagedExecutorRuntime {
  readonly definition: RuntimeAgentMarkdownDefinition;
  readonly modelId: string;
  readonly runtimeKind: "framework";
  readonly agent: HostedChatRuntimeAgent;
  readonly settled: Promise<void>;
  readonly accepted: boolean;
  /** Broker-only work; must not await this runtime's close or settled promise. */
  runOwned<T>(operation: () => Promise<T>): Promise<T>;
  accept(ownership: { kind: "request" } | { kind: "execution"; signal?: AbortSignal }): void;
  close(reason?: "completed" | "canceled"): Promise<HostedExecutorSessionCloseResult>;
}

/**
 * Trusted per-invocation source, model, tool, persistence, and state authority.
 * Broker model limits, provider tools, and tool capabilities must not exceed
 * the corresponding installed grant. Startup rejects mismatches before allocation.
 */
export interface ManagedExecutorStartInput {
  /** Trusted ingress configuration; never selected by a project protocol message. */
  trustedRuntime?: {
    projectToolNames: readonly string[];
    sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  };
  /** Bind canonical persistence to the admitted session before readiness work starts. */
  bindSessionOwnedWork?: (owner: HostedExecutorOwnedWork) => void;
  session: SessionInput;
  installation: InstallInput;
  prepare: ExecutorRuntimePrepareRequest;
  model: {
    resolver: AgentModelRuntimeResolver;
    grant: ExecutorModelGrant;
    runEventSink?: AgentRunEventSink;
  };
  tools: {
    /** Complete trusted inventory, including project-local tools, before selector resolution. */
    catalog: ReadonlyMap<string, { readonly ownerAgentId?: string; readonly shortName?: string }>;
    sources: ReadonlyMap<string, ExecutorToolCapability>;
    maxCalls: number;
    maxConcurrent: number;
    limits?: Parameters<typeof createExecutorToolBroker>[0]["limits"];
  };
  persistence: PersistenceInput;
  state: StateInput;
}
type ManagedExecutorOperationInput =
  & Pick<
    ManagedExecutorStartInput,
    "model" | "persistence" | "state"
  >
  & { tools: ManagedExecutorStartInput["tools"] & { limits: ExecutorToolLimits } };

/** Process admission and shutdown limits for a managed broker. */
export type ManagedExecutorBrokerOptions = Omit<
  HostedExecutorSessionPoolOptions,
  "createSession"
>;

/** Compose an executor pool with authenticated installation and operation gates. */
export function createManagedExecutorBroker(
  options: ManagedExecutorBrokerOptions,
  trustedRuntimeFactory?: TrustedManagedRuntimeFactory,
) {
  if (trustedRuntimeFactory !== undefined && typeof trustedRuntimeFactory !== "function") {
    throw new TypeError("Invalid trusted runtime composition");
  }
  const pool = createHostedExecutorSessionPool(options);

  async function start(
    input: ManagedExecutorStartInput,
    lifecycle: { onAdmitted?(settled: Promise<void>): void } = {},
  ): Promise<ManagedExecutorRuntime> {
    if (Boolean(trustedRuntimeFactory) !== (input.trustedRuntime !== undefined)) {
      throw new TypeError("Trusted runtime configuration requires its dedicated broker entrypoint");
    }
    const request = parseHostedExecutorData(
      getHostedExecutorAllocationRequestSchema(),
      input.session.request,
    );
    const clock = input.session.clock ?? createHostedExecutorSessionClock(Date.now());
    // Generation one is used only to validate local operation descriptors.
    // Actual authority is rebuilt against the allocator's authenticated binding.
    const validationBinding: ExecutorBinding = {
      allocationId: request.allocationId,
      generation: 1,
      invocationId: request.invocationId,
    };
    let installation = parseExecutorInstallation(getExecutorRuntimeInstallSchema(), {
      ...input.installation,
      binding: validationBinding,
    });
    const prepare = parseRuntimePreparationData(
      getExecutorRuntimePrepareRequestSchema(),
      input.prepare,
    );
    const selectedModelId = prepare.modelId ?? installation.grant.defaultModelId;
    if (
      !sameHostedExecutorOwner(installation.owner, request.owner) ||
      verifyHostedRuntimeSourceBinding(request.source, installation.source) !==
        undefined ||
      prepare.agentId !== installation.grant.agentId
    ) throw new TypeError("Managed executor installation does not match its session");
    const allowedModelIds = new Set(installation.grant.models.map((model) => model.id));
    const operationInput = snapshotOperationInput(input);
    constrainInstalledOperationGrants(operationInput, installation);
    installation = parseExecutorInstallation(getExecutorRuntimeInstallSchema(), installation);
    const trusted = input.trustedRuntime === undefined
      ? undefined
      : snapshotTrustedRuntime(input.trustedRuntime, installation, operationInput);
    const bindSessionOwnedWork = input.bindSessionOwnedWork;
    if (
      installation.grant.execution.kind === "ephemeral" &&
      operationInput.model.runEventSink !== undefined
    ) {
      throw new TypeError("Ephemeral executor model dispatch cannot receive a run event sink");
    }
    if (
      installation.grant.execution.kind === "canonical" &&
      typeof bindSessionOwnedWork !== "function"
    ) {
      throw new TypeError("Canonical executor persistence requires session-owned work binding");
    }
    if (bindSessionOwnedWork !== undefined && typeof bindSessionOwnedWork !== "function") {
      throw new TypeError("Invalid executor session-owned work binder");
    }
    // Validate every trusted capability before reserving pool admission.
    buildBrokerOperations(
      validationBinding,
      new AbortController().signal,
      operationInput,
      installation,
      allowedModelIds,
      selectedModelId,
    );

    let gate: ExecutorOperationGate | undefined;
    let localRuntime: TrustedManagedRuntime | undefined;
    const session = pool.start({
      ...input.session,
      request,
      clock,
      createOperations(binding, signal) {
        if (trusted) {
          return {
            operations: new Map<string, ExecutorOperation>(),
            revoke() {
              gate?.revoke();
              void localRuntime?.close().catch(() => {});
            },
          };
        }
        const channelBinding = toChannelBinding(binding);
        const operations = buildBrokerOperations(
          channelBinding,
          signal,
          operationInput,
          installation,
          allowedModelIds,
          selectedModelId,
        );
        gate = createExecutorOperationGate({
          binding: channelBinding,
          signal,
          operations,
          preparationOperations: new Set([
            ...Object.values(executorStateOperations),
            executorInitialCheckpointsOperation,
          ].filter((name) => operations.has(name))),
        });
        return { operations: gate.operations, revoke: gate.revoke };
      },
    });
    try {
      bindSessionOwnedWork?.(session.runOwned.bind(session));
      lifecycle.onAdmitted?.(session.settled);
      const channel = await session.ready;
      const binding = session.binding;
      if (!binding || (!trusted && !gate)) throw new Error("Managed executor session is not bound");
      const channelBinding = toChannelBinding(binding);
      const installRequest = parseExecutorInstallation(getExecutorRuntimeInstallSchema(), {
        ...installation,
        binding: channelBinding,
      });
      const installed = await channel.request(
        "runtime.install",
        trusted
          ? {
            ...trusted.projectInstallation,
            binding: channelBinding,
          }
          : installRequest,
      );
      if (
        !installed || typeof installed !== "object" || Array.isArray(installed) ||
        Object.keys(installed).length !== 1 || installed.installed !== true
      ) throw new Error("Managed executor installation acknowledgement is invalid");
      const description = parseDiscoveryData(
        getExecutorAgentDescribeResultSchema(),
        await channel.request("agent.describe", { agentId: prepare.agentId }),
        true,
      );
      if (!description.ok) throw new ExecutorDiscoveryError(description.code);
      if (
        description.value.definition.id !== prepare.agentId ||
        verifyHostedRuntimeSourceBinding(installation.source, description.value.source) !==
          undefined
      ) throw new ExecutorDiscoveryError("EXECUTOR_DISCOVERY_INVALID_OUTPUT");
      if (trusted) {
        localRuntime = await session.runOwned(() =>
          trustedRuntimeFactory!({
            binding: channelBinding,
            defaultTimeoutMs: Math.max(1, request.hardDeadlineAt - clock.now()),
            installation: installRequest,
            projectChannel: channel,
            projectToolNames: trusted.projectInstallation.allowedToolNames,
            toolLimits: operationInput.tools.limits,
            sourceIntegrationPolicy: trusted.sourceIntegrationPolicy,
            createGate(projectTools) {
              const localOperations = buildBrokerOperations(
                channelBinding,
                session.signal,
                {
                  ...operationInput,
                  tools: {
                    ...operationInput.tools,
                    limits: reserveExecutorToolMetadata(
                      operationInput.tools.limits,
                      projectTools.aliasMetadataBytes,
                    ),
                    sources: new Map([...operationInput.tools.sources, [projectTools.id, {
                      source: projectTools,
                      retired: session.settled,
                      allowedToolNames: new Set(trusted.projectInstallation.allowedToolNames),
                      projectContext: "skill",
                      context: {
                        ...trusted.projectInstallation.context,
                        projectId: trusted.projectInstallation.context.projectId ?? undefined,
                        runIdBindsToolAuthorization: true,
                      },
                    }]]),
                  },
                },
                installation,
                allowedModelIds,
                selectedModelId,
              );
              return createExecutorOperationGate({
                binding: channelBinding,
                signal: session.signal,
                operations: localOperations,
                preparationOperations: new Set([
                  ...Object.values(executorStateOperations),
                  executorInitialCheckpointsOperation,
                ].filter((name) => localOperations.has(name))),
              });
            },
            signal: session.signal,
            runOwned: session.runOwned.bind(session),
            requestSessionClose: () => {
              void session.close("canceled");
            },
          })
        );
        gate = localRuntime.gate;
      }
      const executionChannel = localRuntime?.channel ?? channel;
      const prepared = parseRuntimePreparationData(
        getExecutorRuntimePrepareResultSchema(),
        await executionChannel.request("runtime.prepare", prepare),
      );
      if (!prepared.ok) {
        if (isExecutorRuntimePreparationFailureCode(prepared.code)) {
          throw new ExecutorRuntimePreparationError(prepared.code);
        }
        throw new ExecutorAgentError(prepared.code);
      }
      if (
        !allowedModelIds.has(prepared.value.modelId) || prepared.value.modelId !== selectedModelId
      ) {
        throw new ExecutorRuntimePreparationError("EXECUTOR_RUNTIME_NOT_GRANTED");
      }
      gate!.markPrepared();
      const remoteAgent = createExecutorHostedChatRuntimeAgent({
        channel: executionChannel,
        preparedRuntimeHandle: prepared.value.preparedRuntimeHandle,
      });
      const agent: HostedChatRuntimeAgent = {
        async stream(streamInput) {
          if (!session.accepted || gate!.state !== "prepared") {
            throw new Error("Managed executor runtime is not accepted");
          }
          gate!.beginExecution();
          return await remoteAgent.stream(streamInput);
        },
      };
      const settled = Promise.all([session.settled, gate!.settled, localRuntime?.settled]).then(
        () => undefined,
      );
      return {
        definition: description.value.definition,
        modelId: prepared.value.modelId,
        runtimeKind: prepared.value.runtimeKind,
        agent,
        settled,
        runOwned: session.runOwned.bind(session),
        get accepted() {
          return session.accepted;
        },
        accept(ownership) {
          session.accept(ownership);
        },
        close(reason = "canceled") {
          gate!.revoke();
          return session.close(reason);
        },
      } as ManagedExecutorRuntime;
    } catch (error) {
      gate?.revoke();
      await session.close("canceled").catch(() => {});
      // The pool retains admission until raw session/gate work settles. Startup
      // failure returns after bounded close notification, even for noncooperative work.
      void Promise.allSettled([session.settled, gate?.settled]);
      throw error;
    }
  }

  return {
    get active() {
      return pool.active;
    },
    signal: pool.signal,
    closed: pool.closed,
    settled: pool.settled,
    start,
    shutdown: pool.shutdown.bind(pool),
  };
}

function snapshotTrustedRuntime(
  input: NonNullable<ManagedExecutorStartInput["trustedRuntime"]>,
  installation: ExecutorRuntimeInstall,
  operations: ManagedExecutorOperationInput,
): {
  projectInstallation: ExecutorProjectToolInstall;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
} {
  const execution = installation.grant.execution;
  if (
    execution.kind !== "canonical" ||
    (execution.projectId === null && installation.owner.scopeKind !== "global") ||
    !installation.grant.remoteToolSourceIds.includes(EXECUTOR_PROJECT_TOOL_SOURCE_ID) ||
    installation.grant.hostToolFacadeIds.includes(EXECUTOR_PROJECT_TOOL_SOURCE_ID) ||
    operations.tools.sources.has(EXECUTOR_PROJECT_TOOL_SOURCE_ID) ||
    input.sourceIntegrationPolicy === undefined
  ) {
    throw new TypeError("Trusted runtime project configuration is incomplete");
  }
  const projectInstallation = parseExecutorInstallation(getExecutorProjectToolInstallSchema(), {
    version: 1,
    mode: "project-tools",
    binding: installation.binding,
    owner: installation.owner,
    source: installation.source,
    root: installation.root,
    context: {
      agentId: installation.grant.agentId,
      projectId: execution.projectId,
      runId: execution.runId,
      ...(execution.userId === undefined ? {} : { userId: execution.userId }),
      ...(execution.projectSlug === undefined ? {} : { projectSlug: execution.projectSlug }),
    },
    allowedToolNames: input.projectToolNames,
    maxCalls: operations.tools.maxCalls,
    maxConcurrent: operations.tools.maxConcurrent,
    limits: operations.tools.limits,
  });
  const limits = operations.tools.limits;
  const totalTools = projectInstallation.allowedToolNames.length +
    [...operations.tools.sources.values()].reduce(
      (count, source) => count + source.allowedToolNames.size,
      0,
    );
  if (
    operations.tools.sources.size + 1 > limits.maxSources || totalTools > limits.maxTotalTools ||
    projectInstallation.allowedToolNames.length > limits.maxToolsPerSource
  ) {
    throw new TypeError("Combined tool catalog exceeds the invocation limits");
  }
  if (
    projectInstallation.allowedToolNames.some((name) =>
      !installation.grant.allowedToolNames.includes(name)
    )
  ) {
    throw new TypeError("Project tool authority exceeds the normalized invocation grant");
  }
  return {
    projectInstallation,
    sourceIntegrationPolicy: parseSourceIntegrationPolicyManifest(
      snapshotOwnDataRecords(input.sourceIntegrationPolicy),
    ),
  };
}

function constrainInstalledOperationGrants(
  input: ManagedExecutorOperationInput,
  installation: ExecutorRuntimeInstall,
): void {
  for (const installed of installation.grant.models) {
    const policy = input.model.grant.models.get(installed.id);
    // The model broker validates missing policies, IDs, and malformed limits.
    if (!policy) continue;
    if (policy.maxOutputTokens > installed.maxOutputTokens) {
      throw new TypeError("Broker model output allowance exceeds the installed model grant");
    }
    const allowedProviderTools = new Set(installed.providerToolNames);
    if (policy.providerTools.some((tool) => !allowedProviderTools.has(tool.name))) {
      throw new TypeError("Broker provider tool policy exceeds the installed model grant");
    }
    // Preparation must produce requests that fit the broker's effective policy.
    installed.maxOutputTokens = policy.maxOutputTokens;
    installed.providerToolNames = policy.providerTools.map((tool) => tool.name);
  }
  const allowedTools = installedToolNames(installation, input.tools.catalog);
  const allowedSources = new Set([
    ...installation.grant.hostToolFacadeIds,
    ...installation.grant.remoteToolSourceIds,
  ]);
  for (const [sourceId, capability] of input.tools.sources) {
    if (!allowedSources.has(sourceId)) {
      throw new TypeError("Broker tool source exceeds the installed source grant");
    }
    for (const name of capability.allowedToolNames) {
      if (!allowedTools.has(name)) {
        throw new TypeError("Broker tool capability exceeds the installed tool grant");
      }
    }
  }
  installation.grant.allowedToolNames = [...allowedTools];
  // Source listings describe callable tools; only trusted ingress supplies ownership.
  const hostToolAliases: NonNullable<ExecutorRuntimeInstall["hostToolAliases"]> = [];
  for (const sourceId of installation.grant.hostToolFacadeIds) {
    for (const toolName of input.tools.sources.get(sourceId)?.allowedToolNames ?? []) {
      const metadata = input.tools.catalog.get(toolName);
      if (
        metadata?.ownerAgentId === installation.grant.agentId && metadata.shortName !== undefined
      ) {
        hostToolAliases.push({
          sourceId,
          toolName,
          ownerAgentId: metadata.ownerAgentId,
          shortName: metadata.shortName,
        });
      }
    }
  }
  if (hostToolAliases.length) installation.hostToolAliases = hostToolAliases;
  else delete installation.hostToolAliases;
}

function installedToolNames(
  installation: ExecutorRuntimeInstall,
  catalog: ManagedExecutorStartInput["tools"]["catalog"],
): Set<string> {
  const allowed = new Set<string>();
  const agentId = installation.grant.agentId;
  for (const selector of installation.grant.allowedToolNames) {
    let owned: string | undefined;
    for (const [id, tool] of catalog) {
      if (tool.ownerAgentId !== agentId || tool.shortName !== selector) continue;
      if (owned !== undefined && owned !== id) {
        throw new TypeError("Managed executor tool catalog has an ambiguous owned selector");
      }
      owned = id;
    }
    const resolved = owned ?? selector;
    const tool = catalog.get(resolved);
    if (tool && (tool.ownerAgentId === undefined || tool.ownerAgentId === agentId)) {
      allowed.add(resolved);
    }
  }
  return allowed;
}

function buildBrokerOperations(
  binding: ExecutorBinding,
  signal: AbortSignal,
  input: ManagedExecutorOperationInput,
  installation: ExecutorRuntimeInstall,
  allowedModelIds: ReadonlySet<string>,
  selectedModelId: string,
): ReadonlyMap<string, ExecutorOperation> {
  const scope = { binding, signal, assertActive: () => signal.throwIfAborted() };
  const model = installation.grant.execution.kind === "canonical"
    ? createHostedExecutorModelBroker({
      resolveModelRuntime: input.model.resolver,
      allowedModelIds,
      scope,
      grant: input.model.grant,
      runEventSink: input.model.runEventSink,
    })
    : createEphemeralHostedExecutorModelBroker({
      resolveModelRuntime: input.model.resolver,
      allowedModelIds,
      scope,
      grant: input.model.grant,
      prepared: { conversationId: null, canonicalRootRun: null },
    });
  const tools = createExecutorToolBroker({ scope, ...input.tools });
  const persistence = createExecutorPersistenceBroker({
    expectedBinding: binding,
    capabilityIds: installation.capabilities.persistence,
    ...input.persistence,
  });
  const execution = installation.grant.execution;
  const state = createExecutorStateBroker({
    expectedBinding: binding,
    capabilityIds: {
      projectSteering: installation.capabilities.projectSteering,
      conversationUserText: installation.capabilities.conversationUserText,
    },
    agentId: installation.grant.agentId,
    projectId: execution.projectId,
    branchId: execution.branchId,
    ...input.state,
    allowedToolNames: [
      ...installation.grant.allowedToolNames,
      ...(installation.grant.models.find((model) => model.id === selectedModelId)
        ?.providerToolNames ??
        []),
    ],
  });
  const combined = new Map<string, ExecutorOperation>();
  for (const operations of [model, tools, persistence, state]) {
    for (const [name, operation] of operations) {
      if (combined.has(name)) throw new TypeError("Managed executor operation collision");
      combined.set(name, operation);
    }
  }
  return combined;
}

function snapshotOperationInput(input: ManagedExecutorStartInput): ManagedExecutorOperationInput {
  if (input.tools.catalog === undefined) {
    throw new TypeError("Managed executor tool catalog is required");
  }
  const catalog = new Map([...input.tools.catalog].map(([id, tool]) => [
    id,
    Object.freeze({
      ownerAgentId: tool.ownerAgentId,
      shortName: tool.shortName,
    }),
  ]));
  const sources = new Map<string, ExecutorToolCapability>();
  for (const [id, capability] of input.tools.sources) {
    const source = capability.source;
    const context = capability.context;
    sources.set(id, {
      source: Object.freeze({
        id: source.id,
        listTools: source.listTools.bind(source),
        executeTool: source.executeTool.bind(source),
      }),
      allowedToolNames: new Set(capability.allowedToolNames),
      retired: capability.retired,
      context: Object.freeze({
        ...context,
        ...(context.publishDataEvent
          ? { publishDataEvent: context.publishDataEvent.bind(context) }
          : {}),
      }),
    });
  }
  return {
    model: {
      resolver: input.model.resolver,
      grant: {
        maxCalls: input.model.grant.maxCalls,
        maxConcurrentCalls: input.model.grant.maxConcurrentCalls,
        models: new Map([...input.model.grant.models].map(([id, policy]) => [id, {
          maxOutputTokens: policy.maxOutputTokens,
          providerTools: structuredClone(policy.providerTools),
        }])),
      },
      ...(input.model.runEventSink ? { runEventSink: input.model.runEventSink } : {}),
    },
    tools: {
      catalog,
      sources,
      maxCalls: input.tools.maxCalls,
      maxConcurrent: input.tools.maxConcurrent,
      limits: executorToolLimits(input.tools.limits),
    },
    persistence: {
      ...(input.persistence.initialToolExposureCheckpoint
        ? {
          initialToolExposureCheckpoint: structuredClone(
            input.persistence.initialToolExposureCheckpoint,
          ),
        }
        : {}),
      ...(input.persistence.initialProviderReplayCheckpoints
        ? {
          initialProviderReplayCheckpoints: structuredClone(
            input.persistence.initialProviderReplayCheckpoints,
          ),
        }
        : {}),
      ...(input.persistence.publishParentRunEvents
        ? { publishParentRunEvents: input.persistence.publishParentRunEvents }
        : {}),
      ...(input.persistence.persistToolExposureCheckpoint
        ? { persistToolExposureCheckpoint: input.persistence.persistToolExposureCheckpoint }
        : {}),
      ...(input.persistence.persistProviderReplayCheckpoint
        ? { persistProviderReplayCheckpoint: input.persistence.persistProviderReplayCheckpoint }
        : {}),
    },
    state: {
      ...(input.state.prepareProjectSteering
        ? { prepareProjectSteering: input.state.prepareProjectSteering }
        : {}),
      ...(input.state.refreshProjectSteering
        ? { refreshProjectSteering: input.state.refreshProjectSteering }
        : {}),
      ...(input.state.latestConversationUserText
        ? { latestConversationUserText: input.state.latestConversationUserText }
        : {}),
    },
  };
}

function toChannelBinding(binding: {
  allocationId: string;
  generation: number;
  invocationId: string;
}): ExecutorBinding {
  return {
    allocationId: binding.allocationId,
    generation: binding.generation,
    invocationId: binding.invocationId,
  };
}
