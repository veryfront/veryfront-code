import type { ApprovalDecision, Checkpoint, PendingApproval, RunFilter, WorkflowJob, WorkflowRun } from "../../types.js";
import type { WorkflowBackend } from "../types.js";
export type { RedisAdapter } from "../../../platform/adapters/redis/index.js";
export type { RedisBackendConfig } from "./types.js";
import type { RedisBackendConfig } from "./types.js";
export declare class RedisBackend implements WorkflowBackend {
    private client;
    private connectionPromise;
    private config;
    private initialized;
    constructor(config?: RedisBackendConfig);
    private runKey;
    private checkpointsKey;
    private approvalsKey;
    private statusIndexKey;
    private workflowIndexKey;
    private lockKey;
    private serializeRun;
    private deserializeRun;
    private ensureClient;
    private createConnection;
    initialize(): Promise<void>;
    createRun(run: WorkflowRun): Promise<void>;
    getRun(runId: string): Promise<WorkflowRun | null>;
    updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void>;
    deleteRun(runId: string): Promise<void>;
    listRuns(filter: RunFilter): Promise<WorkflowRun[]>;
    countRuns(filter: RunFilter): Promise<number>;
    saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void>;
    getLatestCheckpoint(runId: string): Promise<Checkpoint | null>;
    getCheckpoints(runId: string): Promise<Checkpoint[]>;
    savePendingApproval(runId: string, approval: PendingApproval): Promise<void>;
    private parseApproval;
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
    healthCheck(): Promise<boolean>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=index.d.ts.map