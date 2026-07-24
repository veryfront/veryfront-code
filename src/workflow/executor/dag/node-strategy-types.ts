import type { NodeState, WorkflowNode, WorkflowRun } from "../../types.ts";
import type { DAGInternalExecutionResult } from "./types.ts";

export interface ChildGraphExecutionOptions {
  maxConcurrency?: number;
}

export type ExecuteChildGraph = (
  nodes: WorkflowNode[],
  run: WorkflowRun,
  options?: ChildGraphExecutionOptions,
) => Promise<DAGInternalExecutionResult>;

export interface NodeStrategyRuntime {
  executeChildGraph: ExecuteChildGraph;
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  abortSignal?: AbortSignal;
}
