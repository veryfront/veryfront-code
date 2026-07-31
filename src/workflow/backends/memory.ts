/****
 * Memory Workflow Backend
 *
 * In-memory implementation of WorkflowBackend for development and testing.
 * Data is NOT persisted across restarts.
 */

import { logger as baseLogger } from "#veryfront/utils";
import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowQueueItem,
  WorkflowRun,
} from "../types.ts";
import {
  type ApprovalDecisionTiming,
  assertWorkflowLockId,
  assertWorkflowRunUpdate,
  assertWorkflowWorkerId,
  type BackendConfig,
  captureApprovalDecisionTiming,
  capturePendingApprovalMetadataUpdate,
  type PendingApprovalMetadataUpdate,
  type WorkflowBackend,
  type WorkflowRunCursorFilter,
  type WorkflowRunUpdate,
} from "./types.ts";
import { requeueRun } from "./shared/requeue-run.ts";
import {
  INVALID_ARGUMENT,
  ORCHESTRATION_ERROR,
  RESOURCE_NOT_FOUND,
  WORKFLOW_RUN_CONFLICT,
} from "#veryfront/errors";
import { requireWorkflowSourceIntegrationPolicy } from "../source-integration-policy.ts";
import {
  compareRunIdsDescending,
  resolveRunDateBounds,
  resolveRunListPage,
  resolveWorkflowRunCursorPage,
} from "./run-filter.ts";

const logger = baseLogger.component("memory-backend");

/**
 * Memory backend configuration
 */
interface MemoryBackendConfig extends BackendConfig {
  /** Maximum queue size (default: 10000) */
  maxQueueSize?: number;
}

/** Default max queue size */
const DEFAULT_MAX_QUEUE_SIZE = 10_000;

/** Implement memory backend. */
export class MemoryBackend implements WorkflowBackend {
  private runs = new Map<string, WorkflowRun>();
  private checkpoints = new Map<string, Checkpoint[]>();
  private approvals = new Map<string, PendingApproval[]>();
  private queue: WorkflowQueueItem[] = [];
  private locks = new Map<string, { lockId: string; expiresAt: number }>();
  private stalledClaims = new Map<string, { workerId: string; expiresAt: number }>();
  private config: MemoryBackendConfig;

  constructor(config: MemoryBackendConfig = {}) {
    this.config = {
      prefix: "wf:",
      debug: false,
      maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
      ...config,
    };
  }

  // =========================================================================
  // Run Management
  // =========================================================================

  createRun(run: WorkflowRun): Promise<void> {
    logger.debug(`Creating run: ${run.id}`);
    let sourceIntegrationPolicy;
    try {
      sourceIntegrationPolicy = requireWorkflowSourceIntegrationPolicy(run);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.runs.has(run.id)) {
      return Promise.reject(
        WORKFLOW_RUN_CONFLICT.create({ detail: `Workflow run already exists: ${run.id}` }),
      );
    }
    this.runs.set(
      run.id,
      structuredClone({ ...run, pendingApprovals: [], sourceIntegrationPolicy }),
    );
    return Promise.resolve();
  }

