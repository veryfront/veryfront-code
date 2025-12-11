
import type { NodeState, WorkflowContext, WorkflowNode, WorkflowRun } from "../../types.ts";

export interface DAGSubExecutionResult {
  completed: boolean;
  waiting: boolean;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  error?: string;
}

export interface IDAGSubExecutor {
  executeSubDAG(
    nodes: WorkflowNode[],
    parentRun: WorkflowRun,
  ): Promise<DAGSubExecutionResult>;
}
