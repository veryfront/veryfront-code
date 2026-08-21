/**************************
 * Workflow Client
 *
 * High-level API for interacting with workflows
 **************************/

import { logger as baseLogger } from "#veryfront/utils";
import type {
  PendingApproval,
  RunFilter,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import { MemoryBackend } from "../backends/memory.ts";
import {
  WorkflowExecutor,
  type WorkflowExecutorConfig,
  type WorkflowHandle,
} from "../executor/workflow-executor.ts";
import { ApprovalManager, type ApprovalManagerConfig } from "../runtime/approval-manager.ts";
import type { Workflow } from "../dsl/workflow.ts";

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

/** Implement workflow client. */
export class WorkflowClient {
  private backend: WorkflowBackend;
  private executor: WorkflowExecutor;
  private approvalManager: ApprovalManager;
  private debug: boolean;
  /** Wait-node response schemas, keyed "<workflowId>::<nodeId>". */
  private approvalSchemas = new Map<string, Schema<unknown>>();

  constructor(config: WorkflowClientConfig = {}) {
    this.debug = config.debug ?? false;
    this.backend = config.backend ?? new MemoryBackend({ debug: this.debug });

    const userOnWaiting = config.executor?.onWaiting;
    const userResponseSchemaResolver = config.approval?.responseSchemaResolver;

    this.executor = new WorkflowExecutor({
      backend: this.backend,
      debug: this.debug,
      ...config.executor,
      onWaiting: async (run, nodeId) => {
        const input = run.nodeStates[nodeId]?.input as
          | { type?: string; message?: string; payload?: unknown }
          | undefined;

        if (!input) {
          logger.debug("No wait config found for node", { nodeId });
          await userOnWaiting?.(run, nodeId);
          return;
        }

        if (input.type !== "approval") {
          await userOnWaiting?.(run, nodeId);
          return;
        }

        const waitConfig = {
          type: "wait" as const,
          waitType: "approval" as const,
          message: input.message,
          payload: input.payload,
        };

        try {
          await this.approvalManager.createApproval(run, nodeId, waitConfig, run.context);
          logger.debug("Created approval for node", { nodeId });
        } catch (error) {
          logger.error("Failed to create approval", error);
          throw error;
        }

        await userOnWaiting?.(run, nodeId);
      },
    });

    this.approvalManager = new ApprovalManager({
      backend: this.backend,
      executor: this.executor,
      debug: this.debug,
      ...config.approval,
      responseSchemaResolver: async (input) => {
        const userSchema = await userResponseSchemaResolver?.(input);
        if (userSchema) return userSchema;

        return this.approvalSchemas.get(`${input.run.workflowId}::${input.approval.nodeId}`);
      },
    });
  }

  register(workflow: Workflow | WorkflowDefinition): void {
    const definition = "definition" in workflow ? workflow.definition : workflow;
    this.executor.register(definition);
    this.indexApprovalSchemas(definition);
    logger.debug("Registered workflow", { workflowId: definition.id });
  }

  /**
   * Record every wait node's `responseSchema` under "<workflowId>::<nodeId>".
   *
   * Schemas are live objects and never reach the run record, so a decision is
   * validated against the registered definition. Node ids are already
   * arm-qualified by the DSL, so they match what an approval is keyed by.
   *
   * A workflow or loop whose `steps` is a function is not walked: the node list
   * depends on runtime input/iteration state, so no schema can be resolved ahead
   * of a decision and such nodes are accepted unvalidated.
   */
  private indexApprovalSchemas(definition: WorkflowDefinition): void {
    const keyPrefix = `${definition.id}::`;
    for (const key of this.approvalSchemas.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.approvalSchemas.delete(key);
      }
    }

    if (!Array.isArray(definition.steps)) return;

    const visit = (nodes: readonly WorkflowNode[]): void => {
      for (const node of nodes) {
        const config = node.config as {
          type?: string;
          responseSchema?: Schema<unknown>;
          nodes?: WorkflowNode[];
          then?: WorkflowNode[];
          else?: WorkflowNode[];
          steps?: WorkflowNode[] | ((...args: never[]) => WorkflowNode[]);
        };
        if (config.type === "wait" && config.responseSchema) {
          this.approvalSchemas.set(`${definition.id}::${node.id}`, config.responseSchema);
        }
        if (Array.isArray(config.nodes)) visit(config.nodes);
        if (Array.isArray(config.then)) visit(config.then);
        if (Array.isArray(config.else)) visit(config.else);
        if (Array.isArray(config.steps)) visit(config.steps);
      }
    };

    visit(definition.steps);
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

  cancel(runId: string): Promise<void> {
    return this.executor.cancel(runId);
  }

  /**
   * Read a run, including the approvals it is currently waiting on.
   *
   * Approvals are stored apart from the run so they can be reserved atomically
   * against a worker, which leaves `pendingApprovals` empty on the stored
   * record. Callers read a run and reasonably expect it to say what it is
   * waiting for, and `useWorkflow` in particular takes approvals off the run to
   * announce them. Join the two on the public read path rather than writing a
   * second copy, which could disagree with the approval store.
   *
   * `listRuns` deliberately does not do this: it would issue one approval query
   * per run. Read the individual run when the approvals matter.
   */
  async getRun(runId: string): Promise<WorkflowRun | null> {
    const run = await this.backend.getRun(runId);
    if (!run) return null;

    const pendingApprovals = await this.approvalManager.getPendingApprovals(runId);
    return { ...run, pendingApprovals };
  }

  listRuns(filter?: RunFilter): Promise<WorkflowRun[]> {
    return this.backend.listRuns(filter ?? {});
  }

  getRunsByStatus(
    status: WorkflowStatus | WorkflowStatus[],
    limit?: number,
  ): Promise<WorkflowRun[]> {
    return this.backend.listRuns({ status, limit });
  }

  getRunsForWorkflow(workflowId: string, limit?: number): Promise<WorkflowRun[]> {
    return this.backend.listRuns({ workflowId, limit });
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
