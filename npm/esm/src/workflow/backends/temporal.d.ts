/**
 * Temporal Adapter - workflow execution backend for enterprise-grade, long-running workflows.
 * @see https://docs.temporal.io/
 */
import type { ApprovalDecision, Checkpoint, PendingApproval, RunFilter, WorkflowJob, WorkflowRun } from "../types.js";
import type { BackendConfig, WorkflowBackend } from "./types.js";
export interface TemporalAdapterConfig extends BackendConfig {
    /** Temporal server address */
    address?: string;
    /** Temporal namespace */
    namespace?: string;
    /** Task queue name */
    taskQueue?: string;
    /** TLS configuration */
    tls?: {
        clientCertPath?: string;
        clientKeyPath?: string;
        serverRootCACertPath?: string;
    };
    /** Enable debug logging */
    debug?: boolean;
}
/**
 * Stub implementation - requires Temporal SDK and worker setup.
 */
export declare class TemporalAdapter implements WorkflowBackend {
    private config;
    constructor(config?: TemporalAdapterConfig);
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
//# sourceMappingURL=temporal.d.ts.map