
import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowJob,
  WorkflowRun,
} from "../types.ts";
import type { BackendConfig, WorkflowBackend } from "./types.ts";

export interface CloudflareAdapterConfig extends BackendConfig {
  durableObjectBinding?: string;
  kvBinding?: string;
  queueBinding?: string;
  debug?: boolean;
}

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

    console.warn(
      "[CloudflareAdapter] This is a stub implementation. " +
        "Full Cloudflare integration requires Workers environment bindings. " +
        "See: https://developers.cloudflare.com/durable-objects/",
    );
  }

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

  saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void> {
    throw new Error("CloudflareAdapter.saveCheckpoint not implemented");
  }

  getLatestCheckpoint(_runId: string): Promise<Checkpoint | null> {
    throw new Error("CloudflareAdapter.getLatestCheckpoint not implemented");
  }

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

  enqueue(_job: WorkflowJob): Promise<void> {
    throw new Error("CloudflareAdapter.enqueue not implemented");
  }

  dequeue(): Promise<WorkflowJob | null> {
    throw new Error("CloudflareAdapter.dequeue not implemented");
  }

  acknowledge(_runId: string): Promise<void> {
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    return Promise.resolve();
  }
}
