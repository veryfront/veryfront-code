import type { NodeStatus, WorkflowRun, WorkflowStatus } from "#veryfront/workflow/types.ts";

/** Data-minimized state for one workflow node on the built-in HTTP surface. */
export interface WorkflowNodeStateSummary {
  nodeId: string;
  status: NodeStatus;
  attempt: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

/** Data-minimized pending approval on the built-in HTTP surface. */
export interface WorkflowApprovalSummary {
  id: string;
  nodeId: string;
  status: "pending";
  message: string;
  requestedAt: string;
  expiresAt?: string;
}

/** Data-minimized workflow run returned by the built-in HTTP and React surfaces. */
export interface WorkflowRunSummary {
  id: string;
  workflowId: string;
  version?: string;
  status: WorkflowStatus;
  currentNodes: string[];
  nodeStates: Record<string, WorkflowNodeStateSummary>;
  pendingApprovals: WorkflowApprovalSummary[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: { message: string; nodeId?: string };
}

function defineRecordEntry<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

/** Project a durable run into the allowlisted built-in HTTP response. */
export function projectWorkflowRunSummary(run: WorkflowRun): WorkflowRunSummary {
  const nodeStates: Record<string, WorkflowNodeStateSummary> = {};
  for (const [nodeId, state] of Object.entries(run.nodeStates ?? {})) {
    if (!state) continue;
    const startedAt = state.startedAt;
    const completedAt = state.completedAt;
    const error = state.error;
    defineRecordEntry(nodeStates, nodeId, {
      nodeId: state.nodeId,
      status: state.status,
      attempt: state.attempt,
      ...(startedAt ? { startedAt: startedAt.toISOString() } : {}),
      ...(completedAt ? { completedAt: completedAt.toISOString() } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  }

  const pendingApprovals: WorkflowApprovalSummary[] = [];
  for (const approval of run.pendingApprovals ?? []) {
    if (approval.status !== "pending") continue;
    const expiresAt = approval.expiresAt;
    pendingApprovals.push({
      id: approval.id,
      nodeId: approval.nodeId,
      status: "pending",
      message: approval.message,
      requestedAt: approval.requestedAt.toISOString(),
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
    });
  }

  const version = run.version;
  const startedAt = run.startedAt;
  const completedAt = run.completedAt;
  const error = run.error;
  const errorNodeId = error?.nodeId;
  return {
    id: run.id,
    workflowId: run.workflowId,
    ...(version !== undefined ? { version } : {}),
    status: run.status,
    currentNodes: [...(run.currentNodes ?? [])],
    nodeStates,
    pendingApprovals,
    createdAt: run.createdAt.toISOString(),
    ...(startedAt ? { startedAt: startedAt.toISOString() } : {}),
    ...(completedAt ? { completedAt: completedAt.toISOString() } : {}),
    ...(error
      ? {
        error: {
          message: error.message,
          ...(errorNodeId !== undefined ? { nodeId: errorNodeId } : {}),
        },
      }
      : {}),
  };
}
