import { logger as baseLogger } from "#veryfront/utils";
import type {
  ApprovalDecision,
  PendingApproval,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";
import { generateId, parseDuration } from "../types.ts";
import { updateRunIfStatus, type WorkflowBackend } from "../backends/types.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import {
  INVALID_ARGUMENT,
  ORCHESTRATION_ERROR,
  PERMISSION_DENIED,
  RESOURCE_NOT_FOUND,
} from "#veryfront/errors";

const logger = baseLogger.component("approval-manager");

/** Default interval for checking expired approvals */
const DEFAULT_EXPIRATION_CHECK_INTERVAL_MS = 60_000;

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
  /**
   * Set when notifying approvers failed. The approval was still created and the
   * workflow is paused, but approvers were NOT informed. The caller should
   * re-notify or alert an operator rather than assume delivery.
   */
  notificationError?: string;
}

/** Manages pending approvals, processing decisions, and resuming workflows */
export class ApprovalManager {
  private config: ApprovalManagerConfig;
  private expirationTimer?: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor(config: ApprovalManagerConfig) {
    this.config = {
      expirationCheckInterval: DEFAULT_EXPIRATION_CHECK_INTERVAL_MS,
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

    // Worker-owned approvals are reserved atomically before notification. This
    // prevents a delayed onWaiting callback from notifying or appending after a
    // replacement worker has claimed the run.
    const ownerBound = run.workerId !== undefined;
    if (ownerBound) {
      const saveOwned = this.config.backend.savePendingApprovalIfStatusAndWorker;
      const saved = saveOwned
        ? await saveOwned.call(
          this.config.backend,
          run.id,
          [run.status],
          run.workerId!,
          approval,
        )
        : false;
      if (!saved) {
        throw ORCHESTRATION_ERROR.create({
          detail: "Workflow execution ownership changed before approval persistence",
        });
      }
    }

    try {
      await this.config.notifier?.(approval, run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      approval.notificationError = message;
      logger.error(
        "Failed to notify approvers; approval created but approvers were NOT informed",
        { approvalId: approval.id, runId: run.id, error: message },
      );
    }

    if (ownerBound) {
      if (approval.notificationError) {
        await this.config.backend.updatePendingApproval?.(
          run.id,
          approval.id,
          { notificationError: approval.notificationError },
        );
      }
    } else {
      // Preserve direct/ownerless behavior: resolve notification first so its
      // delivery error is included in the initial append.
      await this.config.backend.savePendingApproval(run.id, approval);
    }

    return {
      approvalId: approval.id,
      runId: run.id,
      nodeId,
      message: approval.message,
      payload: approval.payload,
      expiresAt: approval.expiresAt,
      notificationError: approval.notificationError,
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

    // Fast-path read: fetch the approval to validate expiry and approver
    // authorization before mutating anything. The pending-status check here is
    // only an early-out for the common already-decided case. It is NOT the
    // authoritative gate, because a concurrent decision could slip in between
    // this read and the write below.
    const approval = await this.getApproval(runId, approvalId);
    if (!approval) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
    }

    if (approval.status !== "pending") {
      throw INVALID_ARGUMENT.create({ detail: `Approval already processed: ${approval.status}` });
    }

    if (approval.expiresAt && new Date() > approval.expiresAt) {
      throw INVALID_ARGUMENT.create({ detail: "Approval has expired" });
    }

    const approvers = approval.approvers;
    if (approvers?.length && !approvers.includes(decision.approver)) {
      throw PERMISSION_DENIED.create({ detail: "Not authorized to approve this request" });
    }

    // Authoritative gate: the backend applies the decision only while the
    // approval is still pending and reports whether it won the race. If another
    // decision resolved this approval first, `applied` is false and we must not
    // proceed to touch the run.
    const applied = await this.config.backend.updateApproval(runId, approvalId, decision);
    if (applied === false) {
      throw INVALID_ARGUMENT.create({ detail: `Approval already processed: ${approvalId}` });
    }

    const run = await this.config.backend.getRun(runId);
    if (!run) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
    }

    const decidedAt = new Date();
    const decisionContext = {
      approved: decision.approved,
      approver: decision.approver,
      comment: decision.comment,
      decidedAt: decidedAt.toISOString(),
    };

    const runPatch: Partial<WorkflowRun> = {
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
    };

    if (decision.approved) {
      const updated = await updateRunIfStatus(
        this.config.backend,
        runId,
        ["pending", "running", "waiting"],
        runPatch,
      );
      if (!updated) return;

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

    await updateRunIfStatus(this.config.backend, runId, ["pending", "running", "waiting"], {
      ...runPatch,
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
    const list = this.config.backend.listPendingApprovals?.bind(
      this.config.backend,
    );
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

    const list = this.config.backend.listPendingApprovals?.bind(
      this.config.backend,
    );
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

      const expired = await this.config.backend.updateApproval(runId, approval.id, {
        approved: false,
        approver: "system",
        comment: "Approval expired",
      });
      // A concurrent decision may have resolved this approval between the list
      // read and here; if so the atomic gate skipped it, so don't fail the run.
      if (expired === false) {
        continue;
      }

      await updateRunIfStatus(this.config.backend, runId, ["pending", "running", "waiting"], {
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
