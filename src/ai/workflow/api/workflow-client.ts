/**
 * Workflow Client
 *
 * High-level API for interacting with workflows
 */

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

/**
 * Workflow client configuration
 */
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

/**
 * Workflow Client class
 *
 * The main entry point for working with workflows.
 * Provides a simple API for:
 * - Registering workflow definitions
 * - Starting and managing workflow runs
 * - Handling approvals
 */
export class WorkflowClient {
  private backend: WorkflowBackend;
  private executor: WorkflowExecutor;
  private approvalManager: ApprovalManager;
  private debug: boolean;

  constructor(config: WorkflowClientConfig = {}) {
    this.debug = config.debug ?? false;
    this.backend = config.backend ?? new MemoryBackend({ debug: this.debug });

    // Initialize approval manager first (executor needs its callback)
    // Use a deferred pattern since executor and approval manager reference each other
    let approvalManagerRef: ApprovalManager;

    // Initialize executor with onWaiting callback to create approvals
    this.executor = new WorkflowExecutor({
      backend: this.backend,
      debug: this.debug,
      ...config.executor,
      onWaiting: async (run, nodeId) => {
        // Get the node state to extract wait config
        const nodeState = run.nodeStates[nodeId];
        if (!nodeState?.input) {
          if (this.debug) {
            console.log(`[WorkflowClient] No wait config found for node: ${nodeId}`);
          }
          return;
        }

        // Reconstruct wait config from node state input
        const input = nodeState.input as { type?: string; message?: string; payload?: unknown };
        if (input.type !== "approval") {
          // Not an approval wait (might be event wait)
          return;
        }

        const waitConfig = {
          waitType: "approval" as const,
          message: input.message,
          payload: input.payload,
        };

        try {
          await approvalManagerRef.createApproval(run, nodeId, waitConfig, run.context);
          if (this.debug) {
            console.log(`[WorkflowClient] Created approval for node: ${nodeId}`);
          }
        } catch (error) {
          console.error(`[WorkflowClient] Failed to create approval:`, error);
        }

        // Call user's onWaiting callback if provided
        config.executor?.onWaiting?.(run, nodeId);
      },
    });

    // Initialize approval manager
    this.approvalManager = new ApprovalManager({
      backend: this.backend,
      executor: this.executor,
      debug: this.debug,
      ...config.approval,
    });

    // Set the reference for the onWaiting callback
    approvalManagerRef = this.approvalManager;
  }

  // =========================================================================
  // Workflow Registration
  // =========================================================================

  /**
   * Register a workflow definition
   */
  register(
    workflow: Workflow | WorkflowDefinition,
  ): void {
    const definition = "definition" in workflow ? workflow.definition : workflow;

    this.executor.register(definition as WorkflowDefinition);

    if (this.debug) {
      console.log(`[WorkflowClient] Registered workflow: ${definition.id}`);
    }
  }

  /**
   * Register multiple workflows
   */
  registerAll(
    workflows: Array<Workflow | WorkflowDefinition>,
  ): void {
    for (const workflow of workflows) {
      this.register(workflow);
    }
  }

  // =========================================================================
  // Workflow Execution
  // =========================================================================

  /**
   * Start a new workflow run
   *
   * @example
   * ```typescript
   * const handle = await client.start('content-pipeline', {
   *   topic: 'AI Safety',
   *   requiresApproval: true,
   * });
   *
   * const result = await handle.result();
   * ```
   */
  start<TInput, TOutput = unknown>(
    workflowId: string,
    input: TInput,
    options?: { runId?: string },
  ): Promise<WorkflowHandle<TOutput>> {
    return this.executor.start<TInput, TOutput>(workflowId, input, options);
  }

  /**
   * Resume a paused/waiting workflow
   */
  resume(runId: string): Promise<void> {
    return this.executor.resume(runId);
  }

  /**
   * Cancel a workflow run
   */
  cancel(runId: string): Promise<void> {
    return this.executor.cancel(runId);
  }

  // =========================================================================
  // Run Management
  // =========================================================================

  /**
   * Get a workflow run by ID
   */
  getRun(runId: string): Promise<WorkflowRun | null> {
    return this.backend.getRun(runId);
  }

  /**
   * List workflow runs
   */
  listRuns(filter?: RunFilter): Promise<WorkflowRun[]> {
    return this.backend.listRuns(filter ?? {});
  }

  /**
   * Get runs by status
   */
  getRunsByStatus(
    status: WorkflowStatus | WorkflowStatus[],
    limit?: number,
  ): Promise<WorkflowRun[]> {
    return this.backend.listRuns({ status, limit });
  }

  /**
   * Get runs for a specific workflow
   */
  getRunsForWorkflow(
    workflowId: string,
    limit?: number,
  ): Promise<WorkflowRun[]> {
    return this.backend.listRuns({ workflowId, limit });
  }

  // =========================================================================
  // Approvals
  // =========================================================================

  /**
   * Get pending approvals for a run
   */
  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    return this.approvalManager.getPendingApprovals(runId);
  }

  /**
   * Approve an approval request
   *
   * @example
   * ```typescript
   * await client.approve(runId, approvalId, 'user@example.com', 'Looks good!');
   * ```
   */
  approve(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
  ): Promise<void> {
    return this.approvalManager.approve(runId, approvalId, approver, comment);
  }

  /**
   * Reject an approval request
   */
  reject(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
  ): Promise<void> {
    return this.approvalManager.reject(runId, approvalId, approver, comment);
  }

  /**
   * List all pending approvals across workflows
   */
  listAllPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    return this.approvalManager.listAllPending(filter);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Get the underlying backend
   */
  getBackend(): WorkflowBackend {
    return this.backend;
  }

  /**
   * Get the underlying executor
   */
  getExecutor(): WorkflowExecutor {
    return this.executor;
  }

  /**
   * Get the underlying approval manager
   */
  getApprovalManager(): ApprovalManager {
    return this.approvalManager;
  }

  /**
   * Cleanup and shutdown
   */
  async destroy(): Promise<void> {
    this.approvalManager.stop();
    await this.backend.destroy();

    if (this.debug) {
      console.log("[WorkflowClient] Destroyed");
    }
  }
}

/**
 * Create a workflow client with default configuration
 */
export function createWorkflowClient(
  config?: WorkflowClientConfig,
): WorkflowClient {
  return new WorkflowClient(config);
}
