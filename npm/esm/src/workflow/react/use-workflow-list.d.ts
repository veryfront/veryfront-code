import type { RunFilter, WorkflowRun, WorkflowStatus } from "../types.js";
export interface UseWorkflowListOptions {
    workflowId?: string;
    status?: WorkflowStatus | WorkflowStatus[];
    createdAfter?: Date;
    createdBefore?: Date;
    pageSize?: number;
    apiBase?: string;
    autoRefresh?: boolean;
    refreshInterval?: number;
}
export interface UseWorkflowListResult {
    runs: WorkflowRun[];
    totalCount?: number;
    isLoading: boolean;
    error: Error | null;
    hasMore: boolean;
    loadMore: () => Promise<void>;
    refresh: () => Promise<void>;
    setFilter: (filter: Partial<UseWorkflowListOptions>) => void;
    filter: RunFilter;
}
/**
 * List and filter workflow runs.
 */
export declare function useWorkflowList(options?: UseWorkflowListOptions): UseWorkflowListResult;
//# sourceMappingURL=use-workflow-list.d.ts.map