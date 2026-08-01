import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowQueueItem,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import { INVALID_ARGUMENT, ORCHESTRATION_ERROR } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS,
  MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS,
} from "../limits.ts";

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return false;
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Whether a persisted workflow identity has one transport-stable Unicode representation. */
export function isCanonicalWorkflowIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS && value.trim() === value &&
    isWellFormedUnicode(value);
}

/** Reject identities that cannot round-trip exactly through UTF-8 storage backends. */
export function assertWorkflowIdentity(value: unknown, label: string): asserts value is string {
  if (!isCanonicalWorkflowIdentity(value)) {
    throw INVALID_ARGUMENT.create({
      detail:
        `${label} must be a canonical non-empty string of at most ${MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS} code units with well-formed Unicode`,
    });
  }
}

function isPlainDataRecord(value: unknown): value is Record<PropertyKey, unknown> {
  if (
    typeof value !== "object" || value === null || isProxyWithoutHooks(value) ||
    Array.isArray(value)
  ) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === null ||
    (!isProxyWithoutHooks(prototype) && Object.getPrototypeOf(prototype) === null);
}

/** Run state that may change after the immutable run snapshot is created. */
export type WorkflowRunUpdate = Partial<
  Pick<
    WorkflowRun,
    | "status"
    | "output"
    | "nodeStates"
    | "currentNodes"
    | "context"
    | "error"
    | "startedAt"
    | "heartbeatAt"
    | "completedAt"
    | "workerId"
    | "_workflowProjection"
  >
>;

const WORKFLOW_RUN_UPDATE_FIELDS = new Set<keyof WorkflowRunUpdate>([
  "status",
  "output",
  "nodeStates",
  "currentNodes",
  "context",
  "error",
  "startedAt",
  "heartbeatAt",
  "completedAt",
  "workerId",
  "_workflowProjection",
]);

/** Reject untyped callers that attempt to rewrite immutable run state. */
export function assertWorkflowRunUpdate(patch: WorkflowRunUpdate): void {
  const immutableFields = Object.keys(patch).filter((field) =>
    !WORKFLOW_RUN_UPDATE_FIELDS.has(field as keyof WorkflowRunUpdate)
  );
  if (immutableFields.length > 0) {
    throw INVALID_ARGUMENT.create({
      detail: `Workflow run fields are immutable after creation: ${
        immutableFields.sort().join(", ")
      }`,
    });
  }
  if (patch.workerId !== undefined) assertWorkflowWorkerId(patch.workerId);
}

/** Reject missing or whitespace-only opaque workflow lock tokens. */
export function assertWorkflowLockId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.trim().length === 0 ||
    !isWellFormedUnicode(value)
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Workflow lock id must be a non-empty string" });
  }
}

/** Reject missing or whitespace-padded durable workflow owner identities. */
export function assertWorkflowWorkerId(value: unknown): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.trim() !== value || !isWellFormedUnicode(value)
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Workflow worker id must be a canonical non-empty string with well-formed Unicode",
    });
  }
}

/** Configuration used by backend. */
export interface BackendConfig {
  url?: string;
  prefix?: string;
  defaultTtl?: number;
  debug?: boolean;
}

export interface Lock {
  lockId: string;
  runId: string;
  acquiredAt: Date;
  expiresAt: Date;
}

/** Metadata that may be attached without changing an approval decision. */
export interface PendingApprovalMetadataUpdate {
  readonly notificationError: string;
}

/** Expiry predicate evaluated in the same transaction as an approval decision. */
export type ApprovalExpiryCondition = "unexpired" | "expired";

/**
 * Canonical time and expiry predicate for one approval decision attempt.
 *
 * `decidedAt` is captured once by the trusted workflow host. Backends must use
 * that exact value both for the persisted decision timestamp and for the
 * atomic comparison with the persisted approval expiry.
 */
export interface ApprovalDecisionTiming {
  readonly decidedAt: Date;
  readonly expiryCondition: ApprovalExpiryCondition;
}

