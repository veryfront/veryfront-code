/**
 * Cloudflare Adapter
 *
 * Adapter for using Cloudflare Durable Objects as the workflow backend.
 * Ideal for edge deployments on Cloudflare Workers.
 *
 * @see https://developers.cloudflare.com/durable-objects/
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
 * Cloudflare adapter configuration
 */
export interface CloudflareAdapterConfig extends BackendConfig {
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
 * Cloudflare Adapter
 *
 * Uses Cloudflare Durable Objects for workflow state and
 * Cloudflare Queues for job distribution.
 *
 * @example
 * ```typescript
 * // In your Cloudflare Worker
 * import { CloudflareAdapter } from 'veryfront/ai/workflow/backends/cloudflare';
 *
 * export default {
 *   async fetch(request, env) {
 *     const backend = new CloudflareAdapter({
 *       durableObjectBinding: 'WORKFLOW_DO',
 *       kvBinding: 'WORKFLOW_KV',
 *       queueBinding: 'WORKFLOW_QUEUE',
 *     });
 *
 *     // Use backend...
 *   }
 * }
 * ```
 *
 * @note This is a stub implementation. Full implementation requires
 * Cloudflare Workers environment bindings.
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

    console.warn(
      "[CloudflareAdapter] This is a stub implementation. " +
      "Full Cloudflare integration requires Workers environment bindings. " +
      "See: https://developers.cloudflare.com/durable-objects/",
    );
  }

  // Run Management
  createRun(_run: WorkflowRun): Promise<void> {
    // This would create/get a Durable Object instance for the run
    throw new Error("CloudflareAdapter.createRun not implemented");
  }

  getRun(_runId: string): Promise<WorkflowRun | null> {
    // This would fetch state from the Durable Object
    throw new Error("CloudflareAdapter.getRun not implemented");
  }

  updateRun(_runId: string, _patch: Partial<WorkflowRun>): Promise<void> {
    // This would update state in the Durable Object
    throw new Error("CloudflareAdapter.updateRun not implemented");
  }

  listRuns(_filter: RunFilter): Promise<WorkflowRun[]> {
    // This would query KV for run indexes
    throw new Error("CloudflareAdapter.listRuns not implemented");
  }

  // Checkpointing
  saveCheckpoint(_runId: string, _checkpoint: Checkpoint): Promise<void> {
    // This would persist checkpoint to the Durable Object
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
    // This would send a message to Cloudflare Queue
    throw new Error("CloudflareAdapter.enqueue not implemented");
  }

  dequeue(): Promise<WorkflowJob | null> {
    // Cloudflare Queues use push model, not pull
    throw new Error("CloudflareAdapter.dequeue not implemented");
  }

  acknowledge(_runId: string): Promise<void> {
    // Cloudflare Queues handle acknowledgment differently
    return Promise.resolve();
  }

  // Lifecycle
  destroy(): Promise<void> {
    // No cleanup needed - Cloudflare manages lifecycle
    return Promise.resolve();
  }
}
