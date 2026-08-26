import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  PendingEventWait,
  RunFilter,
  WorkflowQueueItem,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { compareStrings } from "#veryfront/utils/compare.ts";

/** Run state that may change after the immutable run snapshot is created. */
type WorkflowRunScalarUpdate = Partial<
  Pick<
    WorkflowRun,
    | "status"
    | "output"
    | "currentNodes"
    | "error"
    | "startedAt"
    | "heartbeatAt"
    | "completedAt"
    | "workerId"
    | "_traceContext"
  >
>;

/**
 * Mutable run fields. On backends that declare `supportsRunPatchKeyMerge`,
 * context and node-state entries merge by key atomically, so concurrent node
 * outcomes cannot replace a sibling's persisted entry. Backends without that
 * declaration replace the maps wholesale (the historical contract), so
 * callers must send complete maps unless merge support was verified through
 * `hasRunPatchKeyMergeSupport`.
 */
export type WorkflowRunUpdate = WorkflowRunScalarUpdate & {
  nodeStates?: WorkflowRun["nodeStates"];
  /** Top-level node-state keys removed by this patch. */
  nodeStateDeletes?: string[];
  context?: Partial<WorkflowRun["context"]>;
  /** Top-level context keys removed by this patch. */
  contextDeletes?: string[];
};

/**
 * A complete restore of a run's mutable state, as opposed to a patch. Both
 * maps are required in full: a snapshot restore is defined by the keys it
 * does NOT contain as much as by the ones it does.
 */
export type WorkflowRunStateSnapshot = WorkflowRunScalarUpdate & {
  nodeStates: WorkflowRun["nodeStates"];
  context: WorkflowRun["context"];
};

const WORKFLOW_RUN_UPDATE_FIELDS = new Set<keyof WorkflowRunUpdate>([
  "status",
  "output",
  "nodeStates",
  "nodeStateDeletes",
  "currentNodes",
  "context",
  "contextDeletes",
  "error",
  "startedAt",
  "heartbeatAt",
  "completedAt",
  "workerId",
  "_traceContext",
]);

/** Reject untyped callers that attempt to rewrite immutable run state. */
export function assertWorkflowRunUpdate(patch: WorkflowRunUpdate): void {
  const immutableFields = Object.keys(patch).filter((field) =>
    !WORKFLOW_RUN_UPDATE_FIELDS.has(field as keyof WorkflowRunUpdate)
  );
  if (immutableFields.length > 0) {
    throw INVALID_ARGUMENT.create({
      detail: `Workflow run fields are immutable after creation: ${
        immutableFields.toSorted(compareStrings).join(", ")
      }`,
    });
  }
}

/** Configuration used by backend. */
export interface BackendConfig {
  url?: string;
  prefix?: string;
  /**
   * @deprecated No-op retained for source compatibility.
   *
   * Backends ignore this field. Use backend-specific TTL options, such as
   * `RedisBackendConfig.runTtl`, when retention behavior is required.
   */
  defaultTtl?: number;
  debug?: boolean;
}

export interface Lock {
  lockId: string;
  runId: string;
  acquiredAt: Date;
  expiresAt: Date;
}

/** Minimal persisted run state used to derive public workflow events. */
export interface WorkflowRunObservedState {
  revision: number;
  status: WorkflowStatus;
  nodes: Record<
    string,
    { status: WorkflowRun["nodeStates"][string]["status"]; attempt: number; error?: string }
  >;
  runError?: string;
  /**
   * Pending approvals reduced to identifiers and the request message. Present
   * when the producing mutation touched approvals; absent means unchanged
   * since the previous observed state, never that approvals were revoked.
   * Approval payloads never appear here.
   */
  approvals?: Array<{ id: string; nodeId: string; message?: string }>;
}

/** Atomic initial snapshot and ordered changes for one workflow run. */
export interface WorkflowRunObservation {
  initial: WorkflowRun;
  changes: AsyncIterable<WorkflowRunObservedState>;
  close(): Promise<void>;
}

/** Approval record persisted by workflow backends, including internal restart metadata. */
export interface PersistedPendingApproval extends PendingApproval {
  responseSchemaId?: string;
}

