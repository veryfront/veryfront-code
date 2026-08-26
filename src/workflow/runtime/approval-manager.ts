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
  isSameWaitNodeExecution,
  type PersistedPendingApproval,
  updateRunIfStatus,
  type WorkflowBackend,
} from "../backends/types.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import { ApprovalDecisionSchema } from "../schemas/workflow.schema.ts";
import { unrefTimer } from "#veryfront/compat/process.ts";
import {
  assertApprovalDecisionPatchIsolation,
  reconcileWorkflowRunControl,
  type WorkflowRunControlReconcileOutcome,
} from "./workflow-run-control.ts";
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
const DEFAULT_DECISION_CLAIM_RECOVERY_DELAY_MS = 30_000;
const DEFAULT_DECISION_CLAIM_CHECK_INTERVAL_MS = 60_000;
const MIN_DECISION_CLAIM_RECOVERY_LEASE_MS = 1_000;
const MAX_DECISION_RECONCILIATION_ATTEMPTS = 8;
const APPROVAL_CREATION_ALREADY_SETTLED = Symbol("approval-creation-already-settled");

function shouldRetainDecisionClaim(
  outcome: WorkflowRunControlReconcileOutcome,
  decision: ApprovalDecision,
  canResume: boolean,
): boolean {
  const failedRunMayStillRetry = outcome.status === "skipped-terminal" &&
    outcome.run?.status === "failed";
  return failedRunMayStillRetry ||
    (decision.approved && outcome.run?.status === "waiting" && !canResume);
}

function reconstructApprovalDecision(
  approval: PersistedPendingApproval,
): ApprovalDecision {
  if (approval.status !== "approved" && approval.status !== "rejected") {
    throw new Error("Approval decision claim has no decided status");
  }
  return ApprovalDecisionSchema.parse({
    approved: approval.status === "approved",
    approver: approval.decidedBy,
    ...(approval.comment === undefined ? {} : { comment: approval.comment }),
    ...(approval.decisionData === undefined ? {} : { data: approval.decisionData }),
  });
}

type PreparedApprovalDecisionClaim = {
  approval: PersistedPendingApproval;
  decision: ApprovalDecision;
};

