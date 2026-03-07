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
import { NOT_SUPPORTED } from "#veryfront/errors";

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
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.createRun not implemented" });
  }

  getRun(_runId: string): Promise<WorkflowRun | null> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.getRun not implemented" });
  }

  updateRun(_runId: string, _patch: Partial<WorkflowRun>): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.updateRun not implemented" });
  }

  listRuns(_filter: RunFilter): Promise<WorkflowRun[]> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.listRuns not implemented" });
  }

  // Checkpointing
  saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.saveCheckpoint not implemented" });
  }

  getLatestCheckpoint(_runId: string): Promise<Checkpoint | null> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.getLatestCheckpoint not implemented" });
  }

  // Approvals
  savePendingApproval(_runId: string, _approval: PendingApproval): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.savePendingApproval not implemented" });
  }

  getPendingApprovals(_runId: string): Promise<PendingApproval[]> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.getPendingApprovals not implemented" });
  }

  updateApproval(
    _runId: string,
    _approvalId: string,
    _decision: ApprovalDecision,
  ): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.updateApproval not implemented" });
  }

  // Queue (using Cloudflare Queues)
  enqueue(_job: WorkflowJob): Promise<void> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.enqueue not implemented" });
  }

  dequeue(): Promise<WorkflowJob | null> {
    throw NOT_SUPPORTED.create({ detail: "CloudflareAdapter.dequeue not implemented" });
  }

  acknowledge(_runId: string): Promise<void> {
    return Promise.resolve();
  }

  // Lifecycle
  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
