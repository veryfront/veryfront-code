/**************************
 * Workflow Client
 *
 * High-level API for interacting with workflows
 **************************/

import { logger as baseLogger } from "#veryfront/utils";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type {
  PendingApproval,
  RunFilter,
  WaitNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import { hasRunObservationSupport, type WorkflowBackend } from "../backends/types.ts";
import { deriveWorkflowRunEventObservation, type WorkflowRunEventObservation } from "../events.ts";
import { MemoryBackend } from "../backends/memory.ts";
import {
  WorkflowExecutor,
  type WorkflowExecutorConfig,
  type WorkflowHandle,
} from "../executor/workflow-executor.ts";
import { ApprovalManager, type ApprovalManagerConfig } from "../runtime/approval-manager.ts";
import type { Workflow } from "../dsl/workflow.ts";
import {
  getPendingApprovalResponseSchemaId,
  projectRunPendingApprovals,
} from "../runtime/pending-approval-metadata.ts";

const logger = baseLogger.component("workflow-client");

/** Configuration used by workflow client. */
export interface WorkflowClientConfig {
  /** Backend for persistence (default: MemoryBackend) */
  backend?: WorkflowBackend;
  /** Executor configuration */
  executor?: Partial<WorkflowExecutorConfig>;
  /** Approval manager configuration */
  approval?: Partial<ApprovalManagerConfig>;
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
  private debug: boolean;
  /** Wait-node configs from registered definitions, keyed "<workflowId>::<nodeId>". */
  private waitNodeConfigs = new Map<string, WaitNodeConfig>();
  /** Registered response schemas keyed by a durable definition-path identity. */
  private responseSchemas = new Map<string, Schema<unknown>>();
  /** Definition-path identities for response schemas, keyed by the declaring wait config. */
  private responseSchemaIds = new WeakMap<WaitNodeConfig, Map<string, string>>();

  constructor(config: WorkflowClientConfig = {}) {
    this.debug = config.debug ?? false;
    this.backend = config.backend ?? new MemoryBackend({ debug: this.debug });

    const userOnWaiting = config.executor?.onWaiting;
    const userResponseSchemaResolver = config.approval?.responseSchemaResolver;
    const userInternalResponseSchemaResolver = config.approval?.internalResponseSchemaResolver;

    this.executor = new WorkflowExecutor({
      backend: this.backend,
      debug: this.debug,
      ...config.executor,
      onWaiting: async (run, nodeId, activeWaitConfig) => {
        const input = run.nodeStates[nodeId]?.input as
          | { type?: string; message?: string; payload?: unknown }
          | undefined;

        if (!input) {
          logger.debug("No wait config found for node", { nodeId });
          await userOnWaiting?.(run, nodeId, activeWaitConfig);
          return;
        }

        if (input.type !== "approval") {
          await userOnWaiting?.(run, nodeId, activeWaitConfig);
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
            ? this.responseSchemaIds.get(configured)?.get(run.workflowId)
            : undefined;
          await this.approvalManager.createApproval(
            run,
            nodeId,
            waitConfig,
            run.context,
            responseSchemaId === undefined ? undefined : { responseSchemaId },
          );
          logger.debug("Created approval for node", { nodeId });
        } catch (error) {
          logger.error("Failed to create approval", error);
          throw error;
        }

        await userOnWaiting?.(run, nodeId, activeWaitConfig);
      },
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
    this.executor.register(definition);
    this.indexWaitNodeConfigs(definition);
    logger.debug("Registered workflow", { workflowId: definition.id });
  }

  /**
   * Index every wait node under its runtime node id and registered-definition path.
   *
   * `responseSchema` is a live object and cannot be persisted on an approval.
   * Persisting the definition-path identity lets a later process recover the
   * exact registered schema even when a parent wait and a static sub-workflow
   * wait share a runtime node id. The node-id index remains the compatibility
   * fallback for approvals created before definition-path identities existed.
   * Static sub-workflows are indexed under the registering workflow's id
   * because their approvals belong to the parent run.
   *
   * A workflow or loop whose `steps` is a function is not walked: the node list
   * depends on runtime input/iteration state, so no schema can be recovered
   * from the definition after a process restart. During execution, the exact
   * runtime config supplies expiry, approvers, and response validation.
   */
  private indexWaitNodeConfigs(definition: WorkflowDefinition): void {
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

    if (!Array.isArray(definition.steps)) return;

    const visit = (nodes: readonly WorkflowNode[], path: readonly string[]): void => {
      for (const node of nodes) {
        const nodePath = [...path, node.id];
        const config = node.config as {
          type?: string;
          nodes?: WorkflowNode[];
          then?: WorkflowNode[];
          else?: WorkflowNode[];
          steps?: WorkflowNode[] | ((...args: never[]) => WorkflowNode[]);
          workflow?: string | WorkflowDefinition;
          processor?: WorkflowNode | WorkflowDefinition;
        };
        if (config.type === "wait") {
          const waitConfig = node.config as WaitNodeConfig;
          this.waitNodeConfigs.set(`${definition.id}::${node.id}`, waitConfig);
          if (waitConfig.responseSchema) {
            const responseSchemaId = JSON.stringify(nodePath);
            this.responseSchemas.set(
              `${definition.id}::${responseSchemaId}`,
              waitConfig.responseSchema,
            );
            const workflowIds = this.responseSchemaIds.get(waitConfig) ?? new Map();
            workflowIds.set(definition.id, responseSchemaId);
            this.responseSchemaIds.set(waitConfig, workflowIds);
          }
        }
        if (Array.isArray(config.nodes)) visit(config.nodes, [...nodePath, "nodes"]);
        if (Array.isArray(config.then)) visit(config.then, [...nodePath, "then"]);
        if (Array.isArray(config.else)) visit(config.else, [...nodePath, "else"]);
        if (Array.isArray(config.steps)) visit(config.steps, [...nodePath, "steps"]);
        if (config.processor && "steps" in config.processor) {
          if (Array.isArray(config.processor.steps)) {
            visit(config.processor.steps, [
              ...nodePath,
              "processor",
              config.processor.id,
            ]);
          }
        } else if (config.processor) {
          visit([config.processor], [...nodePath, "processor"]);
        }
        if (
          typeof config.workflow === "object" &&
          Array.isArray(config.workflow.steps)
        ) {
          visit(config.workflow.steps, [
            ...nodePath,
            "workflow",
            config.workflow.id,
          ]);
        }
      }
    };

    visit(definition.steps, ["steps"]);
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

  async destroy(): Promise<void> {
    this.approvalManager.stop();
    await this.backend.destroy();
    logger.debug("Destroyed");
  }
}

/** Create workflow client. */
export function createWorkflowClient(config?: WorkflowClientConfig): WorkflowClient {
  return new WorkflowClient(config);
}