  getRun(runId: string): Promise<WorkflowRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? this.snapshotRun(run) : null);
  }

  updateRun(runId: string, patch: WorkflowRunUpdate): Promise<void> {
    const run = this.runs.get(runId);
    // Reject rather than throw synchronously so callers see a rejected Promise
    // consistently with extension-backed implementations' async error paths.
    if (!run) {
      return Promise.reject(RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` }));
    }

    try {
      this.applyRunUpdate(runId, run, patch);
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error);
    }
  }

  updateRunIfStatus(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (!run) {
      return Promise.reject(RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` }));
    }
    if (!expectedStatuses.includes(run.status)) return Promise.resolve(false);

    try {
      this.applyRunUpdate(runId, run, patch);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  updateRunIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    patch: Partial<WorkflowRun>,
  ): Promise<boolean> {
    try {
      assertWorkflowWorkerId(expectedWorkerId);
    } catch (error) {
      return Promise.reject(error);
    }
    const run = this.runs.get(runId);
    if (!run) {
      return Promise.reject(RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` }));
    }
    if (!expectedStatuses.includes(run.status) || run.workerId !== expectedWorkerId) {
      return Promise.resolve(false);
    }

    try {
      this.applyRunUpdate(runId, run, patch);
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  updateRunIfStatusAndLock(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    lockId: string,
    patch: WorkflowRunUpdate,
    expectedWorkerId?: string,
  ): Promise<boolean> {
    try {
      assertWorkflowLockId(lockId);
      if (expectedWorkerId !== undefined) assertWorkflowWorkerId(expectedWorkerId);
    } catch (error) {
      return Promise.reject(error);
    }
    const run = this.runs.get(runId);
    if (!run) {
      return Promise.reject(RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` }));
    }

    const lock = this.locks.get(runId);
    if (!lock || lock.lockId !== lockId || lock.expiresAt <= Date.now()) {
      if (lock?.lockId === lockId && lock.expiresAt <= Date.now()) this.locks.delete(runId);
      return Promise.resolve(false);
    }
    if (
      !expectedStatuses.includes(run.status) ||
      (expectedWorkerId !== undefined && run.workerId !== expectedWorkerId)
    ) {
      return Promise.resolve(false);
    }

    try {
      this.applyRunUpdate(runId, run, patch);
      if (patch.status !== undefined && patch.status !== "running") {
        this.locks.delete(runId);
      }
      return Promise.resolve(true);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private applyRunUpdate(
    runId: string,
    run: WorkflowRun,
    patch: WorkflowRunUpdate,
  ): void {
    assertWorkflowRunUpdate(patch);
    logger.debug(`Updating run: ${runId}`, patch);

    const clonedPatch = structuredClone(patch);
    this.runs.set(runId, {
      ...run,
      ...clonedPatch,
      nodeStates: clonedPatch.nodeStates ?? run.nodeStates,
      context: clonedPatch.context ?? run.context,
    });

    if (patch.status && patch.status !== "running") {
      this.stalledClaims.delete(runId);
    }
  }

  deleteRun(runId: string): Promise<void> {
    this.runs.delete(runId);
    this.checkpoints.delete(runId);
    this.approvals.delete(runId);
    this.stalledClaims.delete(runId);
    return Promise.resolve();
  }

  async listRuns(filter: RunFilter): Promise<WorkflowRun[]> {
    const { limit, offset } = resolveRunListPage(filter);
    const { createdAfterMs, createdBeforeMs } = resolveRunDateBounds(filter);
    let runs = Array.from(this.runs.values());

    if (filter.workflowId) {
      runs = runs.filter((r) => r.workflowId === filter.workflowId);
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      runs = runs.filter((r) => statuses.includes(r.status));
    }

    if (createdAfterMs !== undefined) {
      runs = runs.filter((run) => run.createdAt.getTime() >= createdAfterMs);
    }

    if (createdBeforeMs !== undefined) {
      runs = runs.filter((run) => run.createdAt.getTime() <= createdBeforeMs);
    }

    runs.sort((a, b) => {
      const timeOrder = b.createdAt.getTime() - a.createdAt.getTime();
      if (timeOrder !== 0) return timeOrder;
      return compareRunIdsDescending(a.id, b.id);
    });

    runs = runs.slice(offset, offset + limit);

    return runs.map((run) => this.snapshotRun(run));
  }

  async listRunsAfterCursor(filter: WorkflowRunCursorFilter): Promise<WorkflowRun[]> {
    const page = resolveWorkflowRunCursorPage(filter);
    const cursorTime = page.cursor?.createdAtMs;

    const runs = [...this.runs.values()]
      .filter((run) => run.status === filter.status)
      .filter((run) => {
        if (!page.cursor || cursorTime === undefined) return true;
        const createdAt = run.createdAt.getTime();
        return createdAt < cursorTime ||
          (createdAt === cursorTime &&
            compareRunIdsDescending(run.id, page.cursor.runId) > 0);
      })
      .sort((left, right) => {
        const timeOrder = right.createdAt.getTime() - left.createdAt.getTime();
        return timeOrder !== 0 ? timeOrder : compareRunIdsDescending(left.id, right.id);
      })
      .slice(0, page.limit);

    return runs.map((run) => this.snapshotRun(run));
  }

  private snapshotRun(run: WorkflowRun): WorkflowRun {
    const pendingApprovals = run.status === "waiting"
      ? (this.approvals.get(run.id) ?? []).filter(
        (approval) => approval.status === "pending",
      )
      : [];
    return structuredClone({ ...run, pendingApprovals });
  }

  async countRuns(filter: RunFilter): Promise<number> {
    // Count in place — no structuredClone per run (unlike listRuns).
    const { createdAfterMs, createdBeforeMs } = resolveRunDateBounds(filter);
    const statuses = filter.status
      ? Array.isArray(filter.status) ? filter.status : [filter.status]
      : null;

    let count = 0;
    for (const run of this.runs.values()) {
      if (filter.workflowId && run.workflowId !== filter.workflowId) continue;
      if (statuses && !statuses.includes(run.status)) continue;
      if (createdAfterMs !== undefined && run.createdAt.getTime() < createdAfterMs) continue;
      if (createdBeforeMs !== undefined && run.createdAt.getTime() > createdBeforeMs) continue;
      count++;
    }

    return count;
  }

  // =========================================================================
  // Checkpointing
  // =========================================================================

  saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void> {
    if (!this.runs.has(runId)) {
      return Promise.reject(RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` }));
    }
    logger.debug("Saving checkpoint", { checkpointId: checkpoint.id, runId });
    const checkpoints = this.checkpoints.get(runId) ?? [];
    checkpoints.push(structuredClone(checkpoint));
    this.checkpoints.set(runId, checkpoints);
    return Promise.resolve();
  }

  saveCheckpointIfStatusAndWorker(
    storageRunId: string,
    ownershipRunId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    checkpoint: Checkpoint,
  ): Promise<boolean> {
    const run = this.runs.get(ownershipRunId);
    if (
      !run || !expectedStatuses.includes(run.status) || run.workerId !== expectedWorkerId
    ) {
      return Promise.resolve(false);
    }

    const checkpoints = this.checkpoints.get(storageRunId) ?? [];
    checkpoints.push(structuredClone(checkpoint));
    this.checkpoints.set(storageRunId, checkpoints);
    return Promise.resolve(true);
  }

  getLatestCheckpoint(runId: string): Promise<Checkpoint | null> {
    const checkpoints = this.checkpoints.get(runId);
    if (!checkpoints?.length) return Promise.resolve(null);

    const latest = checkpoints[checkpoints.length - 1];
    return Promise.resolve(latest ? structuredClone(latest) : null);
  }

  getCheckpoints(runId: string): Promise<Checkpoint[]> {
    const checkpoints = this.checkpoints.get(runId) ?? [];
    return Promise.resolve(checkpoints.map((c) => structuredClone(c)));
  }

  deleteCheckpoint(runId: string, checkpointId: string): Promise<void> {
    const checkpoints = this.checkpoints.get(runId);
    if (!checkpoints) return Promise.resolve();

    const index = checkpoints.findIndex((c) => c.id === checkpointId);
    if (index === -1) return Promise.resolve();

    checkpoints.splice(index, 1);
    logger.debug(`Deleted checkpoint: ${checkpointId}`);
    return Promise.resolve();
  }

  deleteCheckpoints(runId: string, checkpointIds: string[]): Promise<void> {
    const checkpoints = this.checkpoints.get(runId);
    if (!checkpoints) return Promise.resolve();

    const idsToDelete = new Set(checkpointIds);
    this.checkpoints.set(runId, checkpoints.filter((c) => !idsToDelete.has(c.id)));

    logger.debug("Deleted checkpoints", { count: checkpointIds.length });
    return Promise.resolve();
  }

  // =========================================================================
  // Approvals
  // =========================================================================

  savePendingApproval(runId: string, approval: PendingApproval): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) {
      return Promise.reject(RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` }));
    }
    if (run.status !== "waiting") {
      return Promise.reject(
        INVALID_ARGUMENT.create({
          detail: `Approval can be saved only while run is waiting, got: ${run.status}`,
        }),
      );
    }
    logger.debug("Saving approval", { approvalId: approval.id, runId });
    const approvals = this.approvals.get(runId) ?? [];
    if (approvals.some((stored) => stored.id === approval.id)) {
      return Promise.reject(
        INVALID_ARGUMENT.create({
          detail: `Approval already exists for run "${runId}": ${approval.id}`,
        }),
      );
    }
    approvals.push(structuredClone(approval));
    this.approvals.set(runId, approvals);
    return Promise.resolve();
  }

  savePendingApprovalIfStatusAndWorker(
    runId: string,
    expectedStatuses: WorkflowRun["status"][],
    expectedWorkerId: string,
    approval: PendingApproval,
  ): Promise<boolean> {
    const run = this.runs.get(runId);
    if (
      !run || run.status !== "waiting" || !expectedStatuses.includes(run.status) ||
      run.workerId !== expectedWorkerId
    ) {
      return Promise.resolve(false);
    }

    const approvals = this.approvals.get(runId) ?? [];
    if (approvals.some((stored) => stored.id === approval.id)) {
      return Promise.reject(
        INVALID_ARGUMENT.create({
          detail: `Approval already exists for run "${runId}": ${approval.id}`,
        }),
      );
    }
    approvals.push(structuredClone(approval));
    this.approvals.set(runId, approvals);
    return Promise.resolve(true);
  }

  updatePendingApproval(
    runId: string,
    approvalId: string,
    patch: PendingApprovalMetadataUpdate,
  ): Promise<void> {
    const approvals = this.approvals.get(runId);
    const index = approvals?.findIndex((approval) => approval.id === approvalId) ?? -1;
    if (!approvals || index === -1) {
      return Promise.reject(
        RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` }),
      );
    }
    if (
      approvals.some((approval, candidate) => candidate !== index && approval.id === approvalId)
    ) {
      return Promise.reject(
        INVALID_ARGUMENT.create({
          detail: `Duplicate approval id stored for run "${runId}": ${approvalId}`,
        }),
      );
    }

    let metadata: Readonly<PendingApprovalMetadataUpdate>;
    try {
      metadata = capturePendingApprovalMetadataUpdate(patch);
    } catch (error) {
      return Promise.reject(error);
    }

    approvals[index] = {
      ...approvals[index]!,
      notificationError: metadata.notificationError,
    };
    return Promise.resolve();
  }

  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    if (this.runs.get(runId)?.status !== "waiting") return Promise.resolve([]);
    const approvals = this.approvals.get(runId) ?? [];
    return Promise.resolve(
      approvals.filter((a) => a.status === "pending").map((a) => structuredClone(a)),
    );
  }

  getApproval(runId: string, approvalId: string): Promise<PendingApproval | null> {
    const approvals = this.approvals.get(runId) ?? [];
    const matches = approvals.filter((approval) => approval.id === approvalId);
    if (matches.length > 1) {
      return Promise.reject(
        INVALID_ARGUMENT.create({
          detail: `Duplicate approval id stored for run "${runId}": ${approvalId}`,
        }),
      );
    }
    const approval = matches[0];
    return Promise.resolve(approval ? structuredClone(approval) : null);
  }

  updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
    timingInput: ApprovalDecisionTiming,
  ): Promise<boolean> {
    let timing: Readonly<ApprovalDecisionTiming>;
    try {
      timing = captureApprovalDecisionTiming(timingInput);
    } catch (error) {
      return Promise.reject(error);
    }

    const approvals = this.approvals.get(runId);
    if (!approvals) {
      return Promise.reject(
        RESOURCE_NOT_FOUND.create({ detail: `No approvals found for run: ${runId}` }),
      );
    }

    const matches = approvals.filter((approval) => approval.id === approvalId);
    if (matches.length === 0) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
    }
    if (matches.length !== 1) {
      throw INVALID_ARGUMENT.create({
        detail: `Duplicate approval id stored for run "${runId}": ${approvalId}`,
      });
    }
    const approval = matches[0]!;

    // Run status, pending state, and expiry are one synchronous in-memory CAS.
    // This mirrors the single Redis Lua transaction used by the distributed
    // backend, so a terminal run cannot admit a late approval decision.
    if (this.runs.get(runId)?.status !== "waiting" || approval.status !== "pending") {
      return Promise.resolve(false);
    }

    const expiryMs = approval.expiresAt?.getTime();
    if (expiryMs !== undefined && !Number.isFinite(expiryMs)) {
      return Promise.reject(
        ORCHESTRATION_ERROR.create({
          detail: `Approval has an invalid persisted expiry: ${approvalId}`,
        }),
      );
    }
    const isExpired = expiryMs !== undefined && timing.decidedAt.getTime() > expiryMs;
    const expiryMatches = timing.expiryCondition === "unexpired"
      ? !isExpired
      : expiryMs !== undefined && isExpired;
    if (!expiryMatches) {
      return Promise.resolve(false);
    }

    logger.debug("Updating approval", { approvalId, decision });
    approval.status = decision.approved ? "approved" : "rejected";
    approval.decidedBy = decision.approver;
    approval.decidedAt = timing.decidedAt;
    approval.comment = decision.comment;
    return Promise.resolve(true);
  }

  listPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    const result: Array<{ runId: string; approval: PendingApproval }> = [];

    for (const [runId, approvals] of this.approvals) {
      const run = this.runs.get(runId);
      if (!run) continue;
      if (run.status !== "waiting") continue;
      if (filter?.workflowId && run.workflowId !== filter.workflowId) continue;

      for (const approval of approvals) {
        if (filter?.status === "pending" && approval.status !== "pending") continue;

        if (filter?.status === "expired") {
          const isExpired = approval.expiresAt != null && new Date() > approval.expiresAt;
          if (!isExpired) continue;
        }

        if (
          filter?.approver &&
          approval.approvers &&
          !approval.approvers.includes(filter.approver)
        ) {
          continue;
        }

        result.push({ runId, approval: structuredClone(approval) });
      }
    }

    return Promise.resolve(result);
  }

  // =========================================================================
  // Queue Operations
  // =========================================================================

  enqueue(job: WorkflowQueueItem): Promise<void> {
    const maxSize = this.config.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
    if (this.queue.length >= maxSize) {
      return Promise.reject(
        ORCHESTRATION_ERROR.create({
          detail: `Queue full (max: ${maxSize}). Cannot enqueue job: ${job.runId}`,
        }),
      );
    }

    logger.debug(`Enqueueing job: ${job.runId}`);

    const priority = job.priority ?? 0;
    const insertIndex = this.queue.findIndex((j) => (j.priority ?? 0) < priority);
    const cloned = structuredClone(job);

    if (insertIndex === -1) {
      this.queue.push(cloned);
      return Promise.resolve();
    }

    this.queue.splice(insertIndex, 0, cloned);
    return Promise.resolve();
  }

  dequeue(): Promise<WorkflowQueueItem | null> {
    const job = this.queue.shift();
    return Promise.resolve(job ? structuredClone(job) : null);
  }

  acknowledge(runId: string): Promise<void> {
    logger.debug(`Acknowledging job: ${runId}`);
    return Promise.resolve();
  }

  async nack(runId: string): Promise<void> {
    await requeueRun(this, runId);
  }

  // =========================================================================
  // Distributed Locking
  // =========================================================================

  acquireLock(runId: string, duration: number): Promise<string | null> {
    const existing = this.locks.get(runId);
    const now = Date.now();

    if (existing && existing.expiresAt > now) return Promise.resolve(null);

    logger.debug(`Acquiring lock for: ${runId}`);

    const lockId = crypto.randomUUID();
    this.locks.set(runId, { lockId, expiresAt: now + duration });
    return Promise.resolve(lockId);
  }

  releaseLock(runId: string, lockId: string): Promise<boolean> {
    logger.debug(`Releasing lock for: ${runId}`);

    // Compare-and-delete: a stalled worker whose lock already expired and was
    // re-acquired by another owner must not delete the new owner's lock.
    const existing = this.locks.get(runId);
    if (!existing) return Promise.resolve(false);
    if (existing.expiresAt <= Date.now()) {
      if (existing.lockId === lockId) this.locks.delete(runId);
      return Promise.resolve(false);
    }
    if (existing.lockId !== lockId) return Promise.resolve(false);

    this.locks.delete(runId);
    return Promise.resolve(true);
  }

  extendLock(runId: string, duration: number, lockId: string): Promise<boolean> {
    const existing = this.locks.get(runId);
    const now = Date.now();

    if (!existing || existing.expiresAt <= now) return Promise.resolve(false);
    if (existing.lockId !== lockId) return Promise.resolve(false);

    existing.expiresAt = now + duration;
    return Promise.resolve(true);
  }

  isLocked(runId: string): Promise<boolean> {
    const existing = this.locks.get(runId);
    return Promise.resolve(!!existing && existing.expiresAt > Date.now());
  }

  // =========================================================================
  // Stalled Run Recovery
  // =========================================================================

  findStalledRuns(stalledThreshold: number): Promise<WorkflowRun[]> {
    const now = Date.now();
    const stalled = Array.from(this.runs.values())
      .filter((run) => run.status === "running")
      .filter((run) => {
        const lastActivity = run.heartbeatAt?.getTime() ?? run.startedAt?.getTime() ??
          run.createdAt.getTime();
        return now - lastActivity >= stalledThreshold;
      })
      .map((run) => structuredClone(run));

    return Promise.resolve(stalled);
  }

  claimStalledRun(runId: string, workerId: string, stalledThreshold: number): Promise<boolean> {
    const now = Date.now();
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") {
      return Promise.resolve(false);
    }

    const lastActivity = run.heartbeatAt?.getTime() ?? run.startedAt?.getTime() ??
      run.createdAt.getTime();
    if (now - lastActivity < stalledThreshold) {
      return Promise.resolve(false);
    }

    const claim = this.stalledClaims.get(runId);
    if (claim && claim.expiresAt > now) {
      return Promise.resolve(false);
    }

    this.stalledClaims.set(runId, {
      workerId,
      expiresAt: now + stalledThreshold,
    });

    run.workerId = workerId;
    run.startedAt = run.startedAt ?? new Date(now);
    run.heartbeatAt = new Date(now);
    this.runs.set(runId, run);

    return Promise.resolve(true);
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  initialize(): Promise<void> {
    logger.debug("Initialized");
    return Promise.resolve();
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }

  destroy(): Promise<void> {
    this.clear();

    logger.debug("Destroyed");
    return Promise.resolve();
  }

  // =========================================================================
  // Development Helpers
  // =========================================================================

  getStats(): {
    runs: number;
    checkpoints: number;
    approvals: number;
    queueLength: number;
    locks: number;
  } {
    let totalCheckpoints = 0;
    let totalApprovals = 0;

    for (const checkpoints of this.checkpoints.values()) totalCheckpoints += checkpoints.length;
    for (const approvals of this.approvals.values()) totalApprovals += approvals.length;

    return {
      runs: this.runs.size,
      checkpoints: totalCheckpoints,
      approvals: totalApprovals,
      queueLength: this.queue.length,
      locks: this.locks.size,
    };
  }

  clear(): Promise<void> {
    this.runs.clear();
    this.checkpoints.clear();
    this.approvals.clear();
    this.queue = [];
    this.locks.clear();
    this.stalledClaims.clear();
    return Promise.resolve();
  }
}
