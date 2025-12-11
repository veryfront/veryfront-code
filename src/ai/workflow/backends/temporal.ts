
import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowJob,
  WorkflowRun,
} from "../types.ts";
import type { BackendConfig, WorkflowBackend } from "./types.ts";

export interface TemporalAdapterConfig extends BackendConfig {
  address?: string;
  namespace?: string;
  taskQueue?: string;
  tls?: {
    clientCertPath?: string;
    clientKeyPath?: string;
    serverRootCACertPath?: string;
  };
  debug?: boolean;
}

export class TemporalAdapter implements WorkflowBackend {
  private config: TemporalAdapterConfig;

  constructor(config: TemporalAdapterConfig = {}) {
    this.config = {
      address: "localhost:7233",
      namespace: "default",
      taskQueue: "veryfront-workflows",
      debug: false,
      ...config,
    };

    console.warn(
      "[TemporalAdapter] This is a stub implementation. " +
        "Full Temporal integration requires the Temporal SDK and worker setup. " +
        "See: https://docs.temporal.io/",
    );
  }

  createRun(_run: WorkflowRun): Promise<void> {
    throw new Error("TemporalAdapter.createRun not implemented");
  }

  getRun(_runId: string): Promise<WorkflowRun | null> {
    throw new Error("TemporalAdapter.getRun not implemented");
  }

  updateRun(_runId: string, _patch: Partial<WorkflowRun>): Promise<void> {
    throw new Error("TemporalAdapter.updateRun not implemented");
  }

  listRuns(_filter: RunFilter): Promise<WorkflowRun[]> {
    throw new Error("TemporalAdapter.listRuns not implemented");
  }

  saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void> {
    return Promise.resolve();
  }

  getLatestCheckpoint(_runId: string): Promise<Checkpoint | null> {
    throw new Error("TemporalAdapter.getLatestCheckpoint not implemented");
  }

  savePendingApproval(_runId: string, _approval: PendingApproval): Promise<void> {
    throw new Error("TemporalAdapter.savePendingApproval not implemented");
  }

  getPendingApprovals(_runId: string): Promise<PendingApproval[]> {
    throw new Error("TemporalAdapter.getPendingApprovals not implemented");
  }

  updateApproval(
    _runId: string,
    _approvalId: string,
    _decision: ApprovalDecision,
  ): Promise<void> {
    throw new Error("TemporalAdapter.updateApproval not implemented");
  }

  enqueue(_job: WorkflowJob): Promise<void> {
    throw new Error("TemporalAdapter.enqueue not implemented");
  }

  dequeue(): Promise<WorkflowJob | null> {
    throw new Error("TemporalAdapter.dequeue not implemented");
  }

  acknowledge(_runId: string): Promise<void> {
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
