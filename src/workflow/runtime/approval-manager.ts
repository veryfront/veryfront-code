import { logger as baseLogger } from "#veryfront/utils";
import type {
  ApprovalDecision,
  PendingApproval,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowRun,
} from "../types.ts";
import {
  captureApprovalApprovers,
  generateId,
  isCanonicalApprovalIdentity,
  parsePositiveDurationWithLabel,
} from "../types.ts";
import {
  type ApprovalDecisionTiming,
  updateRunIfStatus,
  type WorkflowBackend,
} from "../backends/types.ts";
import type { WorkflowExecutor } from "../executor/workflow-executor.ts";
import { reconcileWorkflowRunControl } from "./workflow-run-control.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS } from "../limits.ts";
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
const APPROVAL_DECISION_KEYS = new Set(["approved", "approver", "comment"]);
const SYSTEM_EXPIRATION_DECISION: ApprovalDecision = Object.freeze({
  approved: false,
  approver: "system",
  comment: "Approval expired",
});

function assertAtomicApprovalResult(
  value: unknown,
  approvalId: string,
): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow backend violated the atomic approval contract for ${approvalId}: ` +
        "updateApproval must resolve to a boolean",
    });
  }
}

function captureApprovalDecision(value: unknown): ApprovalDecision {
  if (
    typeof value !== "object" || value === null || isProxyWithoutHooks(value) ||
    Array.isArray(value)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Approval decision must be a plain data object" });
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== null &&
    (isProxyWithoutHooks(prototype) || Object.getPrototypeOf(prototype) !== null)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Approval decision must be a plain data object" });
  }

  const keys = Reflect.ownKeys(value);
  if (
    keys.length < 2 || keys.length > 3 ||
    keys.some((key) => typeof key !== "string" || !APPROVAL_DECISION_KEYS.has(key))
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Approval decision must contain only approved, approver, and optional comment",
    });
  }

  const approvedDescriptor = Object.getOwnPropertyDescriptor(value, "approved");
  const approverDescriptor = Object.getOwnPropertyDescriptor(value, "approver");
  const commentDescriptor = Object.getOwnPropertyDescriptor(value, "comment");
  if (
    !approvedDescriptor || !("value" in approvedDescriptor) || !approvedDescriptor.enumerable ||
    !approverDescriptor || !("value" in approverDescriptor) || !approverDescriptor.enumerable ||
    (commentDescriptor !== undefined &&
      (!("value" in commentDescriptor) || !commentDescriptor.enumerable))
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Approval decision fields must be enumerable data properties",
    });
  }

  const approved = approvedDescriptor.value;
  const approver = approverDescriptor.value;
  const comment = commentDescriptor?.value;
  if (typeof approved !== "boolean") {
    throw INVALID_ARGUMENT.create({ detail: "Approval decision approved must be a boolean" });
  }
  if (
    !isCanonicalApprovalIdentity(approver) ||
    approver.length > MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Approval decision approver must be a canonical non-empty string of at most ${MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS} code units`,
    });
  }
  if (
    comment !== undefined &&
    (typeof comment !== "string" || comment.length > MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS)
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Approval decision comment must be a string of at most ${MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS} code units`,
    });
  }
  return Object.freeze({
    approved,
    approver,
    ...(comment === undefined ? {} : { comment }),
  });
}

function decisionsMatch(
  approval: PendingApproval,
  decision: ApprovalDecision,
): boolean {
  return approval.status === (decision.approved ? "approved" : "rejected") &&
    approval.decidedBy === decision.approver &&
    approval.comment === decision.comment;
}

function requireMatchingDurableDecisionTime(
  approval: PendingApproval,
  decision: ApprovalDecision,
): Date {
  if (!decisionsMatch(approval, decision)) {
    throw INVALID_ARGUMENT.create({
      detail: `Approval already processed with a different decision: ${approval.id}`,
    });
  }

  const decidedAt = approval.decidedAt;
  const decidedAtMs = decidedAt instanceof Date ? decidedAt.getTime() : Number.NaN;
  if (!Number.isFinite(decidedAtMs)) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Durable approval decision is missing a valid decidedAt: ${approval.id}`,
    });
  }
  return new Date(decidedAtMs);
}

