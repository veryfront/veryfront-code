/**
 * Approval Manager
 *
 * Handles human-in-the-loop approval workflows
 */

import type {
  ApprovalDecision,
  PendingApproval,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";
import { generateId, parseDuration } from "../types.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";

/**
 * Approval notification callback
 */
export type ApprovalNotifier = (
  approval: PendingApproval,
  run: WorkflowRun,
) => Promise<void>;

/**
 * Approval manager configuration
 */
export interface ApprovalManagerConfig {
  /** Backend for persistence */
  backend: WorkflowBackend;
  /** Workflow executor for resuming after approval */
  executor?: WorkflowExecutor;
  /** Notification callback */
  notifier?: ApprovalNotifier;
  /** Check expired approvals interval (ms) */
  expirationCheckInterval?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Approval request result
 */
export interface ApprovalRequest {
  /** Approval ID */
  approvalId: string;
  /** Run ID */
  runId: string;
  /** Node ID */
  nodeId: string;
  /** Message for approver */
  message: string;
  /** Payload with context */
  payload: unknown;
  /** When approval expires */
  expiresAt?: Date;
}

/**
 * Approval Manager class
 *
 * Responsible for:
 * - Creating pending approvals
 * - Processing approval decisions
 * - Resuming workflows after approval
 * - Handling approval timeouts
 */
export class ApprovalManager {
  private config: ApprovalManagerConfig;
  private expirationTimer?: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor(config: ApprovalManagerConfig) {
    this.config = {
      expirationCheckInterval: 60000, // Check every minute
      debug: false,
      ...config,
    };

    // Start expiration checker if interval is set
    if (this.config.expirationCheckInterval && this.config.expirationCheckInterval > 0) {
      this.startExpirationChecker();
    }
  }

  /**
   * Create a pending approval request
   */
  async createApproval(
    run: WorkflowRun,
    nodeId: string,
    waitConfig: WaitNodeConfig,
    context: WorkflowContext,
  ): Promise<ApprovalRequest> {
    // Resolve payload if it's a function
    const payload = typeof waitConfig.payload === "function"
      ? await waitConfig.payload(context)
      : waitConfig.payload;

    // Calculate expiration
    const expiresAt = waitConfig.timeout
      ? new Date(Date.now() + parseDuration(waitConfig.timeout))
      : undefined;

    const approval: PendingApproval = {
      id: generateId("apr"),
      nodeId,
      message: waitConfig.message || "Approval required",
      payload,
      approvers: waitConfig.approvers,
      requestedAt: new Date(),
      expiresAt,
      status: "pending",
    };

    if (this.config.debug) {
      console.log(`[ApprovalManager] Creating approval ${approval.id} for run ${run.id}`);
    }

    // Save to backend
    await this.config.backend.savePendingApproval(run.id, approval);

    // Notify approvers
    if (this.config.notifier) {
      try {
        await this.config.notifier(approval, run);
      } catch (error) {
        console.error(`[ApprovalManager] Failed to notify approvers:`, error);
      }
    }

    return {
      approvalId: approval.id,
      runId: run.id,
      nodeId,
      message: approval.message,
      payload: approval.payload,
      expiresAt: approval.expiresAt,
    };
  }

  /**
   * Get pending approval by ID
   */
  async getApproval(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null> {
    if (this.config.backend.getPendingApproval) {
      return this.config.backend.getPendingApproval(runId, approvalId);
    }

    // Fallback: get all and find
    const all = await this.config.backend.getPendingApprovals(runId);
    return all.find((a) => a.id === approvalId) || null;
  }

  /**
   * Get all pending approvals for a run
   */
  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    return this.config.backend.getPendingApprovals(runId);
  }

  /**
   * Process an approval decision
   */
  async processDecision(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    if (this.config.debug) {
      console.log(
        `[ApprovalManager] Processing decision for ${approvalId}: ${
          decision.approved ? "approved" : "rejected"
        }`,
      );
    }

    // Get the approval
    const approval = await this.getApproval(runId, approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    // Check if already decided
    if (approval.status !== "pending") {
      throw new Error(`Approval already processed: ${approval.status}`);
    }

    // Check if expired
    if (approval.expiresAt && new Date() > approval.expiresAt) {
      throw new Error("Approval has expired");
    }

    // Check if approver is authorized
    if (
      approval.approvers &&
      approval.approvers.length > 0 &&
      !approval.approvers.includes(decision.approver)
    ) {
      throw new Error("Not authorized to approve this request");
    }

    // Update the approval
    await this.config.backend.updateApproval(runId, approvalId, decision);

    // Get the run
    const run = await this.config.backend.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    // Update run context with approval result
    const updatedContext = {
      ...run.context,
      [approval.nodeId]: {
        approved: decision.approved,
        approver: decision.approver,
        comment: decision.comment,
        decidedAt: new Date().toISOString(),
      },
    };

    // Update node state
    const updatedNodeStates = {
      ...run.nodeStates,
      [approval.nodeId]: {
        nodeId: approval.nodeId,
        status: "completed" as const,
        output: {
          approved: decision.approved,
          approver: decision.approver,
          comment: decision.comment,
        },
        attempt: 1,
        completedAt: new Date(),
      },
    };

    await this.config.backend.updateRun(runId, {
      context: updatedContext,
      nodeStates: updatedNodeStates,
    });

    // Resume workflow if approved and executor is available
    if (decision.approved && this.config.executor) {
      try {
        await this.config.executor.resume(runId);
      } catch (error) {
        console.error(`[ApprovalManager] Failed to resume workflow:`, error);
        throw error;
      }
    } else if (!decision.approved) {
      // If rejected, fail the workflow
      await this.config.backend.updateRun(runId, {
        status: "failed",
        error: {
          message: `Approval "${approvalId}" was rejected${
            decision.comment ? `: ${decision.comment}` : ""
          }`,
        },
        completedAt: new Date(),
      });
    }
  }

  /**
   * Approve an approval request
   */
  async approve(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
  ): Promise<void> {
    await this.processDecision(runId, approvalId, {
      approved: true,
      approver,
      comment,
    });
  }

  /**
   * Reject an approval request
   */
  async reject(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
  ): Promise<void> {
    await this.processDecision(runId, approvalId, {
      approved: false,
      approver,
      comment,
    });
  }

  /**
   * List all pending approvals across workflows
   */
  listAllPending(filter?: {
    workflowId?: string;
    approver?: string;
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    if (this.config.backend.listPendingApprovals) {
      return this.config.backend.listPendingApprovals({
        ...filter,
        status: "pending",
      });
    }

    // Fallback: not supported by backend
    console.warn(
      "[ApprovalManager] listPendingApprovals not supported by backend",
    );
    return Promise.resolve([]);
  }

  /**
   * Check and expire stale approvals
   */
  async checkExpiredApprovals(): Promise<void> {
    // Guard against post-stop execution
    if (this.destroyed) {
      return;
    }

    if (!this.config.backend.listPendingApprovals) {
      return;
    }

    const pending = await this.config.backend.listPendingApprovals({
      status: "pending",
    });

    const now = new Date();

    for (const { runId, approval } of pending) {
      if (approval.expiresAt && now > approval.expiresAt) {
        if (this.config.debug) {
          console.log(`[ApprovalManager] Expiring approval ${approval.id}`);
        }

        // Mark as expired
        await this.config.backend.updateApproval(runId, approval.id, {
          approved: false,
          approver: "system",
          comment: "Approval expired",
        });

        // Fail the workflow
        await this.config.backend.updateRun(runId, {
          status: "failed",
          error: {
            message: `Approval "${approval.id}" expired`,
          },
          completedAt: new Date(),
        });
      }
    }
  }

  /**
   * Start the expiration checker timer
   */
  private startExpirationChecker(): void {
    this.expirationTimer = setInterval(() => {
      this.checkExpiredApprovals().catch((error) => {
        console.error(`[ApprovalManager] Expiration check failed:`, error);
      });
    }, this.config.expirationCheckInterval);
  }

  /**
   * Stop the approval manager
   */
  stop(): void {
    this.destroyed = true;
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = undefined;
    }
  }
}
