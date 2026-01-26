import type { ApprovalDecision, PendingApproval } from "../types.js";
export interface UseApprovalOptions {
    runId: string;
    approvalId: string;
    apiBase?: string;
    approver?: string;
    onDecision?: (decision: ApprovalDecision) => void;
    onError?: (error: Error) => void;
}
export interface UseApprovalResult {
    approval: PendingApproval | null;
    approve: (comment?: string) => Promise<void>;
    reject: (comment?: string) => Promise<void>;
    submitDecision: (decision: ApprovalDecision) => Promise<void>;
    isSubmitting: boolean;
    isLoading: boolean;
    error: Error | null;
    isPending: boolean;
    isResolved: boolean;
}
/**
 * Handle workflow approval interactions.
 */
export declare function useApproval(options: UseApprovalOptions): UseApprovalResult;
//# sourceMappingURL=use-approval.d.ts.map