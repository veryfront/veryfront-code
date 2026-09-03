/****
 * DAG Executor Types
 *
 * Type definitions for DAG execution configuration and results.
 *
 * @module ai/workflow/executor/dag/types
 */

import type { VeryfrontError } from "#veryfront/errors";
import type { NodeState, WaitNodeConfig, WorkflowContext } from "../../types.ts";
import type { CheckpointManager, CheckpointOwnership } from "../checkpoint-manager.ts";
import type { StepExecutor } from "../step-executor.ts";
import type { RecordPatch } from "./context-patch.ts";

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
  /** Declared node ids in this graph and every graph that contains it. */
  declaredNodeIds: ReadonlySet<string>;
  /** Child node ids owned by each sub-workflow node, preventing sibling state leakage. */
  subWorkflowNodeIds: Map<string, Set<string>>;
  /** Child node ids reserved before concurrent sub-workflow execution begins. */
  subWorkflowNodeReservations: Map<string, Set<string>>;
  /** Sub-workflow node owning each reservation path. */
  subWorkflowReservationOwners: Map<string, string>;
  /** Slash-safe encoded owner path of the graph currently being executed. */
  subWorkflowPath: string;
  /**
   * True while every enclosing composite carries its child states back into
   * the root run's node-state map (parallel, branch, subWorkflow, map). Loop
   * iterations keep children in a private iteration snapshot instead, so
   * their keys must never be merge-written into the root map -- no later
   * publish would delete them.
   */
  rootKeyspace: boolean;
  ownership?: CheckpointOwnership;
}

export interface DAGExecutorConfig {
  stepExecutor: StepExecutor;
  checkpointManager?: CheckpointManager;
  maxConcurrency?: number;
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
  /**
   * Persist one root-run node-state boundary before execution can advance.
   *
   * `currentNodes` names the top-level nodes the run is occupied with at that
   * boundary: the whole batch as it enters, and only the nodes still running
   * (a parked wait, or a composite enclosing one) or failed once it settles.
   *
   * The batch-entry boundary is also the sole durable commit for crash
   * recovery: a recovered node's raised attempt is only in this write, so
   * returning `false` (ownership lost) must leave nothing durably spent.
   */
  onNodeStatesChanged?: (input: {
    runId: string;
    nodeStates: Record<string, NodeState>;
    nodeStatePatch: RecordPatch<NodeState>;
    currentNodes: string[];
    context: WorkflowContext;
    contextPatch: ContextPatch;
    ownership?: CheckpointOwnership;
  }) => Promise<boolean | void> | boolean | void;
  /**
   * Durably charge a recovered child-graph node before it executes.
   *
   * A composite's children run against a synthetic run with no backend row,
   * so their raised attempts would otherwise reach the backend only after the
   * child side effect ran. The patch carries only the admitted recovered
   * nodes and must be applied as a key merge into the root run's node-state
   * map -- never as a replacement. Returning `false` (ownership lost) aborts
   * before the child executes; returning nothing skips durability on
   * backends without key-merge support.
   */
  onChildRecoveryAdmitted?: (input: {
    runId: string;
    nodeStatePatch: RecordPatch<NodeState>;
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
  /** Exact config of the node that suspended this execution. */
  waitingConfig?: WaitNodeConfig;
  /**
   * Every node the settled batch parked, in index order, when the graph is
   * waiting. Dependency-free waits suspend together in one batch, and each
   * needs its own durable record; `waitingNode` is always the first entry.
   */
  waitingNodes?: ReadonlyArray<{ nodeId: string; waitConfig?: WaitNodeConfig }>;
  /**
   * The wait node this graph found nothing to schedule behind, when every other
   * unfinished node is merely blocked on it.
   *
   * Set alongside `error`, because the graph alone cannot tell a run parked on
   * a decision that can still arrive from one whose decision was lost: both
   * look like a wait recorded `running`. A caller that can read the durable
   * approval or event-wait record decides which it is.
   */
  stalledWaitNode?: string;
  /** Every running wait in a graph that found nothing left to schedule. */
  stalledWaitNodes?: ReadonlyArray<{ nodeId: string; waitConfig: WaitNodeConfig }>;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  error?: string;
  /**
   * Registry-typed cause for a refusal reported through `error` rather than
   * thrown, so a caller classifying failures by slug sees the same kind of
   * error it would have seen from a throw. Set only where the states and
   * context patch earlier batches produced must still be returned.
   */
  errorCause?: VeryfrontError;
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
  /** Exact config of the node that suspended this execution. */
  waitingConfig?: WaitNodeConfig;
  /** Every nested wait parked by a composite child graph. */
  waitingNodes?: ReadonlyArray<{ nodeId: string; waitConfig?: WaitNodeConfig }>;
}