/** Validate and detach caller-owned approval decision timing. */
export function captureApprovalDecisionTiming(
  value: ApprovalDecisionTiming,
): Readonly<ApprovalDecisionTiming> {
  if (!isPlainDataRecord(value)) {
    throw INVALID_ARGUMENT.create({
      detail: "Approval decision timing must contain decidedAt and expiryCondition",
    });
  }

  let keys: PropertyKey[];
  let decidedAtDescriptor: PropertyDescriptor | undefined;
  let expiryDescriptor: PropertyDescriptor | undefined;
  try {
    keys = Reflect.ownKeys(value);
    decidedAtDescriptor = Object.getOwnPropertyDescriptor(value, "decidedAt");
    expiryDescriptor = Object.getOwnPropertyDescriptor(value, "expiryCondition");
  } catch (cause) {
    throw INVALID_ARGUMENT.create({
      detail: "Approval decision timing could not be inspected",
      cause,
    });
  }

  if (
    keys.length !== 2 || !keys.includes("decidedAt") || !keys.includes("expiryCondition") ||
    !decidedAtDescriptor || !("value" in decidedAtDescriptor) ||
    !decidedAtDescriptor.enumerable ||
    !expiryDescriptor || !("value" in expiryDescriptor) ||
    !expiryDescriptor.enumerable ||
    (expiryDescriptor.value !== "unexpired" && expiryDescriptor.value !== "expired")
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Approval decision timing must contain decidedAt and expiryCondition",
    });
  }

  let decidedAtMs: number;
  try {
    if (isProxyWithoutHooks(decidedAtDescriptor.value)) throw new TypeError("Proxy Date");
    decidedAtMs = Date.prototype.getTime.call(decidedAtDescriptor.value);
  } catch (cause) {
    throw INVALID_ARGUMENT.create({
      detail: "Approval decision decidedAt must be a valid Date",
      cause,
    });
  }
  if (!Number.isFinite(decidedAtMs)) {
    throw INVALID_ARGUMENT.create({
      detail: "Approval decision decidedAt must be a valid Date",
    });
  }

  return Object.freeze({
    decidedAt: new Date(decidedAtMs),
    expiryCondition: expiryDescriptor.value,
  });
}

/**
 * Capture the only approval metadata update allowed outside the decision CAS.
 * Accessors and inherited properties are rejected before user code can run.
 */
export function capturePendingApprovalMetadataUpdate(
  patch: PendingApprovalMetadataUpdate,
): Readonly<PendingApprovalMetadataUpdate> {
  if (!isPlainDataRecord(patch)) {
    throw INVALID_ARGUMENT.create({
      detail: "Pending approval metadata update must contain only notificationError",
    });
  }

  let keys: PropertyKey[];
  let descriptor: PropertyDescriptor | undefined;
  try {
    keys = Reflect.ownKeys(patch);
    descriptor = Object.getOwnPropertyDescriptor(patch, "notificationError");
  } catch (cause) {
    throw INVALID_ARGUMENT.create({
      detail: "Pending approval metadata update could not be inspected",
      cause,
    });
  }

  if (
    keys.length !== 1 || keys[0] !== "notificationError" || !descriptor ||
    !("value" in descriptor) || !descriptor.enumerable ||
    typeof descriptor.value !== "string" ||
    descriptor.value.length > MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Pending approval metadata update must contain only notificationError",
    });
  }

  return Object.freeze({ notificationError: descriptor.value });
}

