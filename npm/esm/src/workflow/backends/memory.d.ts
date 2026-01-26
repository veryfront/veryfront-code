import type { ApprovalDecision, Checkpoint, PendingApproval, RunFilter, WorkflowJob, WorkflowRun } from "../types.js";
import type { BackendConfig, WorkflowBackend } from "./types.js";
/**
 * Memory backend configuration
 */
export interface MemoryBackendConfig extends BackendConfig {
    /** Maximum queue size (default: 10000) */
    maxQueueSize?: number;
}
export declare class MemoryBackend implements WorkflowBackend {
    private runs;
    private checkpoints;
    private approvals;
    private queue;
    private locks;
    private config;
    constructor(config?: MemoryBackendConfig);
    createRun(run: WorkflowRun): Promise<void>;
    getRun(runId: string): Promise<WorkflowRun | null>;
    updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void>;
    deleteRun(runId: string): Promise<void>;
    listRuns(filter: RunFilter): Promise<WorkflowRun[]>;
    countRuns(filter: RunFilter): Promise<number>;
    saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void>;
    getLatestCheckpoint(runId: string): Promise<Checkpoint | null>;
    getCheckpoints(runId: string): Promise<Checkpoint[]>;
    deleteCheckpoint(runId: string, checkpointId: string): Promise<void>;
    deleteCheckpoints(runId: string, checkpointIds: string[]): Promise<void>;
    savePendingApproval(runId: string, approval: PendingApproval): Promise<void>;
    getPendingApprovals(runId: string): Promise<PendingApproval[]>;
    getPendingApproval(runId: string, approvalId: string): Promise<PendingApproval | null>;
    updateApproval(runId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;
    listPendingApprovals(filter?: {
        workflowId?: string;
        approver?: string;
        status?: "pending" | "expired";
    }): Promise<Array<{
        runId: string;
        approval: PendingApproval;
    }>>;
    enqueue(job: WorkflowJob): Promise<void>;
    dequeue(): Promise<WorkflowJob | null>;
    acknowledge(runId: string): Promise<void>;
    nack(runId: string): Promise<void>;
    acquireLock(runId: string, duration: number): Promise<boolean>;
    releaseLock(runId: string): Promise<void>;
    extendLock(runId: string, duration: number): Promise<boolean>;
    isLocked(runId: string): Promise<boolean>;
    initialize(): Promise<void>;
    healthCheck(): Promise<boolean>;
    destroy(): Promise<void>;
    getStats(): {
        runs: number;
        checkpoints: number;
        approvals: number;
        queueLength: number;
        locks: number;
    };
    clear(): Promise<void>;
}
//# sourceMappingURL=memory.d.ts.map