/** Event-wait record persisted by workflow backends, including worker ownership. */
export interface PersistedPendingEventWait extends PendingEventWait {
  /** Worker that owned the run when the wait was appended. */
  workerId?: string;
  /** Time a delivered or expired claim left the pending set. */
  claimedAt?: Date;
}

/** One event durably buffered in a run's mailbox until a wait consumes it. */
export interface RunEventEnvelope {
  /**
   * Identity of this one publish. Outcomes are attributed per envelope: with
   * concurrent publishes a drain can consume an envelope another caller
   * appended, and without identity that caller would report the wrong result.
   */
  id: string;
  eventName: string;
  payload: unknown;
  publishedAt: Date;
}

/** Recoverable record retained while an event delivery has not committed. */
export interface RunEventDeliveryClaim {
  wait: PersistedPendingEventWait;
  event: RunEventEnvelope;
  claimedAt: Date;
}

/** Public API contract for workflow backend. */
export interface WorkflowBackend {
  /**
   * Declared true by backends whose `updateRun` family applies `context` and
   * `nodeStates` patches as an atomic per-key merge. Absent or false means
   * those maps are replaced wholesale, and the runtime sends complete maps
   * instead of single-entry patches. A backend declaring this must also
   * implement `restoreRunStateIfStatus`, because a per-key merge cannot
   * express a checkpoint restore.
   */
  readonly supportsRunPatchKeyMerge?: boolean;
  createRun(run: WorkflowRun): Promise<void>;
  /** Read a run with its current pending approvals hydrated. */
  getRun(runId: string): Promise<WorkflowRun | null>;
  /**
   * Apply a run patch. Context and node-state maps merge by key only on
   * backends declaring `supportsRunPatchKeyMerge`; elsewhere they replace.
   */
  updateRun(runId: string, patch: WorkflowRunUpdate): Promise<void>;
  /** Apply a run patch only when its current status matches one of the expected statuses. */
  updateRunIfStatus?(
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
   * Replace the run's context and node-state maps with a snapshot, only while
   * its status (and worker owner, when given) matches.
   *
   * This is the checkpoint-restore path, and it is replacement on purpose:
   * keys written after the snapshot was taken must not survive the restore,
   * or a node completed after the checkpoint stays marked completed and is
   * skipped on replay while stale context values outlive the rollback. The
   * `updateRun` family cannot express that on a key-merging backend, so any
   * backend declaring `supportsRunPatchKeyMerge` must implement this too.
   */
  restoreRunStateIfStatus?(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    snapshot: WorkflowRunStateSnapshot,
    expectedWorkerId?: string,
  ): Promise<boolean>;
  deleteRun?(runId: string): Promise<void>;
  listRuns(filter: RunFilter): Promise<WorkflowRun[]>;
  countRuns?(filter: RunFilter): Promise<number>;

  saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void>;
  /** Append a checkpoint only while the canonical run status and worker owner match. */
  saveCheckpointIfStatusAndWorker?(
    storageRunId: string,
    ownershipRunId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    checkpoint: Checkpoint,
  ): Promise<boolean>;
  getLatestCheckpoint(runId: string): Promise<Checkpoint | null>;
  /** Return checkpoint history in append order, oldest first. */
  getCheckpoints?(runId: string): Promise<Checkpoint[]>;
  /** Delete the oldest append-ordered occurrence of a checkpoint ID. */
  deleteCheckpoint?(runId: string, checkpointId: string): Promise<void>;
  /** Delete one oldest append-ordered occurrence for each supplied checkpoint ID. */
  deleteCheckpoints?(runId: string, checkpointIds: string[]): Promise<void>;

  /**
   * Append an approval unless this run already has a pending approval for the
   * same node. The duplicate check and append must be one atomic operation.
   */
  savePendingApproval(runId: string, approval: PersistedPendingApproval): Promise<void>;
  /**
   * Append an approval only while the run status and worker owner match and no
   * pending approval already exists for the same node. Returns false after
   * losing either precondition.
   */
  savePendingApprovalIfStatusAndWorker?(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    approval: PersistedPendingApproval,
  ): Promise<boolean>;
  /** Patch metadata on an existing pending approval. */
  updatePendingApproval?(
    runId: string,
    approvalId: string,
    patch: Partial<PersistedPendingApproval>,
  ): Promise<void>;
  getPendingApprovals(runId: string): Promise<PersistedPendingApproval[]>;
  getPendingApproval?(
    runId: string,
    approvalId: string,
  ): Promise<PersistedPendingApproval | null>;
  /**
   * Apply an approval decision atomically, but only while the approval is still
   * pending. Atomic backends resolve `true` when the decision was written and
   * `false` after losing a concurrent decision race. Legacy custom backends may
   * continue to resolve without a value.
   */
  updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<boolean | void>;
  listPendingApprovals?(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PersistedPendingApproval }>>;

  enqueue?(job: WorkflowQueueItem): Promise<void>;
  dequeue?(): Promise<WorkflowQueueItem | null>;
  acknowledge?(runId: string): Promise<void>;
  nack?(runId: string): Promise<void>;

  /** Acquire a lock, returning the owned lockId token on success or null on failure. */
  acquireLock?(runId: string, duration: number): Promise<string | null>;
  /** Release a lock. When lockId is provided, only release if it matches the owned token. */
  releaseLock?(runId: string, lockId?: string): Promise<void>;
  /** Extend a lock only when lockId matches the owned token. */
  extendLock?(runId: string, duration: number, lockId?: string): Promise<boolean>;
  isLocked?(runId: string): Promise<boolean>;

  /** Find runs that appear stalled (no heartbeat within threshold ms) */
  findStalledRuns?(stalledThreshold: number): Promise<WorkflowRun[]>;
  /** Attempt to claim a stalled run for this worker (atomic compare-and-swap) */
  claimStalledRun?(runId: string, workerId: string, stalledThreshold: number): Promise<boolean>;

  /**
   * Append a record of a run parked on `waitForEvent` or `delay`.
   *
   * A backend that implements this group of methods can wake a parked run from
   * any process: the record names what the run is waiting for, and the mailbox
   * below holds the event until a wait claims it. A backend that implements
   * none of them cannot, and `hasEventWaitSupport` reports that honestly rather
   * than letting a run park on nothing.
   *
   * Append an event wait unless this run already has a pending wait for the
   * same node. The duplicate check and append must be one atomic operation.
   */
  savePendingEventWait?(runId: string, wait: PersistedPendingEventWait): Promise<void>;
  /**
   * Append an event wait only while the run status and worker owner match and
   * no pending event wait already exists for the same node. Returns false
   * after losing either precondition.
   */
  savePendingEventWaitIfStatusAndWorker?(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    wait: PersistedPendingEventWait,
  ): Promise<boolean>;
  getPendingEventWaits?(runId: string): Promise<PersistedPendingEventWait[]>;
  /** Enumerate every still-pending wait, for expiry reconciliation across runs. */
  listPendingEventWaits?(): Promise<
    Array<{ runId: string; wait: PersistedPendingEventWait }>
  >;
  /**
   * Resolve a wait atomically, but only while it is still pending. Exactly one
   * caller wins: delivery, expiry, and cancellation race for the same record,
   * and only one of them may act on it.
   */
  resolvePendingEventWait?(
    runId: string,
    waitId: string,
    status: "delivered" | "expired" | "cancelled",
  ): Promise<boolean>;
  /**
   * Return a claimed wait to pending, after acting on the claim failed.
   *
   * Claiming a wait is what stops delivery and expiry acting on the same
   * record, so it has to happen before the run is touched. When the touch then
   * fails, the claim must be given back or the run is parked on a record that
   * says it was already resolved and nothing will ever wake it. A `delivered`
   * claim is reopened when the node completion failed; an `expired` claim is
   * reopened when failing the run did not commit, so the deadline stays
   * replayable until it does. A `cancelled` record is never reopened: its run
   * is terminal.
   */
  restorePendingEventWait?(runId: string, waitId: string): Promise<boolean>;
  /**
   * Enumerate timeout claims whose run transition may not have committed.
   *
   * A delivered delay and an expired event wait remain recoverable until the
   * delay node completes or the event timeout fails its run. A replacement
   * process uses this list to restore claims left between those two durable
   * mutations.
   */
  listTimedEventWaitClaims?(runId?: string): Promise<PersistedPendingEventWait[]>;
  /** Release a timeout claim after its matching run transition commits. */
  finalizeTimedEventWaitClaim?(runId: string, waitId: string): Promise<void>;

  /**
   * Buffer one event in a run's durable mailbox.
   *
   * Buffering rather than broadcasting is what makes delivery independent of
   * timing: an event published before its node parks, or while no process holds
   * the run, waits in the mailbox instead of being dropped.
   */
  appendRunEvent?(runId: string, event: RunEventEnvelope): Promise<void>;
  /** Remove one exact buffered envelope without touching same-name mail. */
  removeRunEvent?(runId: string, eventId: string): Promise<boolean>;
  /** Read the oldest matching envelope without claiming or removing it. */
  peekRunEvent?(runId: string, eventName: string): Promise<RunEventEnvelope | null>;
  /**
   * Atomically remove and return the oldest buffered event with this name, or
   * null when the mailbox holds none. Removing and returning must be one step
   * so two waits cannot consume the same event.
   */
  takeRunEvent?(runId: string, eventName: string): Promise<RunEventEnvelope | null>;
  /**
   * Atomically claim the oldest buffered event with this name for one pending
   * wait: remove the event AND mark the wait `delivered` as a single step,
   * returning the claimed envelope, or null (changing nothing) when the wait
   * is no longer pending or no event with that name is buffered.
   *
   * This compound operation exists because performing it as separate take and
   * resolve calls opens a crash window in which the event has left the mailbox
   * while the wait is still pending, losing the event forever. A durable
   * backend must implement it as one atomic operation (a transaction or
   * script), never as a take followed by a resolve, and retain the wait plus
   * envelope as a `RunEventDeliveryClaim` until rollback or finalization.
   */
  claimRunEventForWait?(
    runId: string,
    waitId: string,
    eventName: string,
    publishedBefore?: Date,
  ): Promise<RunEventEnvelope | null>;
  /**
   * Enumerate recoverable in-flight delivery claims, optionally for one run.
   * Claims remain here until either rollback or finalization commits, so a
   * replacement process can recover a publisher that exited after claiming.
   */
  listRunEventDeliveryClaims?(runId?: string): Promise<RunEventDeliveryClaim[]>;
  /**
   * Return a claimed event to the mailbox after its delivery failed, at the
   * head of the mailbox rather than the tail.
   *
   * The claimed event was the oldest with its name, and waits consume matching
   * events oldest-first; re-appending it at the tail would let an event
   * published later be delivered before it after a transient failure. The
   * restore must succeed even when the mailbox is at its bound: the event
   * already held a place there when it was claimed.
   */
  restoreRunEvent?(runId: string, event: RunEventEnvelope): Promise<void>;
  /**
   * Undo a claimed-but-undelivered event delivery as one atomic step: return
   * the wait to pending (as `restorePendingEventWait` would) AND the claimed
   * event to the head of its mailbox (as `restoreRunEvent` would).
   *
   * This compound operation exists because rolling the two halves back with
   * separate calls opens a crash window in which the wait is pending again
   * while its event has already left the mailbox forever: an untimed wait has
   * no deadline the sweep could recover it through, so the accepted event is
   * simply lost unless the publisher happens to retry. A durable backend must
   * implement it as one atomic operation (a transaction or script), never as
   * a restore followed by a restore.
   *
   * Resolves with whether the wait record was returned to pending. The event
   * is restored either way: it held its mailbox place before the claim, and a
   * wait resolved by another actor in the meantime does not change that.
   */
  restoreRunEventDelivery?(
    runId: string,
    waitId: string,
    event: RunEventEnvelope,
  ): Promise<boolean>;
  /**
   * Release any capacity reservation retained for a successfully delivered
   * event. This is the commit-side counterpart to `restoreRunEventDelivery`:
   * once delivery cannot roll back, an empty mailbox must no longer count
   * against the backend's mailbox bound.
   */
  finalizeRunEventDelivery?(runId: string, eventId: string): Promise<void>;

  /**
   * @deprecated Never implemented by any built-in backend and never called by
   * the framework; superseded by the durable event-wait method group above
   * (`appendRunEvent`/`claimRunEventForWait` and the pending-wait records).
   * Retained as an optional declaration so third-party backends that declared
   * it keep typechecking.
   */
  publishEvent?(
    eventName: string,
    payload: unknown,
    options?: { runId?: string; workflowId?: string },
  ): Promise<void>;
  /**
   * @deprecated Never implemented by any built-in backend and never called by
   * the framework; superseded by the durable event-wait method group above.
   * Retained as an optional declaration so third-party backends that declared
   * it keep typechecking.
   */
  subscribeEvents?(runId: string): AsyncIterable<{
    eventName: string;
    payload: unknown;
    timestamp: Date;
  }>;

  /** Open an atomic observation of a run when this backend supports it. */
  openRunObservation?(
    runId: string,
    options?: { signal?: AbortSignal },
  ): Promise<WorkflowRunObservation | null>;

  initialize?(): Promise<void>;
  healthCheck?(): Promise<boolean>;
  destroy(): Promise<void>;
}

/** Apply a run update only while its status is one of the expected values. */
export async function updateRunIfStatus(
  backend: WorkflowBackend,
  runId: string,
  expectedStatuses: WorkflowStatus[],
  patch: WorkflowRunUpdate,
  expectedWorkerId?: string,
): Promise<boolean> {
  if (expectedWorkerId !== undefined) {
    // Worker ownership must be part of the same atomic comparison as status.
    // Older third-party backends cannot provide that guarantee, so fail closed.
    if (!backend.updateRunIfStatusAndWorker) return false;
    return await backend.updateRunIfStatusAndWorker(
      runId,
      expectedStatuses,
      expectedWorkerId,
      patch,
    );
  }

  if (backend.updateRunIfStatus) {
    return await backend.updateRunIfStatus(runId, expectedStatuses, patch);
  }

  // Compatibility fallback for third-party backends that predate conditional
  // updates. Built-in backends implement the atomic method above.
  const current = await backend.getRun(runId);
  if (!current || !expectedStatuses.includes(current.status)) return false;
  await backend.updateRun(runId, patch);
  return true;
}

/**
 * Check whether `updateRun` patches merge context and node-state maps by key.
 *
 * Only a backend that declares this may be sent single-entry patches; every
 * other backend replaces those maps wholesale, so a one-entry patch would
 * silently erase every other node's persisted outcome.
 */
export function hasRunPatchKeyMergeSupport(backend: WorkflowBackend): boolean {
  return backend.supportsRunPatchKeyMerge === true;
}

/**
 * Replace a run's context and node-state maps with a snapshot, only while its
 * status (and worker owner, when given) matches.
 *
 * A key-merging backend must provide the dedicated replacement operation: its
 * merge would retain keys written after the snapshot, letting nodes completed
 * after the checkpoint be skipped on replay. A backend without merge support
 * already replaces these maps on a plain conditional update, so the snapshot
 * goes through that path unchanged.
 */
export async function restoreRunStateIfStatus(
  backend: WorkflowBackend,
  runId: string,
  expectedStatuses: WorkflowStatus[],
  snapshot: WorkflowRunStateSnapshot,
  expectedWorkerId?: string,
): Promise<boolean> {
  if (backend.restoreRunStateIfStatus) {
    return await backend.restoreRunStateIfStatus(
      runId,
      expectedStatuses,
      snapshot,
      expectedWorkerId,
    );
  }
  if (hasRunPatchKeyMergeSupport(backend)) {
    // Falling back to the merging update would silently corrupt the restore,
    // so refuse loudly instead: the backend declared a capability contract it
    // did not finish implementing.
    throw INVALID_ARGUMENT.create({
      detail: "Backend declares supportsRunPatchKeyMerge but does not implement " +
        "restoreRunStateIfStatus, so a checkpoint snapshot cannot be restored safely",
    });
  }
  return await updateRunIfStatus(backend, runId, expectedStatuses, snapshot, expectedWorkerId);
}

type WithQueueSupport =
  & WorkflowBackend
  & Required<Pick<WorkflowBackend, "enqueue" | "dequeue" | "acknowledge">>;

type WithLockSupport =
  & WorkflowBackend
  & Required<Pick<WorkflowBackend, "acquireLock" | "releaseLock">>;

type WithRunObservationSupport =
  & WorkflowBackend
  & Required<Pick<WorkflowBackend, "openRunObservation">>;

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
    typeof backend.releaseLock === "function"
  );
}