/** Public API contract for workflow backend. */
export interface WorkflowBackend {
  /**
   * Persist a new immutable run snapshot. Implementations must create only
   * when `run.id` is absent and reject conflicts without changing the existing
   * run or any indexes.
   */
  createRun(run: WorkflowRun): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | null>;
  updateRun(runId: string, patch: WorkflowRunUpdate): Promise<void>;
  /** Atomically apply a run patch only when the current status is expected. */
  updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    patch: WorkflowRunUpdate,
  ): Promise<boolean>;
  /** Apply a run patch only while both status and worker ownership match. */
  updateRunIfStatusAndWorker?(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    patch: WorkflowRunUpdate,
  ): Promise<boolean>;
  /**
   * Atomically apply a run patch only while the exact, unexpired execution
   * lease is still owned. When the patch changes status away from `running`,
   * the same atomic operation must consume that lease. An optional worker id
   * adds the durable worker-owner comparison to the same transaction.
   */
  updateRunIfStatusAndLock?(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean>;
  deleteRun?(runId: string): Promise<void>;
  listRuns(filter: RunFilter): Promise<WorkflowRun[]>;
  /**
   * Managed-worker keyset scan in canonical `(createdAt DESC, id DESC)` order.
   * A cursor is exclusive, so repeated bounded pages eventually cover every
   * matching run without relying on the public offset ceiling.
   */
  listRunsAfterCursor?(filter: WorkflowRunCursorFilter): Promise<WorkflowRun[]>;
  countRuns?(filter: RunFilter): Promise<number>;

  /**
   * Append a checkpoint to an existing run; reject when the run does not exist.
   * Built-ins retain only the newest bounded history in append order, so an
   * older explicit checkpoint id may no longer resolve after eviction.
   */
  saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void>;
  /**
   * Append and apply the same retention bound atomically, but only while the
   * canonical run status and worker owner match.
   */
  saveCheckpointIfStatusAndWorker?(
    storageRunId: string,
    ownershipRunId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    checkpoint: Checkpoint,
  ): Promise<boolean>;
  getLatestCheckpoint(runId: string): Promise<Checkpoint | null>;
  /** Return checkpoints in durable append order, oldest first. */
  getCheckpoints?(runId: string): Promise<Checkpoint[]>;
  /** Delete the oldest append-ordered occurrence matching the checkpoint ID. */
  deleteCheckpoint?(runId: string, checkpointId: string): Promise<void>;
  /**
   * Delete one oldest append-ordered occurrence for each supplied ID occurrence,
   * with behavior equivalent to sequential `deleteCheckpoint` calls.
   */
  deleteCheckpoints?(runId: string, checkpointIds: string[]): Promise<void>;

  /**
   * Append an approval with a run-unique id only while the owning run is
   * `waiting`; reject missing/non-waiting runs and duplicate ids atomically.
   */
  savePendingApproval(runId: string, approval: PendingApproval): Promise<void>;
  /**
   * Append a run-unique approval only while the run is `waiting` and the
   * supplied status and worker-owner predicates match.
   */
  savePendingApprovalIfStatusAndWorker?(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    approval: PendingApproval,
  ): Promise<boolean>;
  /** Record notification metadata without changing approval decision state. */
  updatePendingApproval(
    runId: string,
    approvalId: string,
    patch: PendingApprovalMetadataUpdate,
  ): Promise<void>;
  getPendingApprovals(runId: string): Promise<PendingApproval[]>;
  /** Return the approval record in any decision state, or null when absent. */
  getApproval(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null>;
  /**
   * Apply an approval decision atomically while the owning run is `waiting`,
   * the approval is pending, and its persisted expiry satisfies `timing.expiryCondition` at
   * `timing.decidedAt`. Resolve `true` only when the decision was written and
   * `false` when any precondition fails. The run-status and pending checks,
   * persisted expiry comparison, and decision write must be one compare-and-set operation. The
   * backend must persist `timing.decidedAt` exactly; it must not read its own
   * clock for this decision.
   */
  updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
    timing: ApprovalDecisionTiming,
  ): Promise<boolean>;
  /**
   * List approval records across runs for expiration and operator queries.
   * `status: "expired"` selects every record whose persisted expiry has passed,
   * including an already-decided system-expiry row that still needs run-state
   * reconciliation.
   */
  listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>>;

  enqueue?(job: WorkflowQueueItem): Promise<void>;
  dequeue?(): Promise<WorkflowQueueItem | null>;
  acknowledge?(runId: string): Promise<void>;
  nack?(runId: string): Promise<void>;

  /**
   * Acquire a lease, returning its opaque ownership token or null when another
   * owner holds the lease. Lock-capable backends must implement this together
   * with token-fenced renewal and release.
   */
  acquireLock?(runId: string, duration: number): Promise<string | null>;
  /** Release only the live lease owned by lockId; report whether it was deleted. */
  releaseLock?(runId: string, lockId: string): Promise<boolean>;
  /** Renew only the live lease owned by lockId; report whether it was extended. */
  extendLock?(runId: string, duration: number, lockId: string): Promise<boolean>;
  isLocked?(runId: string): Promise<boolean>;

  /** Find runs that appear stalled (no heartbeat within threshold ms) */
  findStalledRuns?(stalledThreshold: number): Promise<WorkflowRun[]>;
  /** Attempt to claim a stalled run for this worker (atomic compare-and-swap) */
  claimStalledRun?(runId: string, workerId: string, stalledThreshold: number): Promise<boolean>;

  /**
   * Atomically lease the earliest due timed-wait rows from a deadline index.
   * Implementations must return rows in `(deadline ASC, run id ASC, node id ASC)` order,
   * never return more than `request.limit`, and return at most one live claim
   * per run across both wait kinds. A due event timeout is terminal and must
   * prevent admission of every sibling delay for that run, including events
   * beyond the current claim-page boundary. Run-scoped admission must not
   * permanently starve otherwise eligible runs behind blocked rows. Exact
   * release, expiry, and resolution must fence stale claimants and atomically
   * restore or consume the run-scoped gate together with the row claim.
   */
  claimDueTimedWaits?(request: TimedWaitClaimRequest): Promise<TimedWaitClaim[]>;
  /**
   * Apply a timed-wait resolution only while the exact live claim, deadline,
   * waiting status, and durable worker owner still match. A successful update
   * consumes the claim and its deadline-index row atomically.
   */
  updateRunIfTimedWaitClaim?(
    runId: string,
    nodeId: string,
    claimId: string,
    expectedDeadline: number,
    expectedWorkerId: string,
    patch: WorkflowRunUpdate,
  ): Promise<boolean>;
  /** Release only an exactly owned claim and restore its still-current row. */
  releaseTimedWaitClaim?(runId: string, nodeId: string, claimId: string): Promise<boolean>;

  publishEvent?(
    eventName: string,
    payload: unknown,
    options?: { runId?: string; workflowId?: string },
  ): Promise<void>;
  subscribeEvents?(runId: string): AsyncIterable<{
    eventName: string;
    payload: unknown;
    timestamp: Date;
  }>;

  initialize?(): Promise<void>;
  healthCheck?(): Promise<boolean>;
  destroy(): Promise<void>;
}

