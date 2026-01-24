/****
 * Memory Workflow Backend
 *
 * In-memory implementation of WorkflowBackend for development and testing.
 * Data is NOT persisted across restarts.
 */

import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowJob,
  WorkflowRun,
} from "../types.ts";
import type { BackendConfig, WorkflowBackend } from "./types.ts";

/**
 * Memory backend configuration
 */
export interface MemoryBackendConfig extends BackendConfig {
  /** Maximum queue size (default: 10000) */
  maxQueueSize?: number;
}

/** Default max queue size */
const DEFAULT_MAX_QUEUE_SIZE = 10000;

export class MemoryBackend implements WorkflowBackend {
  private runs = new Map<string, WorkflowRun>();
  private checkpoints = new Map<string, Checkpoint[]>();
  private approvals = new Map<string, PendingApproval[]>();
  private queue: WorkflowJob[] = [];
  private locks = new Map<string, { lockId: string; expiresAt: number }>();
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
    if (this.config.debug) console.log(`[MemoryBackend] Creating run: ${run.id}`);
    this.runs.set(run.id, structuredClone(run));
    return Promise.resolve();
  }

  getRun(runId: string): Promise<WorkflowRun | null> {
    const run = this.runs.get(runId);
    return Promise.resolve(run ? structuredClone(run) : null);
  }

  updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);

    if (this.config.debug) console.log(`[MemoryBackend] Updating run: ${runId}`, patch);

    const updated: WorkflowRun = {
      ...run,
      ...patch,
      nodeStates: { ...run.nodeStates, ...patch.nodeStates },
      context: { ...run.context, ...patch.context },
    };

    this.runs.set(runId, updated);
    return Promise.resolve();
  }

  deleteRun(runId: string): Promise<void> {
    this.runs.delete(runId);
    this.checkpoints.delete(runId);
    this.approvals.delete(runId);
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
    if (this.config.debug) {
      console.log(`[MemoryBackend] Saving checkpoint: ${checkpoint.id} for run ${runId}`);
    }

    const existing = this.checkpoints.get(runId) ?? [];
    existing.push(structuredClone(checkpoint));
    this.checkpoints.set(runId, existing);
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
    if (this.config.debug) console.log(`[MemoryBackend] Deleted checkpoint: ${checkpointId}`);
    return Promise.resolve();
  }

  deleteCheckpoints(runId: string, checkpointIds: string[]): Promise<void> {
    const checkpoints = this.checkpoints.get(runId);
    if (!checkpoints) return Promise.resolve();

    const idsToDelete = new Set(checkpointIds);
    this.checkpoints.set(
      runId,
      checkpoints.filter((c) => !idsToDelete.has(c.id)),
    );

    if (this.config.debug) {
      console.log(`[MemoryBackend] Deleted ${checkpointIds.length} checkpoints`);
    }
    return Promise.resolve();
  }

  // =========================================================================
  // Approvals
  // =========================================================================

  savePendingApproval(runId: string, approval: PendingApproval): Promise<void> {
    if (this.config.debug) {
      console.log(`[MemoryBackend] Saving approval: ${approval.id} for run ${runId}`);
    }

    const existing = this.approvals.get(runId) ?? [];
    existing.push(structuredClone(approval));
    this.approvals.set(runId, existing);
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
    if (!approvals) throw new Error(`No approvals found for run: ${runId}`);

    const approval = approvals.find((a) => a.id === approvalId);
    if (!approval) throw new Error(`Approval not found: ${approvalId}`);

    if (this.config.debug) {
      console.log(`[MemoryBackend] Updating approval: ${approvalId}`, decision);
    }

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
          const isExpired = !!approval.expiresAt && new Date() > approval.expiresAt;
          if (!isExpired) continue;
        }

        if (
          filter?.approver && approval.approvers && !approval.approvers.includes(filter.approver)
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
        new Error(`Queue full (max: ${maxSize}). Cannot enqueue job: ${job.runId}`),
      );
    }

    if (this.config.debug) console.log(`[MemoryBackend] Enqueueing job: ${job.runId}`);

    const priority = job.priority ?? 0;
    const insertIndex = this.queue.findIndex((j) => (j.priority ?? 0) < priority);
    const cloned = structuredClone(job);

    if (insertIndex === -1) {
      this.queue.push(cloned);
    } else {
      this.queue.splice(insertIndex, 0, cloned);
    }

    return Promise.resolve();
  }

  dequeue(): Promise<WorkflowJob | null> {
    const job = this.queue.shift();
    return Promise.resolve(job ? structuredClone(job) : null);
  }

  acknowledge(runId: string): Promise<void> {
    if (this.config.debug) console.log(`[MemoryBackend] Acknowledging job: ${runId}`);
    return Promise.resolve();
  }

  async nack(runId: string): Promise<void> {
    const run = await this.getRun(runId);
    if (!run) return;

    await this.enqueue({
      runId: run.id,
      workflowId: run.workflowId,
      input: run.input,
      createdAt: new Date(),
    });
  }

  // =========================================================================
  // Distributed Locking
  // =========================================================================

  acquireLock(runId: string, duration: number): Promise<boolean> {
    const existing = this.locks.get(runId);
    const now = Date.now();

    if (existing && existing.expiresAt > now) return Promise.resolve(false);

    if (this.config.debug) console.log(`[MemoryBackend] Acquiring lock for: ${runId}`);

    this.locks.set(runId, { lockId: crypto.randomUUID(), expiresAt: now + duration });
    return Promise.resolve(true);
  }

  releaseLock(runId: string): Promise<void> {
    if (this.config.debug) console.log(`[MemoryBackend] Releasing lock for: ${runId}`);
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
  // Lifecycle
  // =========================================================================

  initialize(): Promise<void> {
    if (this.config.debug) console.log("[MemoryBackend] Initialized");
    return Promise.resolve();
  }

  healthCheck(): Promise<boolean> {
    return Promise.resolve(true);
  }

  destroy(): Promise<void> {
    this.runs.clear();
    this.checkpoints.clear();
    this.approvals.clear();
    this.queue = [];
    this.locks.clear();

    if (this.config.debug) console.log("[MemoryBackend] Destroyed");
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
    return Promise.resolve();
  }
}
