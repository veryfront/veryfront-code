import { logger } from "#veryfront/utils";
import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowJob,
  WorkflowRun,
} from "../types.ts";
import type { BackendConfig, WorkflowBackend } from "./types.ts";

interface CloudflareAdapterConfig extends BackendConfig {
  /** Durable Object namespace binding name */
  durableObjectBinding?: string;
  /** KV namespace binding name (for auxiliary storage) */
  kvBinding?: string;
  /** Queue binding name (for job queue) */
  queueBinding?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Stub implementation - requires Cloudflare Workers environment bindings.
 */
export class CloudflareAdapter implements WorkflowBackend {
  private config: CloudflareAdapterConfig;

  constructor(config: CloudflareAdapterConfig = {}) {
    this.config = {
      durableObjectBinding: "WORKFLOW_DO",
      kvBinding: "WORKFLOW_KV",
      queueBinding: "WORKFLOW_QUEUE",
      debug: false,
      ...config,
    };

    logger.warn(
      "[CloudflareAdapter] Stub implementation - requires Workers environment bindings",
    );
  }

  // Run Management
  createRun(_run: WorkflowRun): Promise<void> {
    throw new Error("CloudflareAdapter.createRun not implemented");
  }

  getRun(_runId: string): Promise<WorkflowRun | null> {
    throw new Error("CloudflareAdapter.getRun not implemented");
  }

  updateRun(_runId: string, _patch: Partial<WorkflowRun>): Promise<void> {
    throw new Error("CloudflareAdapter.updateRun not implemented");
  }

  listRuns(_filter: RunFilter): Promise<WorkflowRun[]> {
    throw new Error("CloudflareAdapter.listRuns not implemented");
  }

  // Checkpointing
  saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void> {
    throw new Error("CloudflareAdapter.saveCheckpoint not implemented");
  }

  getLatestCheckpoint(_runId: string): Promise<Checkpoint | null> {
    throw new Error("CloudflareAdapter.getLatestCheckpoint not implemented");
  }

  // Approvals
  savePendingApproval(_runId: string, _approval: PendingApproval): Promise<void> {
    throw new Error("CloudflareAdapter.savePendingApproval not implemented");
  }

  getPendingApprovals(_runId: string): Promise<PendingApproval[]> {
    throw new Error("CloudflareAdapter.getPendingApprovals not implemented");
  }

  updateApproval(
    _runId: string,
    _approvalId: string,
    _decision: ApprovalDecision,
  ): Promise<void> {
    throw new Error("CloudflareAdapter.updateApproval not implemented");
  }

  // Queue (using Cloudflare Queues)
  enqueue(_job: WorkflowJob): Promise<void> {
    throw new Error("CloudflareAdapter.enqueue not implemented");
  }

  dequeue(): Promise<WorkflowJob | null> {
    throw new Error("CloudflareAdapter.dequeue not implemented");
  }

  acknowledge(_runId: string): Promise<void> {
    return Promise.resolve();
  }

  // Lifecycle
  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