export interface WorkflowRunCursor {
  readonly createdAt: Date;
  readonly runId: string;
}

export interface WorkflowRunCursorFilter {
  readonly status: WorkflowStatus;
  readonly limit: number;
  readonly cursor?: WorkflowRunCursor;
}

/** Bounded request for backend-atomic timed-wait deadline claims. */
export interface TimedWaitClaimRequest {
  /** Stable identity of the recovery service instance acquiring the lease. */
  readonly ownerId: string;
  /** Canonical deadline comparison captured once by the workflow host. */
  readonly now: number;
  /** Maximum number of claims returned by this operation. */
  readonly limit: number;
  /** Duration of each claim lease in milliseconds. */
  readonly leaseDuration: number;
  /** Claim one independently bounded deadline class. */
  readonly waitKind: "delay" | "event";
}

/** One deadline row leased under an opaque, monotonically fenced claim. */
export interface TimedWaitClaim {
  readonly run: WorkflowRun;
  readonly nodeId: string;
  readonly deadline: number;
  readonly claimId: string;
  readonly leaseExpiresAt: Date;
  readonly waitKind: "delay" | "event";
}

/** Apply a run update through the backend's atomic status/ownership compare-and-set. */
export async function updateRunIfStatus(
  backend: WorkflowBackend,
  runId: string,
  expectedStatuses: WorkflowStatus[],
  patch: WorkflowRunUpdate,
  expectedWorkerId?: string,
  expectedLockId?: string,
): Promise<boolean> {
  if (expectedWorkerId !== undefined) assertWorkflowWorkerId(expectedWorkerId);
  if (expectedLockId !== undefined) {
    assertWorkflowLockId(expectedLockId);
    if (!backend.updateRunIfStatusAndLock) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow backend cannot atomically fence run updates by lock ownership",
      });
    }
    const updated = await backend.updateRunIfStatusAndLock(
      runId,
      expectedStatuses,
      expectedLockId,
      patch,
      expectedWorkerId,
    );
    if (typeof updated !== "boolean") {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow backend returned a non-boolean lock-fenced update result",
      });
    }
    return updated;
  }

  if (expectedWorkerId !== undefined) {
    // Worker ownership must be part of the same atomic comparison as status.
    // Older third-party backends cannot provide that guarantee, so fail closed.
    if (!backend.updateRunIfStatusAndWorker) return false;
    const updated = await backend.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
    if (typeof updated !== "boolean") {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow backend returned a non-boolean owner-fenced update result",
      });
    }
    return updated;
  }

  const updated = await backend.updateRunIfStatus(runId, expectedStatuses, patch);
  if (typeof updated !== "boolean") {
    throw ORCHESTRATION_ERROR.create({
      detail: "Workflow backend returned a non-boolean status update result",
    });
  }
  return updated;
}

