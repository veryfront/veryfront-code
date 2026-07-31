import type {
  NodeState,
  WorkflowContext,
  WorkflowGraphAdmission,
  WorkflowNode,
  WorkflowRun,
} from "../../types.ts";
import type { DAGInternalExecutionResult } from "./types.ts";
import type { WorkflowProjectionState } from "../../runtime-state.ts";

export interface CheckpointResumeSnapshot {
  readonly ownerNodeId: string;
  readonly context: WorkflowContext;
  readonly nodeStates: Record<string, NodeState>;
  readonly workflowProjection: WorkflowProjectionState;
  /** Attached only by the root transform after every composite wrapper runs. */
  readonly graphAdmission?: WorkflowGraphAdmission;
}

export type CheckpointResumeTransform = (
  snapshot: CheckpointResumeSnapshot,
) => CheckpointResumeSnapshot;

export interface ChildGraphExecutionOptions {
  maxConcurrency?: number;
  identityPrefix?: string;
  abortSignal?: AbortSignal;
  checkpointResumeTransform?: CheckpointResumeTransform;
}

export type ExecuteChildGraph = (
  nodes: WorkflowNode[],
  run: WorkflowRun,
  options?: ChildGraphExecutionOptions,
) => Promise<DAGInternalExecutionResult>;

export interface NodeStrategyRuntime {
  executeChildGraph: ExecuteChildGraph;
  /** Persist a synthetic composite-admission boundary before child effects. */
  persistCheckpoint?: (
    nodeId: string,
    context: WorkflowContext,
    workflowProjection: WorkflowProjectionState,
    nodeStates: Record<string, NodeState>,
    checkpointResumeTransform?: CheckpointResumeTransform,
  ) => Promise<void>;
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  abortSignal?: AbortSignal;
  cancellationGracePeriod?: number;
}
