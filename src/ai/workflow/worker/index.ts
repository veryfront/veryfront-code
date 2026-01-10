/**
 * Workflow Worker Module
 *
 * Provides distributed workflow execution support.
 *
 * Two modes available:
 *
 * 1. **WorkflowWorker** - In-process polling worker
 *    - Polls for stalled workflows and resumes them
 *    - Good for trusted code or single-tenant deployments
 *    - Simple setup, lower overhead
 *
 * 2. **WorkflowJobManager** - K8s Job-based execution
 *    - Each workflow runs in an ephemeral container
 *    - Complete tenant isolation (no shared state)
 *    - Required for multi-tenant untrusted code execution
 */

// In-process worker (single-tenant / trusted code)
export {
  createWorkflowWorker,
  WorkflowWorker,
  type WorkerStats,
  type WorkerStatus,
  type WorkflowWorkerConfig,
} from "./workflow-worker.ts";

// K8s Job-based execution (multi-tenant / untrusted code)
export {
  createWorkflowJobManager,
  WorkflowJobManager,
  type JobInfo,
  type JobStatus,
  type K8sClient,
  type K8sJob,
  type K8sJobStatus,
  type ManagerStats,
  type ManagerStatus,
  type WorkflowJobManagerConfig,
} from "./job-manager.ts";

// Job entrypoint (runs inside ephemeral container)
export {
  createJobEntrypoint,
  type CreateJobEntrypointOptions,
  EXIT_CODES,
  type JobEntrypointConfig,
  runWorkflowJob,
} from "./job-entrypoint.ts";
