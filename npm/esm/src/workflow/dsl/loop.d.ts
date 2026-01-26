import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.js";
export interface LoopContext {
    iteration: number;
    totalIterations: number;
    previousResults: unknown[];
    isFirstIteration: boolean;
    isLastAllowedIteration: boolean;
}
export interface LoopOptions extends Omit<BaseNodeConfig, "checkpoint"> {
    while: (context: WorkflowContext, loop: LoopContext) => boolean | Promise<boolean>;
    steps: WorkflowNode[] | ((context: WorkflowContext, loop: LoopContext) => WorkflowNode[]);
    maxIterations?: number;
    onMaxIterations?: (context: WorkflowContext, loop: LoopContext) => Record<string, unknown> | Promise<Record<string, unknown>>;
    onComplete?: (context: WorkflowContext, loop: LoopContext) => Record<string, unknown> | Promise<Record<string, unknown>>;
    checkpoint?: boolean;
    retry?: RetryConfig;
    timeout?: string | number;
    iterationTimeout?: string | number;
    skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
    delay?: number | string;
}
export interface LoopNodeConfig {
    type: "loop";
    while: LoopOptions["while"];
    steps: LoopOptions["steps"];
    maxIterations: number;
    onMaxIterations?: LoopOptions["onMaxIterations"];
    onComplete?: LoopOptions["onComplete"];
    checkpoint: boolean;
    retry?: RetryConfig;
    timeout?: string | number;
    iterationTimeout?: string | number;
    skip?: LoopOptions["skip"];
    delay?: number | string;
}
export declare function loop(id: string, options: LoopOptions): WorkflowNode;
export declare function doWhile(id: string, options: Omit<LoopOptions, "while"> & {
    until: (context: WorkflowContext, loop: LoopContext) => boolean | Promise<boolean>;
}): WorkflowNode;
export declare function times(id: string, count: number, steps: WorkflowNode[], options?: Omit<LoopOptions, "while" | "steps" | "maxIterations">): WorkflowNode;
//# sourceMappingURL=loop.d.ts.map