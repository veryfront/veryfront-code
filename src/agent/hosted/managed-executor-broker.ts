import { namespaceAgentCapability } from "#veryfront/discovery/agent-capability-namespace.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import type { AgentModelRuntimeResolver } from "../runtime/model-transport.ts";
import {
  createExecutorOperationGate,
  type ExecutorOperationGate,
} from "../executor/operation-gate.ts";
import type { ExecutorBinding } from "../executor/protocol.ts";
import type { HostedChatRuntimeAgent } from "./chat-runtime-contract.ts";
import {
  createHostedExecutorSessionPool,
  type HostedExecutorSessionPoolOptions,
} from "./executor-session-pool.ts";
import type {
  HostedExecutorOwnedWork,
  HostedExecutorSessionCloseResult,
  HostedExecutorSessionOptions,
} from "./executor-session.ts";
import { sameHostedExecutorOwner } from "./executor-session-schema.ts";
import { verifyHostedRuntimeSourceBinding } from "./runtime-source-binding.ts";
import {
  type ExecutorRuntimeInstall,
  getExecutorRuntimeInstallSchema,
  parseExecutorInstallation,
} from "./executor-runtime-install-schema.ts";
import {
  ExecutorRuntimePreparationError,
  type ExecutorRuntimePrepareRequest,
  getExecutorRuntimePrepareRequestSchema,
  getExecutorRuntimePrepareResultSchema,
  isExecutorRuntimePreparationFailureCode,
  parseRuntimePreparationData,
} from "./executor-runtime-prepare-schema.ts";
import {
  ExecutorDiscoveryError,
  getExecutorAgentDescribeResultSchema,
  parseDiscoveryData,
} from "./executor-discovery-schema.ts";
import { ExecutorAgentError } from "./executor-agent-schema.ts";
import { createExecutorHostedChatRuntimeAgent } from "./executor-agent-bridge.ts";
import {
  createEphemeralHostedExecutorModelBroker,
  createHostedExecutorModelBroker,
} from "./executor-model-dispatch.ts";
import type { ExecutorModelGrant } from "./executor-model-grant.ts";
import { createExecutorToolBroker, type ExecutorToolCapability } from "./executor-tool-bridge.ts";
import { createExecutorPersistenceBroker } from "./executor-persistence-bridge.ts";
import { executorInitialCheckpointsOperation } from "./executor-checkpoint-state.ts";
import { createExecutorStateBroker } from "./executor-state-bridge.ts";
import { executorStateOperations } from "./executor-state-schema.ts";
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
    sources: ReadonlyMap<string, ExecutorToolCapability>;
    maxCalls: number;
    maxConcurrent: number;
    limits?: Parameters<typeof createExecutorToolBroker>[0]["limits"];
  };
  persistence: PersistenceInput;
  state: StateInput;
}
type ManagedExecutorOperationInput = Pick<
  ManagedExecutorStartInput,
  "model" | "tools" | "persistence" | "state"
>;

/** Process admission and shutdown limits for a managed broker. */
export type ManagedExecutorBrokerOptions = Omit<
  HostedExecutorSessionPoolOptions,
  "createSession"
>;

/** Compose an executor pool with authenticated installation and operation gates. */
export function createManagedExecutorBroker(options: ManagedExecutorBrokerOptions) {
  const pool = createHostedExecutorSessionPool(options);

  async function start(
    input: ManagedExecutorStartInput,
    lifecycle: { onAdmitted?(settled: Promise<void>): void } = {},
  ): Promise<ManagedExecutorRuntime> {
    // Generation one is used only to validate local operation descriptors.
    // Actual authority is rebuilt against the allocator's authenticated binding.
    const validationBinding: ExecutorBinding = {
      allocationId: input.session.request.allocationId,
      generation: 1,
      invocationId: input.session.request.invocationId,
    };
    const installation = parseExecutorInstallation(getExecutorRuntimeInstallSchema(), {
      ...input.installation,
      binding: validationBinding,
    });
    const prepare = parseRuntimePreparationData(
      getExecutorRuntimePrepareRequestSchema(),
      input.prepare,
    );
    if (
      !sameHostedExecutorOwner(installation.owner, input.session.request.owner) ||
      verifyHostedRuntimeSourceBinding(input.session.request.source, installation.source) !==
        undefined ||
      prepare.agentId !== installation.grant.agentId
    ) throw new TypeError("Managed executor installation does not match its session");
    const allowedModelIds = new Set(installation.grant.models.map((model) => model.id));
    const operationInput = snapshotOperationInput(input);
    assertInstalledOperationGrants(operationInput, installation);
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
    );

    let gate: ExecutorOperationGate | undefined;
    const session = pool.start({
      ...input.session,
      createOperations(binding, signal) {
        const channelBinding = toChannelBinding(binding);
        const operations = buildBrokerOperations(
          channelBinding,
          signal,
          operationInput,
          installation,
          allowedModelIds,
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
      if (!binding || !gate) throw new Error("Managed executor session is not bound");
      const channelBinding = toChannelBinding(binding);
      const installRequest = parseExecutorInstallation(getExecutorRuntimeInstallSchema(), {
        ...installation,
        binding: channelBinding,
      });
      const installed = await channel.request("runtime.install", installRequest);
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
      const prepared = parseRuntimePreparationData(
        getExecutorRuntimePrepareResultSchema(),
        await channel.request("runtime.prepare", prepare),
      );
      if (!prepared.ok) {
        if (isExecutorRuntimePreparationFailureCode(prepared.code)) {
          throw new ExecutorRuntimePreparationError(prepared.code);
        }
        throw new ExecutorAgentError(prepared.code);
      }
      const selectedModelId = prepare.modelId ?? installation.grant.defaultModelId;
      if (
        !allowedModelIds.has(prepared.value.modelId) || prepared.value.modelId !== selectedModelId
      ) {
        throw new ExecutorRuntimePreparationError("EXECUTOR_RUNTIME_NOT_GRANTED");
      }
      gate.markPrepared();
      const remoteAgent = createExecutorHostedChatRuntimeAgent({
        channel,
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
      const settled = Promise.all([session.settled, gate.settled]).then(() => undefined);
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

function assertInstalledOperationGrants(
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
  }
  const allowedTools = new Set(installation.grant.allowedToolNames);
  // Trusted source capabilities carry canonical IDs, while an installed selector
  // can name a tool relative to the owning agent's namespace.
  for (const selector of installation.grant.allowedToolNames) {
    allowedTools.add(namespaceAgentCapability(installation.grant.agentId, selector));
  }
  for (const capability of input.tools.sources.values()) {
    for (const name of capability.allowedToolNames) {
      if (!allowedTools.has(name)) {
        throw new TypeError("Broker tool capability exceeds the installed tool grant");
      }
    }
  }
}

function buildBrokerOperations(
  binding: ExecutorBinding,
  signal: AbortSignal,
  input: ManagedExecutorOperationInput,
  installation: ExecutorRuntimeInstall,
  allowedModelIds: ReadonlySet<string>,
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
    allowedToolNames: installation.grant.allowedToolNames,
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
      sources,
      maxCalls: input.tools.maxCalls,
      maxConcurrent: input.tools.maxConcurrent,
      ...(input.tools.limits ? { limits: { ...input.tools.limits } } : {}),
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
