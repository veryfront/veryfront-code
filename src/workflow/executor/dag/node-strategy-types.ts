import type { NodeState, WorkflowNode, WorkflowRun } from "../../types.ts";
import type { DAGExecutionResult } from "./types.ts";

export interface ChildGraphExecutionOptions {
  maxConcurrency?: number;
}

export type ExecuteChildGraph = (
  nodes: WorkflowNode[],
  run: WorkflowRun,
  options?: ChildGraphExecutionOptions,
) => Promise<DAGExecutionResult>;

export interface NodeStrategyRuntime {
  executeChildGraph: ExecuteChildGraph;
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
}
