import type { BaseNodeConfig, WorkflowContext, WorkflowDefinition, WorkflowNode } from "../types.js";
export interface SubWorkflowOptions extends BaseNodeConfig {
    workflow: WorkflowDefinition;
    input?: unknown | ((context: WorkflowContext) => unknown);
    output?: (result: unknown) => unknown;
}
/** Create a sub-workflow node for nested execution. */
export declare function subWorkflow(id: string, options: SubWorkflowOptions): WorkflowNode;
//# sourceMappingURL=sub-workflow.d.ts.map