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
  WorkflowJob,
  WorkflowRun,
} from "../types.ts";
import type { BackendConfig, WorkflowBackend } from "./types.ts";
import { requeueRun } from "./shared/requeue-run.ts";
import { ORCHESTRATION_ERROR, RESOURCE_NOT_FOUND } from "#veryfront/errors";

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

export class MemoryBackend implements WorkflowBackend {
  private runs = new Map<string, WorkflowRun>();
  private checkpoints = new Map<string, Checkpoint[]>();
  private approvals = new Map<string, PendingApproval[]>();
  private queue: WorkflowJob[] = [];
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
    this.runs.set(run.id, structuredClone(run));
    return Promise.resolve();
  }

  getRun(runId: string): Promise<WorkflowRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? structuredClone(run) : null);
  }

  updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw RESOURCE_NOT_FOUND.create({ detail: `Run not found: ${runId}` });

    logger.debug(`Updating run: ${runId}`, patch);

    const updated: WorkflowRun = {
      ...run,
      ...patch,
      nodeStates: { ...run.nodeStates, ...patch.nodeStates },
      context: { ...run.context, ...patch.context },
    };

    this.runs.set(runId, updated);

    // Terminal states should drop any stalled claim lease.
    if (patch.status && patch.status !== "running") {
      this.stalledClaims.delete(runId);
    }

    return Promise.resolve();
  }

  deleteRun(runId: string): Promise<void> {
    this.runs.delete(runId);
    this.checkpoints.delete(runId);
    this.approvals.delete(runId);
    this.stalledClaims.delete(runId);
    return Promise.resolve();
  }

  listRuns(filter: RunFilter): Promise<WorkflowRun[]> {
    let runs = Array.from(this.runs.values());

    if (filter.workflowId) {
      runs = runs.filter((r) => r.workflowId === filter.workflowId);
    }

    if (filter.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      runs = runs.filter((r) => statuses.includes(r.status));
    }

    if (filter.createdAfter) {
      const createdAfter = filter.createdAfter;
      runs = runs.filter((r) => r.createdAt >= createdAfter);
    }

    if (filter.createdBefore) {
      const createdBefore = filter.createdBefore;
      runs = runs.filter((r) => r.createdAt <= createdBefore);
    }

    runs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const start = filter.offset ?? 0;
    const end = filter.limit ? start + filter.limit : undefined;
    runs = runs.slice(start, end);

    return Promise.resolve(runs.map((r) => structuredClone(r)));
  }

  async countRuns(filter: RunFilter): Promise<number> {
    const runs = await this.listRuns({ ...filter, limit: undefined, offset: undefined });
    return runs.length;
  }

  // =========================================================================
  // Checkpointing
  // =========================================================================

  saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void> {
    logger.debug("Saving checkpoint", { checkpointId: checkpoint.id, runId });
    const checkpoints = this.checkpoints.get(runId) ?? [];
    checkpoints.push(structuredClone(checkpoint));
    this.checkpoints.set(runId, checkpoints);
    return Promise.resolve();
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
    logger.debug("Saving approval", { approvalId: approval.id, runId });
    const approvals = this.approvals.get(runId) ?? [];
    approvals.push(structuredClone(approval));
    this.approvals.set(runId, approvals);
    return Promise.resolve();
  }

  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    const approvals = this.approvals.get(runId) ?? [];
    return Promise.resolve(
      approvals.filter((a) => a.status === "pending").map((a) => structuredClone(a)),
    );
  }

  getPendingApproval(runId: string, approvalId: string): Promise<PendingApproval | null> {
    const approvals = this.approvals.get(runId) ?? [];
    const approval = approvals.find((a) => a.id === approvalId);
    return Promise.resolve(approval ? structuredClone(approval) : null);
  }

  updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const approvals = this.approvals.get(runId);
    if (!approvals) {
      throw RESOURCE_NOT_FOUND.create({ detail: `No approvals found for run: ${runId}` });
    }

    const approval = approvals.find((a) => a.id === approvalId);
    if (!approval) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Approval not found: ${approvalId}` });
    }

    logger.debug("Updating approval", { approvalId, decision });
    approval.status = decision.approved ? "approved" : "rejected";
    approval.decidedBy = decision.approver;
    approval.decidedAt = new Date();
    approval.comment = decision.comment;
    return Promise.resolve();
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

  enqueue(job: WorkflowJob): Promise<void> {
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

  dequeue(): Promise<WorkflowJob | null> {
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

  acquireLock(runId: string, duration: number): Promise<boolean> {
    const existing = this.locks.get(runId);
    const now = Date.now();

    if (existing && existing.expiresAt > now) return Promise.resolve(false);

    logger.debug(`Acquiring lock for: ${runId}`);

    this.locks.set(runId, { lockId: crypto.randomUUID(), expiresAt: now + duration });
    return Promise.resolve(true);
  }

  releaseLock(runId: string): Promise<void> {
    logger.debug(`Releasing lock for: ${runId}`);
    this.locks.delete(runId);
    return Promise.resolve();
  }

  extendLock(runId: string, duration: number): Promise<boolean> {
    const existing = this.locks.get(runId);
    const now = Date.now();

    if (!existing || existing.expiresAt <= now) return Promise.resolve(false);

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
