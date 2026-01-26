import type { NodeState, PendingApproval, WorkflowRun, WorkflowStatus } from "../types.js";
export interface UseWorkflowOptions {
    runId: string;
    apiBase?: string;
    pollInterval?: number;
    autoRefresh?: boolean;
    onStatusChange?: (status: WorkflowStatus, previousStatus: WorkflowStatus) => void;
    onComplete?: (run: WorkflowRun) => void;
    onError?: (error: Error, run?: WorkflowRun) => void;
    onApprovalRequired?: (approval: PendingApproval) => void;
}
export interface UseWorkflowResult {
    run: WorkflowRun | null;
    status: WorkflowStatus;
    progress: number;
    currentNodes: string[];
    nodeStates: Record<string, NodeState>;
    pendingApprovals: PendingApproval[];
    refresh: () => Promise<void>;
    cancel: () => Promise<void>;
    retry: () => Promise<void>;
    isLoading: boolean;
    error: Error | null;
}
export declare function useWorkflow(options: UseWorkflowOptions): UseWorkflowResult;
//# sourceMappingURL=use-workflow.d.ts.map