type WithQueueSupport =
  & WorkflowBackend
  & Required<Pick<WorkflowBackend, "enqueue" | "dequeue" | "acknowledge">>;

type WithLockSupport =
  & WorkflowBackend
  & Required<
    Pick<
      WorkflowBackend,
      "acquireLock" | "extendLock" | "releaseLock" | "updateRunIfStatusAndLock"
    >
  >;

type WithEventSupport =
  & WorkflowBackend
  & Required<Pick<WorkflowBackend, "publishEvent" | "subscribeEvents">>;

export function hasQueueSupport(backend: WorkflowBackend): backend is WithQueueSupport {
  return (
    typeof backend.enqueue === "function" &&
    typeof backend.dequeue === "function" &&
    typeof backend.acknowledge === "function"
  );
}

export function hasLockSupport(backend: WorkflowBackend): backend is WithLockSupport {
  return (
    typeof backend.acquireLock === "function" &&
    typeof backend.extendLock === "function" &&
    typeof backend.releaseLock === "function" &&
    typeof backend.updateRunIfStatusAndLock === "function"
  );
}

export function hasEventSupport(backend: WorkflowBackend): backend is WithEventSupport {
  return (
    typeof backend.publishEvent === "function" &&
    typeof backend.subscribeEvents === "function"
  );
}

type WithWorkerSupport =
  & WorkflowBackend
  & Required<
    Pick<
      WorkflowBackend,
      | "enqueue"
      | "dequeue"
      | "acknowledge"
      | "acquireLock"
      | "extendLock"
      | "releaseLock"
      | "updateRunIfStatusAndLock"
      | "findStalledRuns"
      | "claimStalledRun"
      | "updateRunIfStatusAndWorker"
      | "saveCheckpointIfStatusAndWorker"
      | "savePendingApprovalIfStatusAndWorker"
      | "claimDueTimedWaits"
      | "updateRunIfTimedWaitClaim"
      | "releaseTimedWaitClaim"
    >
  >;

/** Check whether worker support is present. */
export function hasWorkerSupport(backend: WorkflowBackend): backend is WithWorkerSupport {
  return (
    hasQueueSupport(backend) &&
    hasLockSupport(backend) &&
    typeof backend.findStalledRuns === "function" &&
    typeof backend.claimStalledRun === "function" &&
    typeof backend.updateRunIfStatusAndWorker === "function" &&
    typeof backend.saveCheckpointIfStatusAndWorker === "function" &&
    typeof backend.savePendingApprovalIfStatusAndWorker === "function" &&
    hasTimedWaitRecoverySupport(backend)
  );
}

type WithTimedWaitRecoverySupport =
  & WorkflowBackend
  & Required<
    Pick<
      WorkflowBackend,
      "claimDueTimedWaits" | "updateRunIfTimedWaitClaim" | "releaseTimedWaitClaim"
    >
  >;

/** Check whether the backend provides atomic indexed timed-wait recovery. */
export function hasTimedWaitRecoverySupport(
  backend: WorkflowBackend,
): backend is WithTimedWaitRecoverySupport {
  return typeof backend.claimDueTimedWaits === "function" &&
    typeof backend.updateRunIfTimedWaitClaim === "function" &&
    typeof backend.releaseTimedWaitClaim === "function";
}
