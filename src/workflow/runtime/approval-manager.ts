import { logger as baseLogger } from "#veryfront/utils";
import type {
  ApprovalDecision,
  PendingApproval,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { generateId, parseDuration } from "../types.ts";
import {
  type PersistedPendingApproval,
  updateRunIfStatus,
  type WorkflowBackend,
} from "../backends/types.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import { ApprovalDecisionSchema } from "../schemas/workflow.schema.ts";
import { reconcileWorkflowRunControl } from "./workflow-run-control.ts";
import { projectPendingApproval, projectRunPendingApprovals } from "./pending-approval-metadata.ts";
import {
  INVALID_ARGUMENT,
  ORCHESTRATION_ERROR,
  PERMISSION_DENIED,
  RESOURCE_NOT_FOUND,
} from "#veryfront/errors";

const logger = baseLogger.component("approval-manager");

/** Default interval for checking expired approvals */
const DEFAULT_EXPIRATION_CHECK_INTERVAL_MS = 60_000;
const MAX_DECISION_RECONCILIATION_ATTEMPTS = 8;

/** Receives detached approval and run snapshots. Mutating them does not change persisted state. */
export type ApprovalNotifier = (
  approval: PendingApproval,
  run: WorkflowRun,
) => Promise<void>;

export interface ApprovalResponseSchemaResolverInput {
  run: WorkflowRun;
  approval: PendingApproval;
}

export type ApprovalResponseSchemaResolver = (
  input: ApprovalResponseSchemaResolverInput,
) => Schema<unknown> | undefined | Promise<Schema<unknown> | undefined>;

export interface InternalApprovalResponseSchemaResolverInput {
  run: WorkflowRun;
  approval: PersistedPendingApproval;
}

export type InternalApprovalResponseSchemaResolver = (
  input: InternalApprovalResponseSchemaResolverInput,
) => Schema<unknown> | undefined | Promise<Schema<unknown> | undefined>;

export interface ApprovalManagerConfig {
  /** Backend for persistence */
  backend: WorkflowBackend;
  /** Workflow executor for resuming after approval */
  executor?: WorkflowExecutor;
  /** Notification callback. Approvals are persisted before this callback runs. */
  notifier?: ApprovalNotifier;
  /** Resolve a wait node response schema for persisted approvals. */
  responseSchemaResolver?: ApprovalResponseSchemaResolver;
  /** Resolve a response schema from backend-only approval metadata. */
  internalResponseSchemaResolver?: InternalApprovalResponseSchemaResolver;
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

function projectApprovalRequest(
  runId: string,
  approval: PersistedPendingApproval,
): ApprovalRequest {
  return {
    approvalId: approval.id,
    runId,
    nodeId: approval.nodeId,
    message: approval.message,
    payload: approval.payload,
    expiresAt: approval.expiresAt,
    notificationError: approval.notificationError,
  };
}

/** Manages pending approvals, processing decisions, and resuming workflows */
export class ApprovalManager {
  private config: ApprovalManagerConfig;
  private expirationTimer?: ReturnType<typeof setInterval>;
  private destroyed = false;
  private responseSchemas = new Map<string, Schema<unknown>>();

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
    options: { responseSchemaId?: string } = {},
  ): Promise<ApprovalRequest> {
    const runId = run.id;
    const workerId = run.workerId;
    const timeoutMs = waitConfig.timeout ? parseDuration(waitConfig.timeout) : undefined;
    const payload = typeof waitConfig.payload === "function"
      ? await waitConfig.payload(context)
      : waitConfig.payload;

    const expiresAt = timeoutMs ? new Date(Date.now() + timeoutMs) : undefined;

    const approval: PersistedPendingApproval = {
      id: generateId("apr"),
      nodeId,
      message: waitConfig.message || "Approval required",
      payload,
      approvers: waitConfig.approvers,
      requestedAt: new Date(),
      expiresAt,
      status: "pending",
      ...(options.responseSchemaId === undefined
        ? {}
        : { responseSchemaId: options.responseSchemaId }),
    };

    logger.debug("Creating approval", {
      approvalId: approval.id,
      runId,
    });

    const responseSchemaKey = waitConfig.responseSchema
      ? this.responseSchemaKey(runId, approval.id)
      : undefined;
    if (responseSchemaKey && waitConfig.responseSchema) {
      this.responseSchemas.set(responseSchemaKey, waitConfig.responseSchema);
    }

    // Persist before notifying for both owner-bound and ownerless callers. The
    // backend atomically rejects a second live approval for this node, so only
    // the winner is allowed to notify approvers.
    const ownerBound = workerId !== undefined;
    try {
      if (ownerBound) {
        const saveOwned = this.config.backend.savePendingApprovalIfStatusAndWorker;
        const saved = saveOwned
          ? await saveOwned.call(
            this.config.backend,
            runId,
            ["waiting"],
            workerId,
            approval,
          )
          : false;
        if (!saved) {
          const existing = (await this.config.backend.getPendingApprovals(runId)).find(
            (candidate) => candidate.nodeId === nodeId,
          );
          if (existing) {
            if (responseSchemaKey) this.responseSchemas.delete(responseSchemaKey);
            return projectApprovalRequest(runId, existing);
          }
          throw ORCHESTRATION_ERROR.create({
            detail: "Workflow execution ownership changed before approval persistence",
          });
        }
      } else {
        await this.config.backend.savePendingApproval(runId, approval);
        const pending = await this.config.backend.getPendingApprovals(runId);
        if (!pending.some((candidate) => candidate.id === approval.id)) {
          const existing = pending.find((candidate) => candidate.nodeId === nodeId);
          if (responseSchemaKey) this.responseSchemas.delete(responseSchemaKey);
          if (existing) return projectApprovalRequest(runId, existing);
          throw ORCHESTRATION_ERROR.create({
            detail: "Approval persistence completed without a pending record",
          });
        }
      }
    } catch (error) {
      if (responseSchemaKey) this.responseSchemas.delete(responseSchemaKey);
      throw error;
    }

    try {
      await this.config.notifier?.(
        structuredClone(projectPendingApproval(approval)),
        structuredClone(projectRunPendingApprovals(run)),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      approval.notificationError = message;
      logger.error(
        "Failed to notify approvers; approval created but approvers were NOT informed",
        { approvalId: approval.id, runId, error: message },
      );
    }

    if (approval.notificationError) {
      const updatePendingApproval = this.config.backend.updatePendingApproval;
      if (!updatePendingApproval) {
        logger.warn(
          "Backend cannot persist approval notification state; the failed notification is " +
            "reported only to this caller",
          { approvalId: approval.id, runId },
        );
      } else {
        try {
          await updatePendingApproval.call(
            this.config.backend,
            runId,
            approval.id,
            { notificationError: approval.notificationError },
          );
        } catch (error) {
          logger.error(
            "Failed to persist approval notification state",
            { approvalId: approval.id, runId },
            error,
          );
        }
      }
    }

    return projectApprovalRequest(runId, approval);
  }

  /** Get pending approval by ID */
  async getApproval(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null> {
    const approval = await this.getPersistedApproval(runId, approvalId);
    return approval ? projectPendingApproval(approval) : null;
  }

  private async getPersistedApproval(
    runId: string,
    approvalId: string,
  ): Promise<PersistedPendingApproval | null> {
    if (this.config.backend.getPendingApproval) {
      return this.config.backend.getPendingApproval(runId, approvalId);
    }

    const all = await this.config.backend.getPendingApprovals(runId);
    return all.find((a) => a.id === approvalId) ?? null;
  }

  /** Get all pending approvals for a run */
  async getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    const approvals = await this.config.backend.getPendingApprovals(runId);
    return approvals.map(projectPendingApproval);
  }

  private responseSchemaKey(runId: string, approvalId: string): string {
    return `${runId}::${approvalId}`;
  }

  private async resolveResponseSchema(
    runId: string,
    approval: PersistedPendingApproval,
  ): Promise<Schema<unknown> | undefined> {
    const localSchema = this.responseSchemas.get(this.responseSchemaKey(runId, approval.id));
    if (localSchema) return localSchema;

    const run = await this.config.backend.getRun(runId);
    if (!run) return undefined;

    if (this.config.responseSchemaResolver) {
      const publicSchema = await this.config.responseSchemaResolver({
        run: projectRunPendingApprovals(run),
        approval: projectPendingApproval(approval),
      });
      if (publicSchema) return publicSchema;
    }

    return await this.config.internalResponseSchemaResolver?.({ run, approval });
  }

  private async validateDecisionData(
    runId: string,
    approval: PersistedPendingApproval,
    decision: ApprovalDecision,
  ): Promise<void> {
    const schema = await this.resolveResponseSchema(runId, approval);
    if (!schema) return;

    try {
      schema.parse(decision.data);
    } catch (error) {
      throw INVALID_ARGUMENT.create({
        detail: `Approval "${approval.id}" data does not match the wait node's responseSchema: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /** Process an approval decision */
  async processDecision(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    decision = ApprovalDecisionSchema.parse(decision);
    logger.debug("Processing decision", {
      approvalId,
      approved: decision.approved,
    });

    // Fast-path read: fetch the approval to validate expiry and approver
    // authorization before mutating anything. The pending-status check here is
    // only an early-out for the common already-decided case. It is NOT the
    // authoritative gate, because a concurrent decision could slip in between
    // this read and the write below.
    const approval = await this.getPersistedApproval(runId, approvalId);
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

    await this.validateDecisionData(runId, approval, decision);

    // Authoritative gate: the backend applies the decision only while the
    // approval is still pending and reports whether it won the race. If another
    // decision resolved this approval first, `applied` is false and we must not
    // proceed to touch the run.
    const applied = await this.config.backend.updateApproval(runId, approvalId, decision);
    if (applied === false) {
      throw INVALID_ARGUMENT.create({ detail: `Approval already processed: ${approvalId}` });
    }
    this.responseSchemas.delete(this.responseSchemaKey(runId, approvalId));

    // The approval decision is already durable. Reconcile it onto whichever
    // worker owns the run now, retrying if ownership changes between the read,
    // conditional patch, and resume. Without this loop, a successful approval
    // update could be consumed while leaving the workflow permanently waiting.
    try {
      await reconcileWorkflowRunControl({
        backend: this.config.backend,
        operation: {
          type: "approval-decision",
          runId,
          approvalId,
          nodeId: approval.nodeId,
          decision,
          decidedAt: new Date(),
          maxAttempts: MAX_DECISION_RECONCILIATION_ATTEMPTS,
          resume: this.config.executor
            ? (id, expectedWorkerId) =>
              this.config.executor!.resume(id, undefined, expectedWorkerId)
            : undefined,
        },
      });
      try {
        await this.config.backend.finalizeApprovalDecision?.(runId, approvalId);
      } catch (error) {
        logger.error(
          "Failed to finalize an approval decision claim",
          { approvalId, runId },
          error,
        );
      }
    } catch (error) {
      if (decision.approved && this.config.executor) {
        logger.error("Failed to resume workflow", error);
      }
      throw error;
    }
  }

  private submitDecision(
    runId: string,
    approvalId: string,
    approver: string,
    approved: boolean,
    comment?: string,
    data?: unknown,
  ): Promise<void> {
    return this.processDecision(runId, approvalId, {
      approved,
      approver,
      comment,
      ...(data === undefined ? {} : { data }),
    });
  }

  /** Approve an approval request */
  approve(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
    data?: unknown,
  ): Promise<void> {
    return this.submitDecision(runId, approvalId, approver, true, comment, data);
  }

  /** Reject an approval request */
  reject(
    runId: string,
    approvalId: string,
    approver: string,
    comment?: string,
    data?: unknown,
  ): Promise<void> {
    return this.submitDecision(runId, approvalId, approver, false, comment, data);
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

    return list({ ...filter, status: "pending" }).then((entries) =>
      entries.map(({ runId, approval }) => ({
        runId,
        approval: projectPendingApproval(approval),
      }))
    );
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
      this.responseSchemas.delete(this.responseSchemaKey(runId, approval.id));

      await updateRunIfStatus(this.config.backend, runId, ["pending", "running", "waiting"], {
        status: "failed",
        error: { message: `Approval "${approval.id}" expired` },
        completedAt: new Date(),
      });
      try {
        await this.config.backend.finalizeApprovalDecision?.(runId, approval.id);
      } catch (error) {
        logger.error(
          "Failed to finalize an expired approval decision claim",
          { approvalId: approval.id, runId },
          error,
        );
      }
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
