
import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowJob,
  WorkflowRun,
  WorkflowStatus as _WorkflowStatus,
} from "../types.ts";

export interface BackendConfig {
  url?: string;
  prefix?: string;
  defaultTtl?: number;
  debug?: boolean;
}

export interface Lock {
  lockId: string;
  runId: string;
  acquiredAt: Date;
  expiresAt: Date;
}

export interface WorkflowBackend {

  createRun(run: WorkflowRun): Promise<void>;

  getRun(runId: string): Promise<WorkflowRun | null>;

  updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void>;

  deleteRun?(runId: string): Promise<void>;

  listRuns(filter: RunFilter): Promise<WorkflowRun[]>;

  countRuns?(filter: RunFilter): Promise<number>;


  saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void>;

  getLatestCheckpoint(runId: string): Promise<Checkpoint | null>;

  getCheckpoints?(runId: string): Promise<Checkpoint[]>;

  deleteCheckpoint?(runId: string, checkpointId: string): Promise<void>;

  deleteCheckpoints?(runId: string, checkpointIds: string[]): Promise<void>;


  savePendingApproval(
    runId: string,
    approval: PendingApproval,
  ): Promise<void>;

  getPendingApprovals(runId: string): Promise<PendingApproval[]>;

  getPendingApproval?(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null>;

  updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void>;

  listPendingApprovals?(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>>;


  enqueue?(job: WorkflowJob): Promise<void>;

  dequeue?(): Promise<WorkflowJob | null>;

  acknowledge?(runId: string): Promise<void>;

  nack?(runId: string): Promise<void>;


  acquireLock?(runId: string, duration: number): Promise<boolean>;

  releaseLock?(runId: string): Promise<void>;

  extendLock?(runId: string, duration: number): Promise<boolean>;

  isLocked?(runId: string): Promise<boolean>;


  publishEvent?(
    eventName: string,
    payload: unknown,
    options?: {
      runId?: string;
      workflowId?: string;
    },
  ): Promise<void>;

  subscribeEvents?(runId: string): AsyncIterable<{
    eventName: string;
    payload: unknown;
    timestamp: Date;
  }>;


  initialize?(): Promise<void>;

  healthCheck?(): Promise<boolean>;

  destroy(): Promise<void>;
}

export function hasQueueSupport(
  backend: WorkflowBackend,
): backend is
  & WorkflowBackend
  & Required<Pick<WorkflowBackend, "enqueue" | "dequeue" | "acknowledge">> {
  return (
    typeof backend.enqueue === "function" &&
    typeof backend.dequeue === "function" &&
    typeof backend.acknowledge === "function"
  );
}

export function hasLockSupport(
  backend: WorkflowBackend,
): backend is WorkflowBackend & Required<Pick<WorkflowBackend, "acquireLock" | "releaseLock">> {
  return (
    typeof backend.acquireLock === "function" &&
    typeof backend.releaseLock === "function"
  );
}

export function hasEventSupport(
  backend: WorkflowBackend,
): backend is
  & WorkflowBackend
  & Required<Pick<WorkflowBackend, "publishEvent" | "subscribeEvents">> {
  return (
    typeof backend.publishEvent === "function" &&
    typeof backend.subscribeEvents === "function"
  );
}
