/**
 * Inngest Adapter
 *
 * Adapter for using Inngest as the workflow execution backend.
 * Inngest is ideal for serverless deployments (Vercel, Cloudflare, etc.)
 *
 * @see https://www.inngest.com/docs
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

/**
 * Inngest adapter configuration
 */
export interface InngestAdapterConfig extends BackendConfig {
  /** Inngest event key */
  eventKey?: string;
  /** Inngest signing key (for production) */
  signingKey?: string;
  /** Inngest API base URL (for self-hosted) */
  baseUrl?: string;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Inngest Adapter
 *
 * Translates Veryfront workflow operations to Inngest functions.
 *
 * @example
 * ```typescript
 * import { InngestAdapter } from 'veryfront/ai/workflow/backends/inngest';
 *
 * const backend = new InngestAdapter({
 *   eventKey: process.env.INNGEST_EVENT_KEY,
 *   signingKey: process.env.INNGEST_SIGNING_KEY,
 * });
 * ```
 *
 * @note This is a stub implementation. Full implementation requires
 * the Inngest SDK and server-side setup.
 */
export class InngestAdapter implements WorkflowBackend {
  private config: InngestAdapterConfig;

  constructor(config: InngestAdapterConfig = {}) {
    this.config = {
      debug: false,
      ...config,
    };

    console.warn(
      "[InngestAdapter] This is a stub implementation. " +
      "Full Inngest integration requires additional setup. " +
      "See: https://www.inngest.com/docs",
    );
  }

  // Run Management
  createRun(_run: WorkflowRun): Promise<void> {
    throw new Error("InngestAdapter.createRun not implemented");
  }

  getRun(_runId: string): Promise<WorkflowRun | null> {
    throw new Error("InngestAdapter.getRun not implemented");
  }

  updateRun(_runId: string, _patch: Partial<WorkflowRun>): Promise<void> {
    throw new Error("InngestAdapter.updateRun not implemented");
  }

  listRuns(_filter: RunFilter): Promise<WorkflowRun[]> {
    throw new Error("InngestAdapter.listRuns not implemented");
  }

  // Checkpointing
  saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void> {
    throw new Error("InngestAdapter.saveCheckpoint not implemented");
  }

  getLatestCheckpoint(_runId: string): Promise<Checkpoint | null> {
    throw new Error("InngestAdapter.getLatestCheckpoint not implemented");
  }

  // Approvals
  savePendingApproval(_runId: string, _approval: PendingApproval): Promise<void> {
    throw new Error("InngestAdapter.savePendingApproval not implemented");
  }

  getPendingApprovals(_runId: string): Promise<PendingApproval[]> {
    throw new Error("InngestAdapter.getPendingApprovals not implemented");
  }

  updateApproval(
    _runId: string,
    _approvalId: string,
    _decision: ApprovalDecision,
  ): Promise<void> {
    throw new Error("InngestAdapter.updateApproval not implemented");
  }

  // Queue (Inngest handles this internally)
  enqueue(_job: WorkflowJob): Promise<void> {
    // Inngest uses events instead of queues
    // This would send an Inngest event
    throw new Error("InngestAdapter.enqueue not implemented");
  }

  dequeue(): Promise<WorkflowJob | null> {
    // Inngest handles job scheduling internally
    throw new Error("InngestAdapter.dequeue not implemented");
  }

  acknowledge(_runId: string): Promise<void> {
    // Inngest handles acknowledgment internally
    return Promise.resolve();
  }

  // Lifecycle
  destroy(): Promise<void> {
    // No cleanup needed for Inngest
    return Promise.resolve();
  }
}