/** Check whether atomic run observation is available. */
export function hasRunObservationSupport(
  backend: WorkflowBackend,
): backend is WithRunObservationSupport {
  return typeof backend.openRunObservation === "function";
}

type WithEventWaitSupport =
  & WorkflowBackend
  & Required<
    Pick<
      WorkflowBackend,
      | "savePendingEventWait"
      | "getPendingEventWaits"
      | "listPendingEventWaits"
      | "resolvePendingEventWait"
      | "restorePendingEventWait"
      | "listTimedEventWaitClaims"
      | "finalizeTimedEventWaitClaim"
      | "appendRunEvent"
      | "removeRunEvent"
      | "peekRunEvent"
      | "takeRunEvent"
      | "claimRunEventForWait"
      | "listRunEventDeliveryClaims"
      | "restoreRunEvent"
      | "restoreRunEventDelivery"
      | "finalizeRunEventDelivery"
    >
  >;

/**
 * Check whether durable event waits are available.
 *
 * The whole group is required, not any single method: a backend that could
 * record a wait but not buffer an event, or buffer an event but not resolve a
 * wait, would park runs that nothing can ever wake. `restorePendingEventWait`,
 * `restoreRunEvent`, `restoreRunEventDelivery`, `finalizeRunEventDelivery`,
 * recoverable delivery claims, and recoverable timeout claims are part of the
 * group for the same reason: without them a delivery that fails halfway leaves
 * the run parked on a wait already marked delivered, re-orders its mailbox,
 * loses the event outright when a crash lands between the two separate
 * restores, or scans an already-committed timeout claim forever.
 *
 * A backend that also supports worker execution ownership must implement
 * `savePendingEventWaitIfStatusAndWorker` as well. The executor assigns every
 * run a worker owner on such a backend, and persisting a wait for an owned run
 * requires the owner-fenced append; without it every wait creation would throw
 * after this guard reported support.
 */
