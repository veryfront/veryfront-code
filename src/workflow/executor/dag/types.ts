/****
 * DAG Executor Types
 *
 * Type definitions for DAG execution configuration and results.
 *
 * @module ai/workflow/executor/dag/types
 */

import type { NodeState, WaitNodeConfig, WorkflowContext } from "../../types.ts";
import type { CheckpointManager, CheckpointOwnership } from "../checkpoint-manager.ts";
import type { StepExecutor } from "../step-executor.ts";

/** Internal set/delete operations emitted by one node execution. */
export interface ContextPatch {
  set: Record<string, unknown>;
  delete: string[];
}

/**
 * Facts that belong to the execution as a whole rather than to one graph.
 *
 * Composite nodes run their children against synthetic `WorkflowRun` records
 * that are never persisted, so a child graph can learn nothing about the real
 * run from the run it is handed. Anything a child graph must agree with the
 * root run about is threaded here instead of inferred from that record.
 */
export interface ExecutionScope {
  /**
   * The root, backend-persisted run id. Synthetic child runs carry generated
   * ids, so this is the only id a caller can actually look up -- span
   * correlation and recovery persistence must both use it.
   */
  rootRunId: string;
  /** Run id handed to step execution for run-scoped hooks. */
  executionRunId: string;
  /**
   * True when the root run is resuming from a decision it parked on, false when
   * it is recovering from a worker that died mid-node. A node recorded
   * `running` means something different in each case, and only the root run
   * record can tell them apart.
   */
  resumingWait: boolean;
  ownership?: CheckpointOwnership;
}

export interface DAGExecutorConfig {
  stepExecutor: StepExecutor;
  checkpointManager?: CheckpointManager;
  maxConcurrency?: number;
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
  onRecoveryScheduled?: (input: {
    runId: string;
    nodeId: string;
    nodeStates: Record<string, NodeState>;
    ownership?: CheckpointOwnership;
  }) => Promise<boolean | void> | boolean | void;
  /** Persist one root-run node-state boundary before execution can advance. */
  onNodeStatesChanged?: (input: {
    runId: string;
    nodeStates: Record<string, NodeState>;
    ownership?: CheckpointOwnership;
  }) => Promise<boolean | void> | boolean | void;
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
  /**
   * The node that actually suspended, when this node is a composite whose child
   * graph is waiting. An approval is built from `nodeStates[waitingNode].input`,
   * and a composite's own state has no `input`, so reporting the composite
   * instead of its inner wait means no approval is ever created.
   */
  waitingNode?: string;
}