async function prepareApprovalDecisionClaims(
  backend: WorkflowBackend,
  runId: string,
): Promise<PreparedApprovalDecisionClaim[]> {
  const listClaims = backend.listApprovalDecisionClaims;
  if (!listClaims) return [];
  const claims = await listClaims.call(backend, runId);
  const prepared: PreparedApprovalDecisionClaim[] = [];
  for (const claim of claims) {
    if (claim.runId !== runId) continue;
    const { approval } = claim;
    if (!approval.decidedAt || !Number.isFinite(approval.decidedAt.getTime())) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Approval decision claim "${approval.id}" has no valid decision time`,
      });
    }
    prepared.push({ approval, decision: reconstructApprovalDecision(approval) });
  }
  return prepared;
}

async function finalizeReconciledApprovalDecisions(
  backend: WorkflowBackend,
  runId: string,
  approvalIds: string[],
): Promise<void> {
  const finalizeDecision = backend.finalizeApprovalDecision;
  if (!finalizeDecision) return;
  for (const approvalId of approvalIds) {
    try {
      await finalizeDecision.call(backend, runId, approvalId);
    } catch (error) {
      logger.error(
        "Failed to finalize a reconciled approval decision during retry",
        { approvalId, runId },
        error,
      );
    }
  }
}

/** @internal Apply retained decisions after retry reactivates a failed run. */
export async function reconcileApprovalDecisionClaimsBeforeRetry(
  backend: WorkflowBackend,
  runId: string,
): Promise<void> {
  const prepared = await prepareApprovalDecisionClaims(backend, runId);
  const finalizedApprovalIds: string[] = [];
  for (const { approval, decision } of prepared) {
    const run = await backend.getRun(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });

    const currentState = run.nodeStates[approval.nodeId];
    if (
      !isSameWaitNodeExecution(approval, {
        nodeId: approval.nodeId,
        waitInstanceId: currentState?._waitInstanceId,
      })
    ) {
      finalizedApprovalIds.push(approval.id);
      continue;
    }

    if (currentState?.status !== "completed") {
      const outcome = await reconcileWorkflowRunControl({
        backend,
        operation: {
          type: "approval-decision",
          runId,
          approvalId: approval.id,
          nodeId: approval.nodeId,
          decision,
          decidedAt: approval.decidedAt,
          maxAttempts: MAX_DECISION_RECONCILIATION_ATTEMPTS,
        },
      });
      if (outcome.status === "skipped-terminal") continue;
    }
    finalizedApprovalIds.push(approval.id);
  }

  // Every node outcome has committed before cleanup starts. A cleanup failure
  // must not make retry restore the old failed snapshot: claims already cleaned
  // up could no longer replay their now-reverted node outcome. Leave only the
  // failed cleanup durable for the normal decision-claim recovery pass instead.
  await finalizeReconciledApprovalDecisions(backend, runId, finalizedApprovalIds);
}

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
  /** Age after which an unfinished decision claim is recoverable after a process exit (ms). */
  decisionClaimRecoveryDelay?: number;
  /** Interval for discovering decision claims abandoned by another process (ms). */
  decisionClaimCheckInterval?: number;
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
  private activeDecisionClaims = new Set<string>();
  private decisionClaimReconciliation?: Promise<void>;
  private decisionClaimRecoveryTimer?: ReturnType<typeof setTimeout>;
  private decisionClaimRecoveryAt?: number;
  private decisionClaimCheckTimer?: ReturnType<typeof setInterval>;

  constructor(config: ApprovalManagerConfig) {
    this.config = {
      expirationCheckInterval: DEFAULT_EXPIRATION_CHECK_INTERVAL_MS,
      decisionClaimRecoveryDelay: DEFAULT_DECISION_CLAIM_RECOVERY_DELAY_MS,
      decisionClaimCheckInterval: DEFAULT_DECISION_CLAIM_CHECK_INTERVAL_MS,
      debug: false,
      ...config,
    };

    this.startDecisionClaimRecovery();

    const interval = this.config.expirationCheckInterval ?? 0;
    if (interval > 0) {
      this.startExpirationChecker();
    }
  }

  private async findApprovalCreationCollision(
    runId: string,
    approval: PersistedPendingApproval,
  ): Promise<PersistedPendingApproval | typeof APPROVAL_CREATION_ALREADY_SETTLED | null> {
    const pending = (await this.config.backend.getPendingApprovals(runId)).find((candidate) =>
      isSameWaitNodeExecution(candidate, approval)
    );
    if (pending) return pending;

    const claims = await this.config.backend.listApprovalDecisionClaims?.(runId) ?? [];
    const claim = claims.find((candidate) =>
      candidate.runId === runId && isSameWaitNodeExecution(candidate.approval, approval)
    );
    if (claim) return claim.approval;

    const run = await this.config.backend.getRun(runId);
    if (
      !run || run.status === "completed" || run.status === "failed" || run.status === "cancelled"
    ) {
      return APPROVAL_CREATION_ALREADY_SETTLED;
    }
    const currentState = run.nodeStates[approval.nodeId];
    if (
      !isSameWaitNodeExecution(approval, {
        nodeId: approval.nodeId,
        waitInstanceId: currentState?._waitInstanceId,
      }) || currentState?.status === "completed" || currentState?.status === "failed"
    ) {
      return APPROVAL_CREATION_ALREADY_SETTLED;
    }
    return null;
  }

  private startDecisionClaimRecovery(): void {
    if ((this.config.decisionClaimCheckInterval ?? 0) <= 0) return;
    void this.checkApprovalDecisionClaims().catch((error) => {
      logger.error("Approval decision claim recovery failed", error);
    });
    this.startDecisionClaimChecker();
  }

  /** Create a pending approval request */
  async createApproval(
    run: WorkflowRun,
    nodeId: string,
    waitConfig: WaitNodeConfig,
    context: WorkflowContext,
    options: { responseSchemaId?: string; notify?: boolean } = {},
  ): Promise<ApprovalRequest> {
    const runId = run.id;
    const workerId = run.workerId;
    const timeoutMs = waitConfig.timeout ? parseDuration(waitConfig.timeout) : undefined;
    const payload = typeof waitConfig.payload === "function"
      ? await waitConfig.payload(context)
      : waitConfig.payload;

    const nodeStartedAt = run.nodeStates[nodeId]?.startedAt;
    const nodeStartedAtMs = nodeStartedAt === undefined
      ? Number.NaN
      : new Date(nodeStartedAt).getTime();
    const timeoutBaseMs = Number.isFinite(nodeStartedAtMs) ? nodeStartedAtMs : Date.now();
    const expiresAt = timeoutMs ? new Date(timeoutBaseMs + timeoutMs) : undefined;

    const approval: PersistedPendingApproval = {
      id: generateId("apr"),
      nodeId,
      message: waitConfig.message || "Approval required",
      payload,
      approvers: waitConfig.approvers,
      requestedAt: new Date(),
      expiresAt,
      status: "pending",
      ...(run.nodeStates[nodeId]?._waitInstanceId === undefined
        ? {}
        : { waitInstanceId: run.nodeStates[nodeId]._waitInstanceId }),
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
          const collision = await this.findApprovalCreationCollision(runId, approval);
          if (collision) {
            if (responseSchemaKey) this.responseSchemas.delete(responseSchemaKey);
            return projectApprovalRequest(
              runId,
              collision === APPROVAL_CREATION_ALREADY_SETTLED ? approval : collision,
            );
          }
          throw ORCHESTRATION_ERROR.create({
            detail: "Workflow execution ownership changed before approval persistence",
          });
        }
      } else {
        const saveIfAbsent = this.config.backend.savePendingApprovalIfAbsent;
        if (!saveIfAbsent) {
          throw ORCHESTRATION_ERROR.create({
            detail: "Backend does not support atomic ownerless approval creation",
          });
        }
        const saved = await saveIfAbsent.call(this.config.backend, runId, approval);
        if (!saved) {
          const collision = await this.findApprovalCreationCollision(runId, approval);
          if (responseSchemaKey) this.responseSchemas.delete(responseSchemaKey);
          if (collision) {
            return projectApprovalRequest(
              runId,
              collision === APPROVAL_CREATION_ALREADY_SETTLED ? approval : collision,
            );
          }
          throw ORCHESTRATION_ERROR.create({
            detail: "Atomic approval creation lost without an existing approval",
          });
        }
      }
    } catch (error) {
      if (responseSchemaKey) this.responseSchemas.delete(responseSchemaKey);
      throw error;
    }

    if (options.notify !== false) await this.notifyApproval(run, approval);

    return projectApprovalRequest(runId, approval);
  }

  /** Notify after the execution lock has released for an already-persisted approval. */
  async notifyPendingApproval(run: WorkflowRun, nodeId: string): Promise<void> {
    if (!this.config.notifier) return;
    const state = run.nodeStates[nodeId];
    const approval = (await this.config.backend.getPendingApprovals(run.id)).find((candidate) =>
      isSameWaitNodeExecution(candidate, {
        nodeId,
        waitInstanceId: state?._waitInstanceId,
      })
    );
    if (approval) await this.notifyApproval(run, approval);
  }

  private async notifyApproval(
    run: WorkflowRun,
    approval: PersistedPendingApproval,
  ): Promise<void> {
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
        { approvalId: approval.id, runId: run.id, error: message },
      );
    }

    if (approval.notificationError) {
      const updatePendingApproval = this.config.backend.updatePendingApproval;
      if (!updatePendingApproval) {
        logger.warn(
          "Backend cannot persist approval notification state; the failed notification is " +
            "reported only to this caller",
          { approvalId: approval.id, runId: run.id },
        );
      } else {
        try {
          await updatePendingApproval.call(
            this.config.backend,
            run.id,
            approval.id,
            { notificationError: approval.notificationError },
          );
        } catch (error) {
          logger.error(
            "Failed to persist approval notification state",
            { approvalId: approval.id, runId: run.id },
            error,
          );
        }
      }
    }
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

  /** Reconcile durable decisions left behind by an interrupted process. */
  checkApprovalDecisionClaims(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (this.decisionClaimReconciliation) return this.decisionClaimReconciliation;

    const reconciliation = this.reconcileApprovalDecisionClaims();
    this.decisionClaimReconciliation = reconciliation;
    void reconciliation.then(
      () => {
        if (this.decisionClaimReconciliation === reconciliation) {
          this.decisionClaimReconciliation = undefined;
        }
      },
      () => {
        if (this.decisionClaimReconciliation === reconciliation) {
          this.decisionClaimReconciliation = undefined;
        }
      },
    );
    return reconciliation;
  }

  private async reconcileApprovalDecisionClaims(): Promise<void> {
    const listClaims = this.config.backend.listApprovalDecisionClaims;
    const reserveClaim = this.config.backend.reserveApprovalDecisionClaim;
    if (!listClaims || !reserveClaim) return;
    const recoveryDelay = this.config.decisionClaimRecoveryDelay ??
      DEFAULT_DECISION_CLAIM_RECOVERY_DELAY_MS;
    const recoveryLease = Math.max(recoveryDelay, MIN_DECISION_CLAIM_RECOVERY_LEASE_MS);
    const claims = await listClaims.call(this.config.backend);

    for (const { runId, approval } of claims) {
      if (this.destroyed) return;
      await this.reconcileApprovalDecisionClaim(
        runId,
        approval,
        recoveryDelay,
        recoveryLease,
      );
    }
  }

  private async reconcileApprovalDecisionClaim(
    runId: string,
    approval: PersistedPendingApproval,
    recoveryDelay: number,
    recoveryLease: number,
  ): Promise<void> {
    const claimKey = this.decisionClaimKey(runId, approval.id);
    if (this.activeDecisionClaims.has(claimKey)) return;
    if (!approval.decidedAt || !Number.isFinite(approval.decidedAt.getTime())) return;

    const lastClaimedAt = approval.recoveryClaimedAt ?? approval.decidedAt;
    const requiredAge = approval.recoveryClaimedAt ? recoveryLease : recoveryDelay;
    const claimAge = Date.now() - lastClaimedAt.getTime();
    if (claimAge < requiredAge) {
      this.scheduleDecisionClaimRecovery(requiredAge - claimAge);
      return;
    }

    const decision = this.tryReconstructApprovalDecision(runId, approval);
    if (!decision) return;
    const recoveryClaimId = await this.reserveApprovalDecisionRecovery(
      runId,
      approval.id,
      recoveryLease,
    );
    if (!recoveryClaimId) return;
    await this.reconcileReservedApprovalDecision(
      runId,
      approval,
      decision,
      claimKey,
      recoveryClaimId,
    );
  }

  private tryReconstructApprovalDecision(
    runId: string,
    approval: PersistedPendingApproval,
  ): ApprovalDecision | null {
    try {
      return reconstructApprovalDecision(approval);
    } catch (error) {
      logger.error(
        "Cannot reconstruct a durable approval decision claim",
        { approvalId: approval.id, runId },
        error,
      );
      return null;
    }
  }

  private async reserveApprovalDecisionRecovery(
    runId: string,
    approvalId: string,
    recoveryLease: number,
  ): Promise<string | null> {
    const reserveClaim = this.config.backend.reserveApprovalDecisionClaim;
    if (!reserveClaim) return null;
    const recoveryClaimId = generateId("apr-recovery");
    const claimedAt = new Date();
    const reserved = await reserveClaim.call(
      this.config.backend,
      runId,
      approvalId,
      recoveryClaimId,
      claimedAt,
      new Date(claimedAt.getTime() - recoveryLease),
    );
    return reserved ? recoveryClaimId : null;
  }

  private async reconcileReservedApprovalDecision(
    runId: string,
    approval: PersistedPendingApproval,
    decision: ApprovalDecision,
    claimKey: string,
    recoveryClaimId: string,
  ): Promise<void> {
    this.activeDecisionClaims.add(claimKey);
    let releaseReservation = false;
    try {
      releaseReservation = await this.applyReservedApprovalDecision(
        runId,
        approval,
        decision,
        recoveryClaimId,
      );
    } catch (error) {
      logger.error(
        "Failed to recover an approval decision claim",
        { approvalId: approval.id, runId },
        error,
      );
    } finally {
      try {
        if (releaseReservation) {
          await this.config.backend.releaseApprovalDecisionClaim?.(
            runId,
            approval.id,
            recoveryClaimId,
          );
        }
      } finally {
        this.activeDecisionClaims.delete(claimKey);
      }
    }
  }

  /** Return true when the durable decision remains live and its reservation should be released. */
  private async applyReservedApprovalDecision(
    runId: string,
    approval: PersistedPendingApproval,
    decision: ApprovalDecision,
    recoveryClaimId: string,
  ): Promise<boolean> {
    const run = await this.config.backend.getRun(runId);
    if (!run) {
      await this.finalizeReservedApproval(runId, approval.id, recoveryClaimId);
      return false;
    }
    const currentState = run.nodeStates[approval.nodeId];
    if (
      !isSameWaitNodeExecution(approval, {
        nodeId: approval.nodeId,
        waitInstanceId: currentState?._waitInstanceId,
      })
    ) {
      // The old decision already resumed the run far enough to create a newer
      // execution of this reusable wait. Reapplying it would approve the new
      // iteration without its own human decision.
      await this.finalizeReservedApproval(runId, approval.id, recoveryClaimId);
      return false;
    }
    if (currentState?.status === "completed") {
      return await this.finishCommittedApprovalDecision(
        run,
        approval,
        decision,
        recoveryClaimId,
      );
    }

    const outcome = await reconcileWorkflowRunControl({
      backend: this.config.backend,
      operation: {
        type: "approval-decision",
        runId,
        approvalId: approval.id,
        nodeId: approval.nodeId,
        decision,
        decidedAt: approval.decidedAt!,
        maxAttempts: MAX_DECISION_RECONCILIATION_ATTEMPTS,
        resume: this.config.executor
          ? (id, expectedWorkerId) => this.config.executor!.resume(id, undefined, expectedWorkerId)
          : undefined,
      },
    });
    if (shouldRetainDecisionClaim(outcome, decision, this.config.executor !== undefined)) {
      return true;
    }
    await this.finalizeReservedApproval(runId, approval.id, recoveryClaimId);
    return false;
  }

  private async finishCommittedApprovalDecision(
    run: WorkflowRun,
    approval: PersistedPendingApproval,
    decision: ApprovalDecision,
    recoveryClaimId: string,
  ): Promise<boolean> {
    if (decision.approved && run.status === "waiting") {
      if (!this.config.executor) return true;
      await this.config.executor.resume(run.id, undefined, run.workerId);
    }
    await this.finalizeReservedApproval(run.id, approval.id, recoveryClaimId);
    return false;
  }

  private async finalizeReservedApproval(
    runId: string,
    approvalId: string,
    recoveryClaimId: string,
  ): Promise<void> {
    await this.config.backend.finalizeApprovalDecision?.(
      runId,
      approvalId,
      recoveryClaimId,
    );
  }

  private decisionClaimKey(runId: string, approvalId: string): string {
    return `${runId}\0${approvalId}`;
  }

  private scheduleDecisionClaimRecovery(delayMs: number): void {
    if (this.destroyed) return;
    const dueAt = Date.now() + Math.max(1, delayMs);
    if (
      this.decisionClaimRecoveryTimer !== undefined &&
      this.decisionClaimRecoveryAt !== undefined &&
      this.decisionClaimRecoveryAt <= dueAt
    ) return;

    if (this.decisionClaimRecoveryTimer !== undefined) {
      clearTimeout(this.decisionClaimRecoveryTimer);
    }
    this.decisionClaimRecoveryAt = dueAt;
    this.decisionClaimRecoveryTimer = setTimeout(() => {
      this.decisionClaimRecoveryTimer = undefined;
      this.decisionClaimRecoveryAt = undefined;
      if (this.destroyed) return;
      void this.checkApprovalDecisionClaims().catch((error) => {
        logger.error("Approval decision claim recovery failed", error);
      });
    }, Math.max(1, dueAt - Date.now()));
    unrefTimer(this.decisionClaimRecoveryTimer);
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
    this.assertDecisionCanApply(approval, decision);

    await this.validateDecisionData(runId, approval, decision);

    // Replacement-map backends cannot preserve two dependency-free approval
    // outcomes that race from the same run snapshot. Fence before either
    // decision leaves the pending set, while every sibling is still visible.
    await assertApprovalDecisionPatchIsolation(this.config.backend, runId, approvalId);

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
    const claimKey = this.decisionClaimKey(runId, approvalId);
    this.activeDecisionClaims.add(claimKey);
    try {
      const outcome = await this.reconcileAppliedDecision(runId, approvalId, approval, decision);
      if (!shouldRetainDecisionClaim(outcome, decision, this.config.executor !== undefined)) {
        try {
          await this.config.backend.finalizeApprovalDecision?.(runId, approvalId);
        } catch (error) {
          logger.error(
            "Failed to finalize an approval decision claim",
            { approvalId, runId },
            error,
          );
        }
      }
    } catch (error) {
      if (decision.approved && this.config.executor) {
        logger.error("Failed to resume workflow", error);
      }
      throw error;
    } finally {
      this.activeDecisionClaims.delete(claimKey);
    }
  }

  private assertDecisionCanApply(
    approval: PersistedPendingApproval,
    decision: ApprovalDecision,
  ): void {
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
  }

  private async reconcileAppliedDecision(
    runId: string,
    approvalId: string,
    approval: PersistedPendingApproval,
    decision: ApprovalDecision,
  ): Promise<WorkflowRunControlReconcileOutcome> {
    return await reconcileWorkflowRunControl({
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
          ? (id, expectedWorkerId) => this.config.executor!.resume(id, undefined, expectedWorkerId)
          : undefined,
      },
    });
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

      const failed = await updateRunIfStatus(
        this.config.backend,
        runId,
        ["pending", "running", "waiting"],
        {
          status: "failed",
          error: { message: `Approval "${approval.id}" expired` },
          completedAt: new Date(),
        },
      );
      if (!failed) {
        const latest = await this.config.backend.getRun(runId);
        if (
          latest && latest.status !== "completed" && latest.status !== "cancelled"
        ) continue;
      }
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
      void this.runMaintenance();
    }, this.config.expirationCheckInterval);
  }

  private startDecisionClaimChecker(): void {
    this.decisionClaimCheckTimer = setInterval(() => {
      void this.checkApprovalDecisionClaims().catch((error) => {
        logger.error("Approval decision claim recovery failed", error);
      });
    }, this.config.decisionClaimCheckInterval);
    unrefTimer(this.decisionClaimCheckTimer);
  }

  private async runMaintenance(): Promise<void> {
    try {
      await this.checkExpiredApprovals();
    } catch (error) {
      logger.error("Expiration check failed", error);
    }
  }

  /** Stop the approval manager */
  stop(): void {
    this.destroyed = true;

    if (this.decisionClaimRecoveryTimer !== undefined) {
      clearTimeout(this.decisionClaimRecoveryTimer);
      this.decisionClaimRecoveryTimer = undefined;
      this.decisionClaimRecoveryAt = undefined;
    }

    if (this.decisionClaimCheckTimer !== undefined) {
      clearInterval(this.decisionClaimCheckTimer);
      this.decisionClaimCheckTimer = undefined;
    }

    if (!this.expirationTimer) {
      return;
    }

    clearInterval(this.expirationTimer);
    this.expirationTimer = undefined;
  }
}
