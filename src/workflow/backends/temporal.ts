/**
 * Temporal Adapter - workflow execution backend for enterprise-grade, long-running workflows.
 * @see https://docs.temporal.io/
 */

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
  /** Temporal server address */
  address?: string;
  /** Temporal namespace */
  namespace?: string;
  /** Task queue name */
  taskQueue?: string;
  /** TLS configuration */
  tls?: {
    clientCertPath?: string;
    clientKeyPath?: string;
    serverRootCACertPath?: string;
  };
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Stub implementation - requires Temporal SDK and worker setup.
 */
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

  // Run Management
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

  // Checkpointing (Temporal handles this internally via event sourcing)
  saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void> {
    return Promise.resolve();
  }

  getLatestCheckpoint(_runId: string): Promise<Checkpoint | null> {
    throw new Error("TemporalAdapter.getLatestCheckpoint not implemented");
  }

  // Approvals
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

  // Queue (Temporal handles this internally)
  enqueue(_job: WorkflowJob): Promise<void> {
    throw new Error("TemporalAdapter.enqueue not implemented");
  }

  dequeue(): Promise<WorkflowJob | null> {
    throw new Error("TemporalAdapter.dequeue not implemented");
  }

  acknowledge(_runId: string): Promise<void> {
    return Promise.resolve();
  }

  // Lifecycle
  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
