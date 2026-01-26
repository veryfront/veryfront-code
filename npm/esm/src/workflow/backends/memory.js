/****
 * Memory Workflow Backend
 *
 * In-memory implementation of WorkflowBackend for development and testing.
 * Data is NOT persisted across restarts.
 */
import * as dntShim from "../../../_dnt.shims.js";
import { logger } from "../../utils/index.js";
/** Default max queue size */
const DEFAULT_MAX_QUEUE_SIZE = 10000;
export class MemoryBackend {
    runs = new Map();
    checkpoints = new Map();
    approvals = new Map();
    queue = [];
    locks = new Map();
    config;
    constructor(config = {}) {
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
    createRun(run) {
        logger.debug(`[MemoryBackend] Creating run: ${run.id}`);
        this.runs.set(run.id, structuredClone(run));
        return Promise.resolve();
    }
    getRun(runId) {
        const run = this.runs.get(runId);
        return Promise.resolve(run ? structuredClone(run) : null);
    }
    updateRun(runId, patch) {
        const run = this.runs.get(runId);
        if (!run)
            throw new Error(`Run not found: ${runId}`);
        logger.debug(`[MemoryBackend] Updating run: ${runId}`, patch);
        const updated = {
            ...run,
            ...patch,
            nodeStates: { ...run.nodeStates, ...patch.nodeStates },
            context: { ...run.context, ...patch.context },
        };
        this.runs.set(runId, updated);
        return Promise.resolve();
    }
    deleteRun(runId) {
        this.runs.delete(runId);
        this.checkpoints.delete(runId);
        this.approvals.delete(runId);
        return Promise.resolve();
    }
    listRuns(filter) {
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
    async countRuns(filter) {
        const runs = await this.listRuns({ ...filter, limit: undefined, offset: undefined });
        return runs.length;
    }
    // =========================================================================
    // Checkpointing
    // =========================================================================
    saveCheckpoint(runId, checkpoint) {
        logger.debug("[MemoryBackend] Saving checkpoint", { checkpointId: checkpoint.id, runId });
        const existing = this.checkpoints.get(runId) ?? [];
        existing.push(structuredClone(checkpoint));
        this.checkpoints.set(runId, existing);
        return Promise.resolve();
    }
    getLatestCheckpoint(runId) {
        const checkpoints = this.checkpoints.get(runId);
        if (!checkpoints?.length)
            return Promise.resolve(null);
        const latest = checkpoints[checkpoints.length - 1];
        return Promise.resolve(latest ? structuredClone(latest) : null);
    }
    getCheckpoints(runId) {
        const checkpoints = this.checkpoints.get(runId) ?? [];
        return Promise.resolve(checkpoints.map((c) => structuredClone(c)));
    }
    deleteCheckpoint(runId, checkpointId) {
        const checkpoints = this.checkpoints.get(runId);
        if (!checkpoints)
            return Promise.resolve();
        const index = checkpoints.findIndex((c) => c.id === checkpointId);
        if (index === -1)
            return Promise.resolve();
        checkpoints.splice(index, 1);
        logger.debug(`[MemoryBackend] Deleted checkpoint: ${checkpointId}`);
        return Promise.resolve();
    }
    deleteCheckpoints(runId, checkpointIds) {
        const checkpoints = this.checkpoints.get(runId);
        if (!checkpoints)
            return Promise.resolve();
        const idsToDelete = new Set(checkpointIds);
        this.checkpoints.set(runId, checkpoints.filter((c) => !idsToDelete.has(c.id)));
        logger.debug("[MemoryBackend] Deleted checkpoints", { count: checkpointIds.length });
        return Promise.resolve();
    }
    // =========================================================================
    // Approvals
    // =========================================================================
    savePendingApproval(runId, approval) {
        logger.debug("[MemoryBackend] Saving approval", { approvalId: approval.id, runId });
        const existing = this.approvals.get(runId) ?? [];
        existing.push(structuredClone(approval));
        this.approvals.set(runId, existing);
        return Promise.resolve();
    }
    getPendingApprovals(runId) {
        const approvals = this.approvals.get(runId) ?? [];
        return Promise.resolve(approvals.filter((a) => a.status === "pending").map((a) => structuredClone(a)));
    }
    getPendingApproval(runId, approvalId) {
        const approvals = this.approvals.get(runId) ?? [];
        const approval = approvals.find((a) => a.id === approvalId);
        return Promise.resolve(approval ? structuredClone(approval) : null);
    }
    updateApproval(runId, approvalId, decision) {
        const approvals = this.approvals.get(runId);
        if (!approvals)
            throw new Error(`No approvals found for run: ${runId}`);
        const approval = approvals.find((a) => a.id === approvalId);
        if (!approval)
            throw new Error(`Approval not found: ${approvalId}`);
        logger.debug("[MemoryBackend] Updating approval", { approvalId, decision });
        approval.status = decision.approved ? "approved" : "rejected";
        approval.decidedBy = decision.approver;
        approval.decidedAt = new Date();
        approval.comment = decision.comment;
        return Promise.resolve();
    }
    listPendingApprovals(filter) {
        const result = [];
        for (const [runId, approvals] of this.approvals) {
            const run = this.runs.get(runId);
            if (!run)
                continue;
            if (filter?.workflowId && run.workflowId !== filter.workflowId)
                continue;
            for (const approval of approvals) {
                if (filter?.status === "pending" && approval.status !== "pending")
                    continue;
                if (filter?.status === "expired") {
                    const isExpired = !!approval.expiresAt && new Date() > approval.expiresAt;
                    if (!isExpired)
                        continue;
                }
                if (filter?.approver && approval.approvers && !approval.approvers.includes(filter.approver)) {
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
    enqueue(job) {
        const maxSize = this.config.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
        if (this.queue.length >= maxSize) {
            return Promise.reject(new Error(`Queue full (max: ${maxSize}). Cannot enqueue job: ${job.runId}`));
        }
        logger.debug(`[MemoryBackend] Enqueueing job: ${job.runId}`);
        const priority = job.priority ?? 0;
        const insertIndex = this.queue.findIndex((j) => (j.priority ?? 0) < priority);
        const cloned = structuredClone(job);
        if (insertIndex === -1) {
            this.queue.push(cloned);
        }
        else {
            this.queue.splice(insertIndex, 0, cloned);
        }
        return Promise.resolve();
    }
    dequeue() {
        const job = this.queue.shift();
        return Promise.resolve(job ? structuredClone(job) : null);
    }
    acknowledge(runId) {
        logger.debug(`[MemoryBackend] Acknowledging job: ${runId}`);
        return Promise.resolve();
    }
    async nack(runId) {
        const run = await this.getRun(runId);
        if (!run)
            return;
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
    acquireLock(runId, duration) {
        const existing = this.locks.get(runId);
        const now = Date.now();
        if (existing && existing.expiresAt > now)
            return Promise.resolve(false);
        logger.debug(`[MemoryBackend] Acquiring lock for: ${runId}`);
        this.locks.set(runId, { lockId: dntShim.crypto.randomUUID(), expiresAt: now + duration });
        return Promise.resolve(true);
    }
    releaseLock(runId) {
        logger.debug(`[MemoryBackend] Releasing lock for: ${runId}`);
        this.locks.delete(runId);
        return Promise.resolve();
    }
    extendLock(runId, duration) {
        const existing = this.locks.get(runId);
        const now = Date.now();
        if (!existing || existing.expiresAt <= now)
            return Promise.resolve(false);
        existing.expiresAt = now + duration;
        return Promise.resolve(true);
    }
    isLocked(runId) {
        const existing = this.locks.get(runId);
        return Promise.resolve(!!existing && existing.expiresAt > Date.now());
    }
    // =========================================================================
    // Lifecycle
    // =========================================================================
    initialize() {
        logger.debug("[MemoryBackend] Initialized");
        return Promise.resolve();
    }
    healthCheck() {
        return Promise.resolve(true);
    }
    destroy() {
        this.runs.clear();
        this.checkpoints.clear();
        this.approvals.clear();
        this.queue = [];
        this.locks.clear();
        logger.debug("[MemoryBackend] Destroyed");
        return Promise.resolve();
    }
    // =========================================================================
    // Development Helpers
    // =========================================================================
    getStats() {
        let totalCheckpoints = 0;
        let totalApprovals = 0;
        for (const checkpoints of this.checkpoints.values())
            totalCheckpoints += checkpoints.length;
        for (const approvals of this.approvals.values())
            totalApprovals += approvals.length;
        return {
            runs: this.runs.size,
            checkpoints: totalCheckpoints,
            approvals: totalApprovals,
            queueLength: this.queue.length,
            locks: this.locks.size,
        };
    }
    clear() {
        this.runs.clear();
        this.checkpoints.clear();
        this.approvals.clear();
        this.queue = [];
        this.locks.clear();
        return Promise.resolve();
    }
}
