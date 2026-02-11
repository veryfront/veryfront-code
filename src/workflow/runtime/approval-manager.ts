import { logger as baseLogger } from "#veryfront/utils";
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

const logger = baseLogger.component("approval-manager");

export type ApprovalNotifier = (
  approval: PendingApproval,
  run: WorkflowRun,
) => Promise<void>;

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

/** Manages pending approvals, processing decisions, and resuming workflows */
export class ApprovalManager {
  private config: ApprovalManagerConfig;
  private expirationTimer?: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor(config: ApprovalManagerConfig) {
    this.config = {
      expirationCheckInterval: 60000,
      debug: false,
      ...config,
    };

    const interval = this.config.expirationCheckInterval ?? 0;
    if (interval > 0) {
      this.startExpirationChecker();
    }
  }

  /** Create a pending approval request */
  async createApproval(
    run: WorkflowRun,
    nodeId: string,
    waitConfig: WaitNodeConfig,
    context: WorkflowContext,
  ): Promise<ApprovalRequest> {
    const payload = typeof waitConfig.payload === "function"
      ? await waitConfig.payload(context)
      : waitConfig.payload;

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

    logger.debug("Creating approval", {
      approvalId: approval.id,
      runId: run.id,
    });

    await this.config.backend.savePendingApproval(run.id, approval);

    try {
      await this.config.notifier?.(approval, run);
    } catch (error) {
      logger.error("Failed to notify approvers", error);
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

  /** Get pending approval by ID */
  async getApproval(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null> {
    if (this.config.backend.getPendingApproval) {
      return this.config.backend.getPendingApproval(runId, approvalId);
    }

    const all = await this.config.backend.getPendingApprovals(runId);
    return all.find((a) => a.id === approvalId) ?? null;
  }

  /** Get all pending approvals for a run */
  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    return this.config.backend.getPendingApprovals(runId);
  }

  /** Process an approval decision */
  async processDecision(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    logger.debug("Processing decision", {
      approvalId,
      approved: decision.approved,
    });

    const approval = await this.getApproval(runId, approvalId);
    if (!approval) {
      throw new Error(`Approval not found: ${approvalId}`);
    }

    if (approval.status !== "pending") {
      throw new Error(`Approval already processed: ${approval.status}`);
    }

    if (approval.expiresAt && new Date() > approval.expiresAt) {
      throw new Error("Approval has expired");
    }

    const approvers = approval.approvers;
    if (approvers?.length && !approvers.includes(decision.approver)) {
      throw new Error("Not authorized to approve this request");
    }

    await this.config.backend.updateApproval(runId, approvalId, decision);

    const run = await this.config.backend.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const decidedAt = new Date();
    const decisionContext = {
      approved: decision.approved,
      approver: decision.approver,
      comment: decision.comment,
      decidedAt: decidedAt.toISOString(),
    };

    await this.config.backend.updateRun(runId, {
      context: {
        ...run.context,
        [approval.nodeId]: decisionContext,
      },
      nodeStates: {
        ...run.nodeStates,
        [approval.nodeId]: {
          nodeId: approval.nodeId,
          status: "completed",
          output: {
            approved: decision.approved,
            approver: decision.approver,
            comment: decision.comment,
          },
          attempt: 1,
          completedAt: decidedAt,
        },
      },
    });

    if (decision.approved) {
      if (!this.config.executor) {
        return;
      }

      try {
        await this.config.executor.resume(runId);
      } catch (error) {
        logger.error("Failed to resume workflow", error);
        throw error;
      }
      return;
    }

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

  private submitDecision(
    runId: string,
    approvalId: string,
    approver: string,
    approved: boolean,
    comment?: string,
  ): Promise<void> {
    return this.processDecision(runId, approvalId, {
      approved,
      approver,
      comment,
    });
  }

  /** Approve an approval request */
  approve(runId: string, approvalId: string, approver: string, comment?: string): Promise<void> {
    return this.submitDecision(runId, approvalId, approver, true, comment);
  }

  /** Reject an approval request */
  reject(runId: string, approvalId: string, approver: string, comment?: string): Promise<void> {
    return this.submitDecision(runId, approvalId, approver, false, comment);
  }

  /** List all pending approvals across workflows */
  listAllPending(filter?: {
    workflowId?: string;
    approver?: string;
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    const list = this.config.backend.listPendingApprovals;
    if (!list) {
      logger.warn(
        "[ApprovalManager] listPendingApprovals not supported by backend",
      );
      return Promise.resolve([]);
    }

    return list({ ...filter, status: "pending" });
  }

  /** Check and expire stale approvals */
  async checkExpiredApprovals(): Promise<void> {
    if (this.destroyed) {
      return;
    }

    const list = this.config.backend.listPendingApprovals;
    if (!list) {
      return;
    }

    const pending = await list({ status: "pending" });
    const now = new Date();

    for (const { runId, approval } of pending) {
      if (!approval.expiresAt || now <= approval.expiresAt) {
        continue;
      }

      logger.debug("Expiring approval", {
        approvalId: approval.id,
      });

      await this.config.backend.updateApproval(runId, approval.id, {
        approved: false,
        approver: "system",
        comment: "Approval expired",
      });

      await this.config.backend.updateRun(runId, {
        status: "failed",
        error: { message: `Approval "${approval.id}" expired` },
        completedAt: new Date(),
      });
    }
  }

  private startExpirationChecker(): void {
    this.expirationTimer = setInterval(() => {
      this.checkExpiredApprovals().catch((error) => {
        logger.error("Expiration check failed", error);
      });
    }, this.config.expirationCheckInterval);
  }

  /** Stop the approval manager */
  stop(): void {
    this.destroyed = true;

    if (!this.expirationTimer) {
      return;
    }

    clearInterval(this.expirationTimer);
    this.expirationTimer = undefined;
  }
}