export function hasEventWaitSupport(backend: WorkflowBackend): backend is WithEventWaitSupport {
  return (
    typeof backend.savePendingEventWait === "function" &&
    typeof backend.getPendingEventWaits === "function" &&
    typeof backend.listPendingEventWaits === "function" &&
    typeof backend.resolvePendingEventWait === "function" &&
    typeof backend.restorePendingEventWait === "function" &&
    typeof backend.listTimedEventWaitClaims === "function" &&
    typeof backend.finalizeTimedEventWaitClaim === "function" &&
    typeof backend.appendRunEvent === "function" &&
    typeof backend.removeRunEvent === "function" &&
    typeof backend.peekRunEvent === "function" &&
    typeof backend.takeRunEvent === "function" &&
    typeof backend.claimRunEventForWait === "function" &&
    typeof backend.listRunEventDeliveryClaims === "function" &&
    typeof backend.restoreRunEvent === "function" &&
    typeof backend.restoreRunEventDelivery === "function" &&
    typeof backend.finalizeRunEventDelivery === "function" &&
    (!hasWorkerSupport(backend) ||
      typeof backend.savePendingEventWaitIfStatusAndWorker === "function")
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
      | "releaseLock"
      | "findStalledRuns"
      | "claimStalledRun"
      | "updateRunIfStatusAndWorker"
      | "saveCheckpointIfStatusAndWorker"
      | "savePendingApprovalIfStatusAndWorker"
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
    typeof backend.savePendingApprovalIfStatusAndWorker === "function"
  );
}
