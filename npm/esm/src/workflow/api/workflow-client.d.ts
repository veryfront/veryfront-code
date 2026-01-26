/**************************
 * Workflow Client
 *
 * High-level API for interacting with workflows
 **************************/
import type { PendingApproval, RunFilter, WorkflowDefinition, WorkflowRun, WorkflowStatus } from "../types.js";
import type { WorkflowBackend } from "../backends/types.js";
import { WorkflowExecutor, type WorkflowExecutorConfig, type WorkflowHandle } from "../executor/workflow-executor.js";
import { ApprovalManager, type ApprovalManagerConfig } from "../runtime/approval-manager.js";
import type { Workflow } from "../dsl/workflow.js";
export interface WorkflowClientConfig {
    /** Backend for persistence (default: MemoryBackend) */
    backend?: WorkflowBackend;
    /** Executor configuration */
    executor?: Partial<WorkflowExecutorConfig>;
    /** Approval manager configuration */
    approval?: Partial<ApprovalManagerConfig>;
    /** Enable debug logging */
    debug?: boolean;
}
export declare class WorkflowClient {
    private backend;
    private executor;
    private approvalManager;
    private debug;
    constructor(config?: WorkflowClientConfig);
    register(workflow: Workflow | WorkflowDefinition): void;
    registerAll(workflows: Array<Workflow | WorkflowDefinition>): void;
    start<TInput, TOutput = unknown>(workflowId: string, input: TInput, options?: {
        runId?: string;
    }): Promise<WorkflowHandle<TOutput>>;
    resume(runId: string): Promise<void>;
    cancel(runId: string): Promise<void>;
    getRun(runId: string): Promise<WorkflowRun | null>;
    listRuns(filter?: RunFilter): Promise<WorkflowRun[]>;
    getRunsByStatus(status: WorkflowStatus | WorkflowStatus[], limit?: number): Promise<WorkflowRun[]>;
    getRunsForWorkflow(workflowId: string, limit?: number): Promise<WorkflowRun[]>;
    getPendingApprovals(runId: string): Promise<PendingApproval[]>;
    approve(runId: string, approvalId: string, approver: string, comment?: string): Promise<void>;
    reject(runId: string, approvalId: string, approver: string, comment?: string): Promise<void>;
    listAllPendingApprovals(filter?: {
        workflowId?: string;
        approver?: string;
    }): Promise<Array<{
        runId: string;
        approval: PendingApproval;
    }>>;
    getBackend(): WorkflowBackend;
    getExecutor(): WorkflowExecutor;
    getApprovalManager(): ApprovalManager;
    destroy(): Promise<void>;
}
export declare function createWorkflowClient(config?: WorkflowClientConfig): WorkflowClient;
//# sourceMappingURL=workflow-client.d.ts.map