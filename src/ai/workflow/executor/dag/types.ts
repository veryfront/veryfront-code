/**
 * DAG Executor Types
 *
 * Type definitions for DAG execution configuration and results.
 *
 * @module ai/workflow/executor/dag/types
 */

import type { NodeState, WaitNodeConfig, WorkflowContext } from "../../types.ts";
import type { StepExecutor } from "../step-executor.ts";
import type { CheckpointManager } from "../checkpoint-manager.ts";

/**
 * DAG executor configuration
 */
export interface DAGExecutorConfig {
  /** Step executor for running individual steps */
  stepExecutor: StepExecutor;
  /** Checkpoint manager for durability */
  checkpointManager?: CheckpointManager;
  /** Maximum concurrent parallel executions */
  maxConcurrency?: number;
  /** Callback when node execution starts */
  onNodeStart?: (nodeId: string) => void;
  /** Callback when node execution completes */
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  /** Callback when waiting for approval/event */
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Internal config type with required defaults
 */
export type DAGExecutorInternalConfig = Required<
  Pick<DAGExecutorConfig, "maxConcurrency" | "debug">
> &
  DAGExecutorConfig;

/**
 * Result of DAG execution
 */
export interface DAGExecutionResult {
  /** Whether the DAG completed successfully */
  completed: boolean;
  /** Whether the DAG is waiting (for approval/event) */
  waiting: boolean;
  /** Node that is waiting (if waiting) */
  waitingNode?: string;
  /** Final context after execution */
  context: WorkflowContext;
  /** Final node states */
  nodeStates: Record<string, NodeState>;
  /** Error if failed */
  error?: string;
}

/**
 * Result of executing a single node
 */
export interface NodeExecutionResult {
  /** Final state of the node */
  state: NodeState;
  /** Context updates from this node */
  contextUpdates: Record<string, unknown>;
  /** Whether the node is waiting for external input */
  waiting: boolean;
}
