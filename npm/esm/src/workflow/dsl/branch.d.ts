import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.js";
export interface BranchOptions extends Omit<BaseNodeConfig, "checkpoint"> {
    condition: (context: WorkflowContext) => boolean | Promise<boolean>;
    then: WorkflowNode[];
    else?: WorkflowNode[];
    checkpoint?: boolean;
    retry?: RetryConfig;
    timeout?: string | number;
    skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}
/** Create a conditional branch node. */
export declare function branch(id: string, options: BranchOptions): WorkflowNode;
/** Create a branch that only executes if condition is true (no else). */
export declare function when(id: string, condition: (context: WorkflowContext) => boolean | Promise<boolean>, nodes: WorkflowNode[]): WorkflowNode;
/** Create a branch that only executes if condition is false. */
export declare function unless(id: string, condition: (context: WorkflowContext) => boolean | Promise<boolean>, nodes: WorkflowNode[]): WorkflowNode;
//# sourceMappingURL=branch.d.ts.map