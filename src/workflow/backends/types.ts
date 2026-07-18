import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowQueueItem,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";

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

/** Public API contract for workflow backend. */
export interface WorkflowBackend {
  createRun(run: WorkflowRun): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | null>;
  updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void>;
  /** Apply a run patch only when its current status matches one of the expected statuses. */
  updateRunIfStatus?(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean>;
  /** Apply a run patch only while both status and worker ownership match. */
  updateRunIfStatusAndWorker?(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
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
  getCheckpoints?(runId: string): Promise<Checkpoint[]>;
  deleteCheckpoint?(runId: string, checkpointId: string): Promise<void>;
  deleteCheckpoints?(runId: string, checkpointIds: string[]): Promise<void>;

  savePendingApproval(runId: string, approval: PendingApproval): Promise<void>;
  /** Append an approval only while the run status and worker owner match. */
  savePendingApprovalIfStatusAndWorker?(
    runId: string,
    expectedStatuses: WorkflowStatus[],
    expectedWorkerId: string,
    approval: PendingApproval,
  ): Promise<boolean>;
  /** Patch metadata on an existing pending approval. */
  updatePendingApproval?(
    runId: string,
    approvalId: string,
    patch: Partial<PendingApproval>,
  ): Promise<void>;
  getPendingApprovals(runId: string): Promise<PendingApproval[]>;
  getPendingApproval?(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null>;
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
  }): Promise<Array<{ runId: string; approval: PendingApproval }>>;

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

/** Apply a run update only while its status is one of the expected values. */
export async function updateRunIfStatus(
  backend: WorkflowBackend,
  runId: string,
  expectedStatuses: WorkflowStatus[],
  patch: Partial<WorkflowRun>,
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

type WithQueueSupport =
  & WorkflowBackend
  & Required<Pick<WorkflowBackend, "enqueue" | "dequeue" | "acknowledge">>;

type WithLockSupport =
  & WorkflowBackend
  & Required<Pick<WorkflowBackend, "acquireLock" | "releaseLock">>;

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
    typeof backend.releaseLock === "function"
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
      | "releaseLock"
      | "findStalledRuns"
      | "claimStalledRun"
    >
  >;

/** Check whether worker support is present. */
export function hasWorkerSupport(backend: WorkflowBackend): backend is WithWorkerSupport {
  return (
    hasQueueSupport(backend) &&
    hasLockSupport(backend) &&
    typeof backend.findStalledRuns === "function" &&
    typeof backend.claimStalledRun === "function"
  );
}
