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

export interface DAGExecutorConfig {
  stepExecutor: StepExecutor;
  checkpointManager?: CheckpointManager;
  maxConcurrency?: number;
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
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

export interface NodeExecutionResult {
  state: NodeState;
  contextUpdates: Record<string, unknown>;
  waiting: boolean;
}
