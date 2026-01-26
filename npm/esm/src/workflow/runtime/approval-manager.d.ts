import type { ApprovalDecision, PendingApproval, WaitNodeConfig, WorkflowContext, WorkflowRun } from "../types.js";
import type { WorkflowBackend } from "../backends/types.js";
import type { WorkflowExecutor } from "../executor/workflow-executor.js";
export type ApprovalNotifier = (approval: PendingApproval, run: WorkflowRun) => Promise<void>;
export interface ApprovalManagerConfig {
    /** Backend for persistence */
    backend: WorkflowBackend;
    /** Workflow executor for resuming after approval */
    executor?: WorkflowExecutor;
    /** Notification callback */
    notifier?: ApprovalNotifier;
    /** Check expired approvals interval (ms) */
    expirationCheckInterval?: number;
    /** Enable debug logging */
    debug?: boolean;
}
export interface ApprovalRequest {
    /** Approval ID */
    approvalId: string;
    /** Run ID */
    runId: string;
    /** Node ID */
    nodeId: string;
    /** Message for approver */
    message: string;
    /** Payload with context */
    payload: unknown;
    /** When approval expires */
    expiresAt?: Date;
}
/** Manages pending approvals, processing decisions, and resuming workflows */
export declare class ApprovalManager {
    private config;
    private expirationTimer?;
    private destroyed;
    constructor(config: ApprovalManagerConfig);
    /** Create a pending approval request */
    createApproval(run: WorkflowRun, nodeId: string, waitConfig: WaitNodeConfig, context: WorkflowContext): Promise<ApprovalRequest>;
    /** Get pending approval by ID */
    getApproval(runId: string, approvalId: string): Promise<PendingApproval | null>;
    /** Get all pending approvals for a run */
    getPendingApprovals(runId: string): Promise<PendingApproval[]>;
    /** Process an approval decision */
    processDecision(runId: string, approvalId: string, decision: ApprovalDecision): Promise<void>;
    /** Approve an approval request */
    approve(runId: string, approvalId: string, approver: string, comment?: string): Promise<void>;
    /** Reject an approval request */
    reject(runId: string, approvalId: string, approver: string, comment?: string): Promise<void>;
    /** List all pending approvals across workflows */
    listAllPending(filter?: {
        workflowId?: string;
        approver?: string;
    }): Promise<Array<{
        runId: string;
        approval: PendingApproval;
    }>>;
    /** Check and expire stale approvals */
    checkExpiredApprovals(): Promise<void>;
    private startExpirationChecker;
    /** Stop the approval manager */
    stop(): void;
}
//# sourceMappingURL=approval-manager.d.ts.map