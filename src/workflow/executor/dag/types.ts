/****
 * DAG Executor Types
 *
 * Type definitions for DAG execution configuration and results.
 *
 * @module ai/workflow/executor/dag/types
 */

import type { NodeState, WaitNodeConfig, WorkflowContext } from "../../types.ts";
import type { WorkflowProjectionPath, WorkflowProjectionState } from "../../runtime-state.ts";
import type { CheckpointManager } from "../checkpoint-manager.ts";
import type { StepExecutor } from "../step-executor.ts";

/** Internal set/delete operations emitted by one node execution. */
export interface ContextPatch {
  set: Record<string, unknown>;
  delete: string[];
  /**
   * Exact public-projection ownership for every top-level slot whose value or
   * ownership changed. Projection-only changes are deliberately represented:
   * a user may replace a framework-owned value with a deep-equal clone.
   */
  projection: Record<string, WorkflowProjectionPath[]>;
}

export interface DAGExecutorConfig {
  stepExecutor: StepExecutor;
  checkpointManager?: CheckpointManager;
  maxConcurrency?: number;
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
  /** Non-negative safe-integer cleanup grace in portable timer range (default: 1000). */
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
  /** @internal Framework-only public projection ownership sidecar. */
  _workflowProjection?: WorkflowProjectionState;
}

/** Internal result used when a composite node executes a child graph. */
export interface DAGInternalExecutionResult extends DAGExecutionResult {
  contextPatch: ContextPatch;
  /** Partial composite context retained only for an enclosing immediate retry. */
  _retryContextPatch?: ContextPatch;
}

export interface NodeExecutionResult {
  state: NodeState;
  contextPatch: ContextPatch;
  waiting: boolean;
}
