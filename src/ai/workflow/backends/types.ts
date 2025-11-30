/**
 * Workflow Backend Interface
 *
 * Defines the contract for workflow persistence and execution backends.
 * Implementations can be:
 * - MemoryBackend (development)
 * - RedisBackend (production)
 * - TemporalAdapter (enterprise)
 * - InngestAdapter (serverless)
 * - CloudflareAdapter (edge)
 */

import type {
  ApprovalDecision,
  Checkpoint,
  PendingApproval,
  RunFilter,
  WorkflowJob,
  WorkflowRun,
  WorkflowStatus as _WorkflowStatus,
} from "../types.ts";

/**
 * Backend configuration options
 */
export interface BackendConfig {
  /** Connection URL (for Redis, Postgres, etc.) */
  url?: string;
  /** Key prefix for namespacing */
  prefix?: string;
  /** Default TTL for runs (in milliseconds) */
  defaultTtl?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Lock information for distributed execution
 */
export interface Lock {
  /** Lock identifier */
  lockId: string;
  /** Run ID that owns the lock */
  runId: string;
  /** When lock was acquired */
  acquiredAt: Date;
  /** When lock expires */
  expiresAt: Date;
}

/**
 * Workflow backend interface
 *
 * All backend implementations must implement this interface.
 * Optional methods (marked with ?) can be omitted for simpler backends.
 */
export interface WorkflowBackend {
  // =========================================================================
  // Run Management
  // =========================================================================

  /**
   * Create a new workflow run
   */
  createRun(run: WorkflowRun): Promise<void>;

  /**
   * Get a workflow run by ID
   */
  getRun(runId: string): Promise<WorkflowRun | null>;

  /**
   * Update a workflow run
   */
  updateRun(runId: string, patch: Partial<WorkflowRun>): Promise<void>;

  /**
   * Delete a workflow run
   */
  deleteRun?(runId: string): Promise<void>;

  /**
   * List workflow runs with optional filters
   */
  listRuns(filter: RunFilter): Promise<WorkflowRun[]>;

  /**
   * Count workflow runs matching filter
   */
  countRuns?(filter: RunFilter): Promise<number>;

  // =========================================================================
  // Checkpointing
  // =========================================================================

  /**
   * Save a checkpoint for a workflow run
   */
  saveCheckpoint(runId: string, checkpoint: Checkpoint): Promise<void>;

  /**
   * Get the latest checkpoint for a workflow run
   */
  getLatestCheckpoint(runId: string): Promise<Checkpoint | null>;

  /**
   * Get all checkpoints for a workflow run
   */
  getCheckpoints?(runId: string): Promise<Checkpoint[]>;

  /**
   * Delete a specific checkpoint
   */
  deleteCheckpoint?(runId: string, checkpointId: string): Promise<void>;

  /**
   * Delete multiple checkpoints by ID
   */
  deleteCheckpoints?(runId: string, checkpointIds: string[]): Promise<void>;

  // =========================================================================
  // Approvals
  // =========================================================================

  /**
   * Save a pending approval request
   */
  savePendingApproval(
    runId: string,
    approval: PendingApproval,
  ): Promise<void>;

  /**
   * Get all pending approvals for a workflow run
   */
  getPendingApprovals(runId: string): Promise<PendingApproval[]>;

  /**
   * Get a specific pending approval
   */
  getPendingApproval?(
    runId: string,
    approvalId: string,
  ): Promise<PendingApproval | null>;

  /**
   * Update an approval with a decision
   */
  updateApproval(
    runId: string,
    approvalId: string,
    decision: ApprovalDecision,
  ): Promise<void>;

  /**
   * List all pending approvals across workflows
   */
  listPendingApprovals?(filter?: {
    workflowId?: string;
    approver?: string;
    status?: "pending" | "expired";
  }): Promise<Array<{ runId: string; approval: PendingApproval }>>;

  // =========================================================================
  // Queue Operations (optional - for distributed execution)
  // =========================================================================

  /**
   * Enqueue a workflow job for processing
   */
  enqueue?(job: WorkflowJob): Promise<void>;

  /**
   * Dequeue the next workflow job
   */
  dequeue?(): Promise<WorkflowJob | null>;

  /**
   * Acknowledge job completion
   */
  acknowledge?(runId: string): Promise<void>;

  /**
   * Negative acknowledge - return job to queue
   */
  nack?(runId: string): Promise<void>;

  // =========================================================================
  // Distributed Locking (optional - for distributed execution)
  // =========================================================================

  /**
   * Acquire a lock for exclusive workflow execution
   * Returns true if lock was acquired, false if already locked
   */
  acquireLock?(runId: string, duration: number): Promise<boolean>;

  /**
   * Release a lock
   */
  releaseLock?(runId: string): Promise<void>;

  /**
   * Extend lock duration
   */
  extendLock?(runId: string, duration: number): Promise<boolean>;

  /**
   * Check if a lock is held
   */
  isLocked?(runId: string): Promise<boolean>;

  // =========================================================================
  // Events (optional - for event-driven workflows)
  // =========================================================================

  /**
   * Publish an event that waiting workflows can receive
   */
  publishEvent?(
    eventName: string,
    payload: unknown,
    options?: {
      runId?: string; // Target specific run
      workflowId?: string; // Target specific workflow type
    },
  ): Promise<void>;

  /**
   * Subscribe to events for a workflow run
   * Returns an async iterator of events
   */
  subscribeEvents?(runId: string): AsyncIterable<{
    eventName: string;
    payload: unknown;
    timestamp: Date;
  }>;

  // =========================================================================
  // Lifecycle
  // =========================================================================

  /**
   * Initialize the backend (connect to database, etc.)
   */
  initialize?(): Promise<void>;

  /**
   * Check if the backend is healthy
   */
  healthCheck?(): Promise<boolean>;

  /**
   * Cleanup and close connections
   */
  destroy(): Promise<void>;
}

/**
 * Backend with queue capabilities
 * Type guard for checking if backend supports queueing
 */
export function hasQueueSupport(
  backend: WorkflowBackend,
): backend is WorkflowBackend & Required<Pick<WorkflowBackend, "enqueue" | "dequeue" | "acknowledge">> {
  return (
    typeof backend.enqueue === "function" &&
    typeof backend.dequeue === "function" &&
    typeof backend.acknowledge === "function"
  );
}

/**
 * Backend with locking capabilities
 * Type guard for checking if backend supports distributed locking
 */
export function hasLockSupport(
  backend: WorkflowBackend,
): backend is WorkflowBackend & Required<Pick<WorkflowBackend, "acquireLock" | "releaseLock">> {
  return (
    typeof backend.acquireLock === "function" &&
    typeof backend.releaseLock === "function"
  );
}

/**
 * Backend with event capabilities
 * Type guard for checking if backend supports events
 */
export function hasEventSupport(
  backend: WorkflowBackend,
): backend is WorkflowBackend & Required<Pick<WorkflowBackend, "publishEvent" | "subscribeEvents">> {
  return (
    typeof backend.publishEvent === "function" &&
    typeof backend.subscribeEvents === "function"
  );
}
