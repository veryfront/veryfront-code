import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowDefinition, WorkflowNode } from "../types.js";
export interface MapOptions extends Omit<BaseNodeConfig, "checkpoint"> {
    items: unknown[] | ((context: WorkflowContext) => unknown[] | Promise<unknown[]>);
    processor: WorkflowNode | WorkflowDefinition;
    concurrency?: number;
    checkpoint?: boolean;
    retry?: RetryConfig;
    timeout?: string | number;
    skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}
export declare function map(id: string, options: MapOptions): WorkflowNode;
//# sourceMappingURL=map.d.ts.map