function deepFreezeSnapshot<T>(value: T, seen = new WeakSet<object>()): T {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return value;
  }
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (descriptor && "value" in descriptor) {
      deepFreezeSnapshot(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function captureNotifierSnapshot<T>(value: T): T {
  return deepFreezeSnapshot(structuredClone(value));
}

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
  /** Start periodic expiration checks in the constructor (default: true). */
  autoStartExpirationChecks?: boolean;
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
  private expirationCheckPromise?: Promise<void>;
  private inFlightOperations = new Set<Promise<unknown>>();
  private destroyed = false;

  constructor(config: ApprovalManagerConfig) {
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw INVALID_ARGUMENT.create({
        detail: "ApprovalManager configuration must be an object",
      });
    }
    if (
      config.expirationCheckInterval !== undefined &&
      (!Number.isSafeInteger(config.expirationCheckInterval) ||
        config.expirationCheckInterval < 0 ||
        config.expirationCheckInterval > MAX_TIMER_DELAY_MS)
    ) {
      throw INVALID_ARGUMENT.create({
        detail:
          `ApprovalManager expirationCheckInterval must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`,
      });
    }
    if (
      config.autoStartExpirationChecks !== undefined &&
      typeof config.autoStartExpirationChecks !== "boolean"
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "ApprovalManager autoStartExpirationChecks must be a boolean",
      });
    }
    if (typeof config.backend?.listPendingApprovals !== "function") {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow backend must implement listPendingApprovals",
      });
    }
    if (typeof config.backend?.getApproval !== "function") {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow backend must implement getApproval",
      });
    }
    this.config = {
      expirationCheckInterval: DEFAULT_EXPIRATION_CHECK_INTERVAL_MS,
      autoStartExpirationChecks: true,
      debug: false,
      ...config,
    };

    const interval = this.config.expirationCheckInterval ?? 0;
    if (this.config.autoStartExpirationChecks && interval > 0) {
      this.startExpirationChecks();
    }
  }

  /** Create a pending approval request. */
  createApproval(
    run: WorkflowRun,
    nodeId: string,
    waitConfig: WaitNodeConfig,
    context: WorkflowContext,
  ): Promise<ApprovalRequest> {
    try {
      this.assertAcceptingOperations("create an approval");
    } catch (error) {
      return Promise.reject(error);
    }
    return this.trackOperation(this.performCreateApproval(run, nodeId, waitConfig, context));
  }

  private async performCreateApproval(
    run: WorkflowRun,
    nodeId: string,
    waitConfig: WaitNodeConfig,
    context: WorkflowContext,
  ): Promise<ApprovalRequest> {
    // Neither the caller nor a notifier may retain a live reference that can
    // redirect persistence after an asynchronous boundary.
    const canonicalRun = captureNotifierSnapshot(run);
    if (canonicalRun.status !== "waiting") {
      throw INVALID_ARGUMENT.create({
        detail: `Approval can be created only while run is waiting, got: ${canonicalRun.status}`,
      });
    }
    const message = waitConfig.message || "Approval required";
    const approvers = captureApprovalApprovers(
      waitConfig.approvers,
      "Approval request approvers",
    );
    const payloadSource = waitConfig.payload;
    const expiresAt = waitConfig.timeout !== undefined
      ? new Date(
        Date.now() +
          parsePositiveDurationWithLabel(waitConfig.timeout, "Approval timeout"),
      )
      : undefined;

    const resolvedPayload = typeof payloadSource === "function"
      ? await payloadSource(context)
      : payloadSource;
    const payload = structuredClone(resolvedPayload);

    const approval: PendingApproval = {
      id: generateId("apr"),
      nodeId,
      message,
      payload,
      approvers,
      requestedAt: new Date(),
      expiresAt,
      status: "pending",
    };

    logger.debug("Creating approval", {
      approvalId: approval.id,
      runId: canonicalRun.id,
    });

    // Approvals are reserved atomically before notification. This prevents a
    // delayed callback from notifying after the run became terminal; worker-
    // owned approvals additionally fence the exact durable owner.
    const ownerBound = canonicalRun.workerId !== undefined;
    if (ownerBound) {
      const saveOwned = this.config.backend.savePendingApprovalIfStatusAndWorker;
      const saved = saveOwned
        ? await saveOwned.call(
          this.config.backend,
          canonicalRun.id,
          ["waiting"],
          canonicalRun.workerId!,
          approval,
        )
        : false;
      if (!saved) {
        throw ORCHESTRATION_ERROR.create({
          detail: "Workflow execution ownership changed before approval persistence",
        });
      }
    } else {
      // Reserve before notification here as well. A notifier must never send a
      // link for an approval that a concurrent terminal transition prevents us
      // from persisting afterward.
      await this.config.backend.savePendingApproval(canonicalRun.id, approval);
    }

    try {
      await this.config.notifier?.(
        captureNotifierSnapshot(approval),
        canonicalRun,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      approval.notificationError = message;
      logger.error(
        "Failed to notify approvers; approval created but approvers were NOT informed",
        { approvalId: approval.id, runId: canonicalRun.id, error: message },
      );
    }

    if (approval.notificationError) {
      await this.config.backend.updatePendingApproval(
        canonicalRun.id,
        approval.id,
        { notificationError: approval.notificationError },
      );
    }

    return {
      approvalId: approval.id,
      runId: canonicalRun.id,
      nodeId,
      message: approval.message,
      payload: structuredClone(approval.payload),
      expiresAt: approval.expiresAt ? new Date(approval.expiresAt) : undefined,
      notificationError: approval.notificationError,
    };
  }

  /** Get the exact approval record by ID, including historical decision state. */
  getApproval(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null> {
    return this.admitOperation(
      "read an approval",
      () => this.getApprovalRaw(runId, approvalId),
    );
  }

  /** Get all pending approvals for a run */
  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    return this.admitOperation(
      "read pending approvals",
      () => this.getPendingApprovalsRaw(runId),
    );
  }

  private getApprovalRaw(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null> {
    return this.config.backend.getApproval(runId, approvalId);
  }

  private getPendingApprovalsRaw(runId: string): Promise<PendingApproval[]> {
    return this.config.backend.getPendingApprovals(runId);
  }

  /**
   * Process an approval decision. The host must derive `decision.approver`
   * from an authenticated principal; client-supplied identity is not proof of
   * authorization when the approval has no explicit allowlist.
   */
  processDecision(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    try {
      this.assertAcceptingOperations("process an approval decision");
      decision = captureApprovalDecision(decision);
    } catch (error) {
      return Promise.reject(error);
    }
    return this.trackOperation(this.performDecision(runId, approvalId, decision));
  }

  private async performDecision(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    // This is the canonical time at which the trusted host admitted the
    // decision. Storage latency after this point must not turn an on-time
    // decision into an expired one (or revive a decision received too late).
    const decisionTime = new Date();
    logger.debug("Processing decision", {
      approvalId,
      approved: decision.approved,
    });

    // Fast-path read: fetch the approval to validate expiry and approver
    // authorization before mutating anything. The pending-status check here is
    // only an early-out for the common already-decided case. It is NOT the
    // authoritative gate, because a concurrent decision could slip in between
    // this read and the write below.
    const approval = await this.getApprovalRaw(runId, approvalId);
    if (!approval) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
    }

    const approvers = captureApprovalApprovers(
      approval.approvers,
      "Persisted approval approvers",
    );
    if (approvers && !approvers.includes(decision.approver)) {
      throw PERMISSION_DENIED.create({ detail: "Not authorized to approve this request" });
    }

    let decidedAt: Date;
    if (approval.status === "pending") {
      if (approval.expiresAt && decisionTime > approval.expiresAt) {
        throw INVALID_ARGUMENT.create({ detail: "Approval has expired" });
      }

      // Authoritative gate: pending state and the persisted expiry are both
      // compared in the backend transaction that writes the decision.
      const timing: ApprovalDecisionTiming = {
        decidedAt: decisionTime,
        expiryCondition: "unexpired",
      };
      const applied: unknown = await this.config.backend.updateApproval(
        runId,
        approvalId,
        decision,
        timing,
      );
      assertAtomicApprovalResult(applied, approvalId);
      if (applied) {
        decidedAt = decisionTime;
      } else {
        const durable = await this.getApprovalRaw(runId, approvalId);
        if (!durable) {
          throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
        }
        if (durable.status === "pending") {
          const run = await this.config.backend.getRun(runId);
          if (!run) {
            throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });
          }
          if (run.status !== "waiting") {
            throw INVALID_ARGUMENT.create({
              detail: `Approval cannot be decided while run is ${run.status}`,
            });
          }
          if (durable.expiresAt && decisionTime > durable.expiresAt) {
            throw INVALID_ARGUMENT.create({ detail: "Approval has expired" });
          }
          throw ORCHESTRATION_ERROR.create({
            detail:
              `Workflow backend rejected approval "${approvalId}" although its atomic preconditions matched`,
          });
        }
        decidedAt = requireMatchingDurableDecisionTime(durable, decision);
      }
    } else {
      // A previous attempt may have durably committed the exact decision and
      // then failed while reconciling the run. Identical retries continue from
      // that durable fact; conflicting retries remain rejected.
      decidedAt = requireMatchingDurableDecisionTime(approval, decision);
    }

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
          decidedAt,
          maxAttempts: MAX_DECISION_RECONCILIATION_ATTEMPTS,
          resume: this.config.executor
            ? (id, expectedWorkerId) =>
              this.config.executor!.resume(id, undefined, expectedWorkerId)
            : undefined,
        },
      });
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
    return this.admitOperation(
      "list pending approvals",
      () =>
        this.listPendingApprovalsRaw({
          ...filter,
          status: "pending",
        }),
    );
  }

  private listPendingApprovalsRaw(filter: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    return this.config.backend.listPendingApprovals(filter);
  }

  /** Check and expire stale approvals */
  checkExpiredApprovals(): Promise<void> {
    if (this.destroyed) {
      return Promise.resolve();
    }

    if (this.expirationCheckPromise) return this.expirationCheckPromise;

    const check = this.performExpirationCheck();
    this.expirationCheckPromise = check;
    check.then(
      () => {
        if (this.expirationCheckPromise === check) this.expirationCheckPromise = undefined;
      },
      () => {
        if (this.expirationCheckPromise === check) this.expirationCheckPromise = undefined;
      },
    );
    return check;
  }

  private async performExpirationCheck(): Promise<void> {
    const pending = await this.listPendingApprovalsRaw({
      // This query intentionally includes already-decided records whose
      // persisted expiry passed. A prior expiration pass may have committed
      // the approval decision and then failed to reconcile the run.
      status: "expired",
    });
    const now = new Date();

    for (const { runId, approval } of pending) {
      if (!approval.expiresAt || now <= approval.expiresAt) {
        continue;
      }

      if (approval.status !== "pending" && !decisionsMatch(approval, SYSTEM_EXPIRATION_DECISION)) {
        continue;
      }

      logger.debug("Expiring approval", {
        approvalId: approval.id,
      });

      let decidedAt: Date;
      if (approval.status === "pending") {
        const expired: unknown = await this.config.backend.updateApproval(
          runId,
          approval.id,
          SYSTEM_EXPIRATION_DECISION,
          { decidedAt: now, expiryCondition: "expired" },
        );
        assertAtomicApprovalResult(expired, approval.id);
        if (expired) {
          decidedAt = now;
        } else {
          // A concurrent decision may have resolved the approval between the
          // list read and the CAS. Only the exact system-expiry decision is a
          // recoverable partial commit; a human decision must remain untouched.
          const durable = await this.getApprovalRaw(runId, approval.id);
          if (!durable || durable.status === "pending") {
            continue;
          }
          if (!decisionsMatch(durable, SYSTEM_EXPIRATION_DECISION)) {
            continue;
          }
          decidedAt = requireMatchingDurableDecisionTime(
            durable,
            SYSTEM_EXPIRATION_DECISION,
          );
        }
      } else {
        decidedAt = requireMatchingDurableDecisionTime(
          approval,
          SYSTEM_EXPIRATION_DECISION,
        );
      }

      await updateRunIfStatus(this.config.backend, runId, ["pending", "running", "waiting"], {
        status: "failed",
        error: { message: `Approval "${approval.id}" expired` },
        completedAt: decidedAt,
      });
    }
  }

  private assertAcceptingOperations(operation: string): void {
    if (this.destroyed) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Approval manager is stopped and cannot ${operation}`,
      });
    }
  }

  private admitOperation<T>(operation: string, callback: () => Promise<T>): Promise<T> {
    try {
      this.assertAcceptingOperations(operation);
    } catch (error) {
      return Promise.reject(error);
    }

    // Register the operation before invoking extension-owned backend code. A
    // synchronous re-entrant stop therefore cannot omit this read from drain.
    const deferred = Promise.withResolvers<T>();
    const tracked = this.trackOperation(deferred.promise);
    try {
      deferred.resolve(callback());
    } catch (error) {
      deferred.reject(error);
    }
    return tracked;
  }

  private trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.inFlightOperations.add(operation);
    operation.then(
      () => this.inFlightOperations.delete(operation),
      () => this.inFlightOperations.delete(operation),
    );
    return operation;
  }

  private startExpirationChecker(): void {
    this.expirationTimer = setInterval(() => {
      this.checkExpiredApprovals().catch((error) => {
        logger.error("Expiration check failed", error);
      });
    }, this.config.expirationCheckInterval);
  }

  /** Start periodic expiration checks. Safe to call repeatedly. */
  startExpirationChecks(): void {
    this.assertAcceptingOperations("start expiration checks");
    if (this.expirationTimer || (this.config.expirationCheckInterval ?? 0) === 0) return;
    this.startExpirationChecker();
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

  /** Stop scheduled checks and wait for an in-flight expiration pass. */
  async destroy(): Promise<void> {
    this.stop();
    const expirationCheck = this.expirationCheckPromise;
    const operations = [...this.inFlightOperations];
    await Promise.allSettled([
      ...(expirationCheck ? [expirationCheck] : []),
      ...operations,
    ]);
  }
}
