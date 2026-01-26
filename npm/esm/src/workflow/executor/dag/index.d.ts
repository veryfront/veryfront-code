/**
 * DAG Executor
 *
 * Executes workflow DAGs with proper dependency ordering and parallel execution.
 *
 * @module ai/workflow/executor/dag
 */
import type { WorkflowNode, WorkflowRun } from "../../types.js";
export type { DAGExecutionResult, DAGExecutorConfig, NodeExecutionResult } from "./types.js";
import type { DAGExecutionResult, DAGExecutorConfig } from "./types.js";
export declare class DAGExecutor {
    private config;
    constructor(config: DAGExecutorConfig);
    execute(nodes: WorkflowNode[], run: WorkflowRun, startFromNode?: string): Promise<DAGExecutionResult>;
    private executeNode;
    private executeStepNode;
    private executeParallelNode;
    private executeMapNode;
    private executeBranchNode;
    private executeWaitNode;
    private executeSubWorkflowNode;
    private executeLoopNode;
    private checkpoint;
}
//# sourceMappingURL=index.d.ts.map