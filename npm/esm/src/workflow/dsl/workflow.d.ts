/**************************
 * Workflow DSL Builder
 *
 * Main factory function for creating durable workflows
 **************************/
import type { z } from "zod";
import type { RetryConfig, StepBuilderContext, Workflow, WorkflowContext, WorkflowNode } from "../types.js";
export type { Workflow } from "../types.js";
export interface WorkflowOptions<TInput = unknown, TOutput = unknown> {
    id: string;
    description?: string;
    version?: string;
    inputSchema?: z.ZodSchema<TInput>;
    outputSchema?: z.ZodSchema<TOutput>;
    retry?: RetryConfig;
    timeout?: string | number;
    introspect?: boolean;
    steps: WorkflowNode[] | ((context: StepBuilderContext<TInput>) => WorkflowNode[]);
    onError?: (error: Error, context: WorkflowContext) => void | Promise<void>;
    onComplete?: (result: TOutput, context: WorkflowContext) => void | Promise<void>;
}
export declare function workflow<TInput = unknown, TOutput = unknown>(options: WorkflowOptions<TInput, TOutput>): Workflow<TInput, TOutput>;
export declare function sequence(...nodes: WorkflowNode[]): WorkflowNode[];
export declare function dag(nodes: Record<string, WorkflowNode | {
    node: WorkflowNode;
    dependsOn: string[];
}>): WorkflowNode[];
export declare function dependsOn(node: WorkflowNode, ...dependencies: string[]): WorkflowNode;
//# sourceMappingURL=workflow.d.ts.map