export interface UseWorkflowStartOptions {
    workflowId: string;
    apiBase?: string;
    onStart?: (runId: string) => void;
    onError?: (error: Error) => void;
}
export interface UseWorkflowStartResult<TInput = unknown> {
    start: (input: TInput) => Promise<string>;
    isStarting: boolean;
    lastRunId: string | null;
    error: Error | null;
    resetError: () => void;
}
export declare function useWorkflowStart<TInput = unknown>(options: UseWorkflowStartOptions): UseWorkflowStartResult<TInput>;
//# sourceMappingURL=use-workflow-start.d.ts.map