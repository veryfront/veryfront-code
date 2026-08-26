/**************************
 * Workflow Client
 *
 * High-level API for interacting with workflows
 **************************/

import { logger as baseLogger } from "#veryfront/utils";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type {
  PendingApproval,
  PendingEventWait,
  RunFilter,
  WaitNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import {
  hasEventWaitSupport,
  hasRunObservationSupport,
  type WorkflowBackend,
} from "../backends/types.ts";
import { deriveWorkflowRunEventObservation, type WorkflowRunEventObservation } from "../events.ts";
import { MemoryBackend } from "../backends/memory.ts";
import {
  WorkflowExecutor,
  type WorkflowExecutorConfig,
  type WorkflowHandle,
} from "../executor/workflow-executor.ts";
import { ApprovalManager, type ApprovalManagerConfig } from "../runtime/approval-manager.ts";
import {
  EventWaitManager,
  type EventWaitManagerConfig,
  type PublishEventOutcome,
} from "../runtime/event-wait-manager.ts";
import { captureWorkflowDefinition } from "../executor/workflow-definition-snapshot.ts";

export type { PublishEventOutcome };
import type { Workflow } from "../dsl/workflow.ts";
import {
  getPendingApprovalResponseSchemaId,
  projectRunPendingApprovals,
} from "../runtime/pending-approval-metadata.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

const logger = baseLogger.component("workflow-client");
const waitResponseSchemaId = Symbol("veryfront.workflow.waitResponseSchemaId");

type IndexedWaitNodeConfig = WaitNodeConfig & {
  readonly [waitResponseSchemaId]?: string;
};

function withWaitResponseSchemaId(
  config: WaitNodeConfig,
  responseSchemaId: string,
): WaitNodeConfig {
  const indexedConfig: IndexedWaitNodeConfig = { ...config };
  Object.defineProperty(indexedConfig, waitResponseSchemaId, {
    value: responseSchemaId,
  });
  return indexedConfig;
}

function getWaitResponseSchemaId(config: WaitNodeConfig): string | undefined {
  return (config as IndexedWaitNodeConfig)[waitResponseSchemaId];
}

/** Configuration used by workflow client. */
export interface WorkflowClientConfig {
  /** Backend for persistence (default: MemoryBackend) */
  backend?: WorkflowBackend;
  /** Executor configuration */
  executor?: Partial<WorkflowExecutorConfig>;
  /** Approval manager configuration */
  approval?: Partial<ApprovalManagerConfig>;
  /** Event wait manager configuration */
  eventWait?: Partial<Omit<EventWaitManagerConfig, "backend" | "executor">>;
  /** Enable debug logging */
  debug?: boolean;
}

/** Supported observation stream or an explicit unsupported-backend result. */
export type WorkflowRunEventsResult =
  | ({ supported: true } & WorkflowRunEventObservation)
  | { supported: false; reason: "unsupported" };

/** Implement workflow client. */
export class WorkflowClient {
  private backend: WorkflowBackend;
  private executor: WorkflowExecutor;
  private approvalManager: ApprovalManager;
  private eventWaitManager: EventWaitManager;
  private debug: boolean;
  /** Wait-node configs from registered definitions, keyed "<workflowId>::<nodeId>". */
  private waitNodeConfigs = new Map<string, WaitNodeConfig>();
  /** Registered response schemas keyed by a durable definition-path identity. */
  private responseSchemas = new Map<string, Schema<unknown>>();

  constructor(config: WorkflowClientConfig = {}) {
    this.debug = config.debug ?? false;
    this.backend = config.backend ?? new MemoryBackend({ debug: this.debug });
    if (config.executor?.enableLocking === false && hasEventWaitSupport(this.backend)) {
      throw INVALID_ARGUMENT.create({
        detail:
          "WorkflowClient executor locking cannot be disabled when the backend supports durable event waits",
      });
    }

    const userOnWaiting = config.executor?.onWaiting;
    const userOnWaitingBatchComplete = config.executor?.onWaitingBatchComplete;
    const userOnEventWaitResolved = config.executor?.onEventWaitResolved;
    const userResponseSchemaResolver = config.approval?.responseSchemaResolver;
    const userInternalResponseSchemaResolver = config.approval?.internalResponseSchemaResolver;

    this.executor = new WorkflowExecutor({
      backend: this.backend,
      debug: this.debug,
      ...config.executor,
      onWaitingPersist: async (run, nodeId, activeWaitConfig) => {
        const input = run.nodeStates[nodeId]?.input as
          | {
            type?: string;
            eventName?: string;
            timeout?: string | number;
            message?: string;
            payload?: unknown;
          }
          | undefined;

        if (!input) {
          logger.debug("No wait config found for node", { nodeId });
          return;
        }

        if (input.type === "event") {
          // The node input is the durable identity this execution already
          // promised to wait on. Runtime and registered definitions are only
          // fallbacks for older snapshots that did not persist an event name.
          const registeredEventConfig = this.waitNodeConfigs.get(`${run.workflowId}::${nodeId}`);
          const persistedEventConfig: WaitNodeConfig | undefined = input.eventName === undefined
            ? undefined
            : {
              type: "wait",
              waitType: "event",
              eventName: input.eventName,
              ...(input.timeout === undefined ? {} : { timeout: input.timeout }),
            };
          const eventConfig = [persistedEventConfig, activeWaitConfig, registeredEventConfig]
            .find((candidate) => candidate?.waitType === "event");
          if (eventConfig) {
            try {
              await this.eventWaitManager.createEventWait(run, nodeId, eventConfig);
              logger.debug("Created event wait for node", { nodeId });
            } catch (error) {
              logger.error("Failed to create event wait", error);
              throw error;
            }
          } else {
            logger.warn("No event wait config found for node", { runId: run.id, nodeId });
          }
          return;
        }

        if (input.type !== "approval") {
          return;
        }

        // Node state persists only the resolved message and payload. Carry the
        // exact runtime config across the pause boundary so nested nodes that
        // reuse an id and function-generated nodes retain their own policy.
        // The registered definition remains a compatibility fallback for an
        // execution result produced without the runtime config.
        const registered = this.waitNodeConfigs.get(`${run.workflowId}::${nodeId}`);
        const configured = activeWaitConfig ?? registered;
        const waitConfig: WaitNodeConfig = {
          type: "wait" as const,
          waitType: "approval" as const,
          message: input.message,
          payload: input.payload,
          ...(configured?.timeout !== undefined ? { timeout: configured.timeout } : {}),
          ...(configured?.approvers !== undefined ? { approvers: configured.approvers } : {}),
          ...(configured?.responseSchema !== undefined
            ? { responseSchema: configured.responseSchema }
            : {}),
        };

        try {
          const responseSchemaId = configured?.responseSchema
            ? getWaitResponseSchemaId(configured)
            : undefined;
          await this.approvalManager.createApproval(
            run,
            nodeId,
            waitConfig,
            run.context,
            responseSchemaId === undefined
              ? { notify: false }
              : { responseSchemaId, notify: false },
          );
          logger.debug("Created approval for node", { nodeId });
        } catch (error) {
          logger.error("Failed to create approval", error);
          throw error;
        }
      },
      onWaiting: async (run, nodeId, activeWaitConfig) => {
        if ((run.nodeStates[nodeId]?.input as { type?: string } | undefined)?.type === "approval") {
          await this.approvalManager.notifyPendingApproval(run, nodeId);
        }
        await userOnWaiting?.(run, nodeId, activeWaitConfig);
      },
      onWaitingBatchComplete: async (run) => {
        await this.eventWaitManager.drainPendingEvents(run.id);
        await userOnWaitingBatchComplete?.(run);
      },
      onEventWaitResolved: async (runId, waitId) => {
        this.eventWaitManager.clearWaitExpiry(waitId);
        await userOnEventWaitResolved?.(runId, waitId);
      },
    });

    this.eventWaitManager = new EventWaitManager({
      backend: this.backend,
      executor: this.executor,
      debug: this.debug,
      ...config.eventWait,
    });

    this.approvalManager = new ApprovalManager({
      backend: this.backend,
      executor: this.executor,
      debug: this.debug,
      ...config.approval,
      responseSchemaResolver: async (input) => {
        return await userResponseSchemaResolver?.(input);
      },
      internalResponseSchemaResolver: async (input) => {
        const responseSchemaId = getPendingApprovalResponseSchemaId(input.approval);
        const registeredSchema = responseSchemaId !== undefined
          ? this.responseSchemas.get(`${input.run.workflowId}::${responseSchemaId}`)
          : this.waitNodeConfigs.get(`${input.run.workflowId}::${input.approval.nodeId}`)
            ?.responseSchema;

        if (registeredSchema !== undefined) {
          return registeredSchema;
        }

        return await userInternalResponseSchemaResolver?.(input);
      },
    });
  }

  register(workflow: Workflow | WorkflowDefinition): void {
    const definition = "definition" in workflow ? workflow.definition : workflow;
    const capturedDefinition = captureWorkflowDefinition(definition);
    const indexedDefinition = this.indexWaitNodeConfigs(capturedDefinition);
    this.executor.register(indexedDefinition);
    logger.debug("Registered workflow", { workflowId: capturedDefinition.id });
  }

  /**
   * Index every wait node under its runtime node id and registered-definition path.
   *
   * `responseSchema` is a live object and cannot be persisted on an approval.
   * Persisting the definition-path identity lets a later process recover the
   * exact registered schema even when a parent wait and a static sub-workflow
   * wait share a runtime node id. Each static wait gets a definition-local config
   * clone that carries its own path through execution, so one reused config
   * object cannot overwrite another path. The node-id index remains the
   * compatibility fallback for approvals created before definition-path
   * identities existed.
   * Static sub-workflows are indexed under the registering workflow's id
   * because their approvals belong to the parent run.
   *
   * A workflow or loop whose `steps` is a function is not walked: the node list
   * depends on runtime input/iteration state, so no schema can be recovered
   * from the definition after a process restart. During execution, the exact
   * runtime config supplies expiry, approvers, and response validation.
   */
  private indexWaitNodeConfigs(definition: WorkflowDefinition): WorkflowDefinition {
    const keyPrefix = `${definition.id}::`;
    for (const key of this.waitNodeConfigs.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.waitNodeConfigs.delete(key);
      }
    }
    for (const key of this.responseSchemas.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.responseSchemas.delete(key);
      }
    }

    if (!Array.isArray(definition.steps)) return definition;

    const workflowId = definition.id;
    const waitNodeConfigs = this.waitNodeConfigs;
    const responseSchemas = this.responseSchemas;

    function cloneDefinition(
      nestedDefinition: WorkflowDefinition,
      path: readonly string[],
    ): WorkflowDefinition {
      return Array.isArray(nestedDefinition.steps)
        ? { ...nestedDefinition, steps: cloneNodes(nestedDefinition.steps, path) }
        : nestedDefinition;
    }

    function cloneNodes(
      nodes: readonly WorkflowNode[],
      path: readonly string[],
    ): WorkflowNode[] {
      return nodes.map((node) => cloneNode(node, [...path, node.id]));
    }

    function cloneNode(node: WorkflowNode, nodePath: readonly string[]): WorkflowNode {
      const config = node.config;
      switch (config.type) {
        case "wait": {
          let indexedWaitConfig = config;
          if (config.responseSchema) {
            const responseSchemaId = JSON.stringify(nodePath);
            responseSchemas.set(`${workflowId}::${responseSchemaId}`, config.responseSchema);
            indexedWaitConfig = withWaitResponseSchemaId(config, responseSchemaId);
          }
          waitNodeConfigs.set(`${workflowId}::${node.id}`, indexedWaitConfig);
          return { ...node, config: indexedWaitConfig };
        }
        case "parallel":
          return {
            ...node,
            config: {
              ...config,
              nodes: cloneNodes(config.nodes, [...nodePath, "nodes"]),
            },
          };
        case "branch":
          return {
            ...node,
            config: {
              ...config,
              then: cloneNodes(config.then, [...nodePath, "then"]),
              ...(config.else === undefined
                ? {}
                : { else: cloneNodes(config.else, [...nodePath, "else"]) }),
            },
          };
        case "loop":
          return Array.isArray(config.steps)
            ? {
              ...node,
              config: {
                ...config,
                steps: cloneNodes(config.steps, [...nodePath, "steps"]),
              },
            }
            : { ...node };
        case "map": {
          const processor = "steps" in config.processor
            ? cloneDefinition(config.processor, [
              ...nodePath,
              "processor",
              config.processor.id,
            ])
            : cloneNode(config.processor, [...nodePath, "processor", config.processor.id]);
          return { ...node, config: { ...config, processor } };
        }
        case "subWorkflow":
          return typeof config.workflow === "string" ? { ...node } : {
            ...node,
            config: {
              ...config,
              workflow: cloneDefinition(config.workflow, [
                ...nodePath,
                "workflow",
                config.workflow.id,
              ]),
            },
          };
        case "step":
          return { ...node };
      }
    }

    return { ...definition, steps: cloneNodes(definition.steps, ["steps"]) };
  }

  registerAll(workflows: Array<Workflow | WorkflowDefinition>): void {
    for (const workflow of workflows) this.register(workflow);
  }

  start<TInput, TOutput = unknown>(
    workflowId: string,
    input: TInput,
    options?: { runId?: string },
  ): Promise<WorkflowHandle<TOutput>> {
    return this.executor.start<TInput, TOutput>(workflowId, input, options);
  }

  resume(runId: string, expectedWorkerId?: string): Promise<void> {
    return this.executor.resume(runId, undefined, expectedWorkerId);
  }

  retry(runId: string): Promise<void> {
    return this.executor.retry(runId);
  }

  cancel(runId: string): Promise<void> {
    return this.executor.cancel(runId);
  }

  /** Read a run, including the approvals it is currently waiting on. */
  async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await this.backend.getRun(runId);
    return run ? projectRunPendingApprovals(run) : null;
  }

  async listRuns(filter?: RunFilter): Promise<WorkflowRun[]> {
    const runs = await this.backend.listRuns(filter ?? {});
    return runs.map(projectRunPendingApprovals);
  }

  async getRunsByStatus(
    status: WorkflowStatus | WorkflowStatus[],
    limit?: number,
  ): Promise<WorkflowRun[]> {
    const runs = await this.backend.listRuns({ status, limit });
    return runs.map(projectRunPendingApprovals);
  }

  async getRunsForWorkflow(workflowId: string, limit?: number): Promise<WorkflowRun[]> {
    const runs = await this.backend.listRuns({ workflowId, limit });
    return runs.map(projectRunPendingApprovals);
  }

  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    return this.approvalManager.getPendingApprovals(runId);
  }

  async approve(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
    data?: unknown,
  ): Promise<void> {
    return await this.approvalManager.approve(runId, approvalId, approver, comment, data);
  }

  async reject(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
    data?: unknown,
  ): Promise<void> {
    return await this.approvalManager.reject(runId, approvalId, approver, comment, data);
  }

  /**
   * Deliver an event to one run, releasing any `waitForEvent` node parked on
   * that name.
   *
   * The event is buffered durably for the run first, so publishing before the
   * node parks is safe: the wait consumes it as soon as it exists. The outcome
   * says which of the four things happened, because "no wait was released"
   * covers cases a caller has to react to differently: `"delivered"`,
   * `"buffered"`, `"run-terminal"` (the run is over and the event was
   * discarded), or `"delivery-failed"` (a wait matched, delivery failed, and
   * both were rolled back so `retryEventDelivery` can retry the same envelope
   * without appending a duplicate).
   *
   * Rejects when the run's mailbox is full of events no wait has claimed, in
   * preference to dropping one of them.
   */
  publishEvent(
    runId: string,
    eventName: string,
    payload?: unknown,
  ): Promise<PublishEventOutcome> {
    return this.eventWaitManager.publishEvent(runId, eventName, payload);
  }

  /**
   * Retry the oldest buffered event with this name after `publishEvent`
   * returned `"delivery-failed"`, without appending a second envelope.
   * Resolves with whether that exact buffered envelope was delivered.
   */
  retryEventDelivery(runId: string, eventName: string): Promise<boolean> {
    return this.eventWaitManager.retryEventDelivery(runId, eventName);
  }

  /** Read the event waits a run is currently parked on. */
  getPendingEventWaits(runId: string): Promise<PendingEventWait[]> {
    return this.eventWaitManager.getPendingEventWaits(runId);
  }

  listAllPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    return this.approvalManager.listAllPending(filter);
  }

  /** Open an ordered event observation, or report unsupported custom backends explicitly. */
  async observeRunEvents(
    runId: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkflowRunEventsResult | null> {
    if (!hasRunObservationSupport(this.backend)) {
      return { supported: false, reason: "unsupported" };
    }
    const observation = await this.backend.openRunObservation(runId, options);
    if (!observation) return null;
    const derived = deriveWorkflowRunEventObservation(observation);
    return {
      supported: true,
      ...derived,
      initial: projectRunPendingApprovals(derived.initial),
    };
  }

  getBackend(): WorkflowBackend {
    return this.backend;
  }

  getExecutor(): WorkflowExecutor {
    return this.executor;
  }

  getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }

  getEventWaitManager(): EventWaitManager {
    return this.eventWaitManager;
  }

  async destroy(): Promise<void> {
    this.approvalManager.stop();
    this.eventWaitManager.stop();
    await this.backend.destroy();
    logger.debug("Destroyed");
  }
}

/** Create workflow client. */
export function createWorkflowClient(config?: WorkflowClientConfig): WorkflowClient {
  return new WorkflowClient(config);
}
