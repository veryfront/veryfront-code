import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.js";
export interface ParallelOptions extends Omit<BaseNodeConfig, "checkpoint"> {
    strategy?: "all" | "race" | "allSettled";
    checkpoint?: boolean;
    retry?: RetryConfig;
    timeout?: string | number;
    skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}
/** Create a parallel node for concurrent execution of multiple steps. */
export declare function parallel(id: string, nodes: WorkflowNode[], options?: ParallelOptions): WorkflowNode;
//# sourceMappingURL=parallel.d.ts.map