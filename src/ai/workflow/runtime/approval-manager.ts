
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

export type ApprovalNotifier = (
  approval: PendingApproval,
  run: WorkflowRun,
) => Promise<void>;

export interface ApprovalManagerConfig {
  backend: WorkflowBackend;
  executor?: WorkflowExecutor;
  notifier?: ApprovalNotifier;
  expirationCheckInterval?: number;
  debug?: boolean;
}

export interface ApprovalRequest {
  approvalId: string;
  runId: string;
  nodeId: string;
  message: string;
  payload: unknown;
  expiresAt?: Date;
}

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

    if (this.config.expirationCheckInterval && this.config.expirationCheckInterval > 0) {
      this.startExpirationChecker();
    }
  }

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

    if (this.config.debug) {
      console.log(`[ApprovalManager] Creating approval ${approval.id} for run ${run.id}`);
    }

    await this.config.backend.savePendingApproval(run.id, approval);

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

  async getApproval(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null> {
    if (this.config.backend.getPendingApproval) {
      return this.config.backend.getPendingApproval(runId, approvalId);
    }

    const all = await this.config.backend.getPendingApprovals(runId);
    return all.find((a) => a.id === approvalId) || null;
  }

  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    return this.config.backend.getPendingApprovals(runId);
  }

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

    if (
      approval.approvers &&
      approval.approvers.length > 0 &&
      !approval.approvers.includes(decision.approver)
    ) {
      throw new Error("Not authorized to approve this request");
    }

    await this.config.backend.updateApproval(runId, approvalId, decision);

    const run = await this.config.backend.getRun(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }

    const updatedContext = {
      ...run.context,
      [approval.nodeId]: {
        approved: decision.approved,
        approver: decision.approver,
        comment: decision.comment,
        decidedAt: new Date().toISOString(),
      },
    };

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

    if (decision.approved && this.config.executor) {
      try {
        await this.config.executor.resume(runId);
      } catch (error) {
        console.error(`[ApprovalManager] Failed to resume workflow:`, error);
        throw error;
      }
    } else if (!decision.approved) {
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

    console.warn(
      "[ApprovalManager] listPendingApprovals not supported by backend",
    );
    return Promise.resolve([]);
  }

  async checkExpiredApprovals(): Promise<void> {
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

        await this.config.backend.updateApproval(runId, approval.id, {
          approved: false,
          approver: "system",
          comment: "Approval expired",
        });

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

  private startExpirationChecker(): void {
    this.expirationTimer = setInterval(() => {
      this.checkExpiredApprovals().catch((error) => {
        console.error(`[ApprovalManager] Expiration check failed:`, error);
      });
    }, this.config.expirationCheckInterval);
  }

  stop(): void {
    this.destroyed = true;
    if (this.expirationTimer) {
      clearInterval(this.expirationTimer);
      this.expirationTimer = undefined;
    }
  }
}
