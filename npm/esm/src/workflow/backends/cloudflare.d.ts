import type { ApprovalDecision, Checkpoint, PendingApproval, RunFilter, WorkflowJob, WorkflowRun } from "../types.js";
import type { BackendConfig, WorkflowBackend } from "./types.js";
export interface CloudflareAdapterConfig extends BackendConfig {
    /** Durable Object namespace binding name */
    durableObjectBinding?: string;
    /** KV namespace binding name (for auxiliary storage) */
    kvBinding?: string;
    /** Queue binding name (for job queue) */
    queueBinding?: string;
    /** Enable debug logging */
    debug?: boolean;
}
/**
 * Stub implementation - requires Cloudflare Workers environment bindings.
 */
export declare class CloudflareAdapter implements WorkflowBackend {
    private config;
    constructor(config?: CloudflareAdapterConfig);
    createRun(_run: WorkflowRun): Promise<void>;
    getRun(_runId: string): Promise<WorkflowRun | null>;
    updateRun(_runId: string, _patch: Partial<WorkflowRun>): Promise<void>;
    listRuns(_filter: RunFilter): Promise<WorkflowRun[]>;
    saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void>;
    getLatestCheckpoint(_runId: string): Promise<Checkpoint | null>;
    savePendingApproval(_runId: string, _approval: PendingApproval): Promise<void>;
    getPendingApprovals(_runId: string): Promise<PendingApproval[]>;
    updateApproval(_runId: string, _approvalId: string, _decision: ApprovalDecision): Promise<void>;
    enqueue(_job: WorkflowJob): Promise<void>;
    dequeue(): Promise<WorkflowJob | null>;
    acknowledge(_runId: string): Promise<void>;
    destroy(): Promise<void>;
}
//# sourceMappingURL=cloudflare.d.ts.map