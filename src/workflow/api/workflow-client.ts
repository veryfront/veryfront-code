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
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
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

export class WorkflowClient {
  private backend: WorkflowBackend;
  private executor: WorkflowExecutor;
  private approvalManager: ApprovalManager;
  private debug: boolean;

  constructor(config: WorkflowClientConfig = {}) {
    this.debug = config.debug ?? false;
    this.backend = config.backend ?? new MemoryBackend({ debug: this.debug });

    const userOnWaiting = config.executor?.onWaiting;

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
          userOnWaiting?.(run, nodeId);
          return;
        }

        if (input.type !== "approval") {
          userOnWaiting?.(run, nodeId);
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
        }

        userOnWaiting?.(run, nodeId);
      },
    });

    this.approvalManager = new ApprovalManager({
      backend: this.backend,
      executor: this.executor,
      debug: this.debug,
      ...config.approval,
    });
  }

  register(workflow: Workflow | WorkflowDefinition): void {
    const definition = "definition" in workflow ? workflow.definition : workflow;
    this.executor.register(definition);
    logger.debug("Registered workflow", { workflowId: definition.id });
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

  resume(runId: string): Promise<void> {
    return this.executor.resume(runId);
  }

  cancel(runId: string): Promise<void> {
    return this.executor.cancel(runId);
  }

  getRun(runId: string): Promise<WorkflowRun | null> {
    return this.backend.getRun(runId);
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

  approve(runId: string, approvalId: string, approver: string, comment?: string): Promise<void> {
    return this.approvalManager.approve(runId, approvalId, approver, comment);
  }

  reject(runId: string, approvalId: string, approver: string, comment?: string): Promise<void> {
    return this.approvalManager.reject(runId, approvalId, approver, comment);
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

export function createWorkflowClient(config?: WorkflowClientConfig): WorkflowClient {
  return new WorkflowClient(config);
}
