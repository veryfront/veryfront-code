/****
 * DAG Executor Types
 *
 * Type definitions for DAG execution configuration and results.
 *
 * @module ai/workflow/executor/dag/types
 */

import type { NodeState, WaitNodeConfig, WorkflowContext } from "../../types.ts";
import type { CheckpointManager } from "../checkpoint-manager.ts";
import type { StepExecutor } from "../step-executor.ts";

/** Internal set/delete operations emitted by one node execution. */
export interface ContextPatch {
  set: Record<string, unknown>;
  delete: string[];
}

export interface DAGExecutorConfig {
  stepExecutor: StepExecutor;
  checkpointManager?: CheckpointManager;
  maxConcurrency?: number;
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
  /** Max milliseconds to wait for an aborted composite attempt to settle (default: 1000) */
  cancellationGracePeriod?: number;
  debug?: boolean;
}

export type DAGExecutorInternalConfig =
  & DAGExecutorConfig
  & Required<Pick<DAGExecutorConfig, "maxConcurrency" | "debug">>;

export interface DAGExecutionResult {
  completed: boolean;
  waiting: boolean;
  waitingNode?: string;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  error?: string;
}

/** Internal result used when a composite node executes a child graph. */
export interface DAGInternalExecutionResult extends DAGExecutionResult {
  contextPatch: ContextPatch;
}

export interface NodeExecutionResult {
  state: NodeState;
  contextPatch: ContextPatch;
  waiting: boolean;
}
