/**
 * DAG Executor Interface
 *
 * Interface for DAG execution to avoid circular dependencies
 * between handlers and the executor.
 */

import type { NodeState, WorkflowContext, WorkflowNode, WorkflowRun } from "../../types.ts";

/**
 * Result of DAG execution (subset of DAGExecutionResult)
 */
export interface DAGSubExecutionResult {
  completed: boolean;
  waiting: boolean;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  error?: string;
}

/**
 * Interface for executing sub-DAGs (parallel branches, conditional branches).
 *
 * This allows handlers to execute child nodes without directly
 * depending on DAGExecutor, avoiding circular dependencies.
 */
export interface IDAGSubExecutor {
  /**
   * Execute a set of nodes as a sub-DAG.
   *
   * @param nodes - The child nodes to execute
   * @param parentRun - Parent workflow run context
   * @returns Execution result
   */
  executeSubDAG(
    nodes: WorkflowNode[],
    parentRun: WorkflowRun,
  ): Promise<DAGSubExecutionResult>;
}
