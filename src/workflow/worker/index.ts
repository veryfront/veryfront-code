/**
 * Workflow Worker Module
 *
 * Provides distributed workflow execution support.
 *
 * Three modes available:
 *
 * 1. **WorkflowWorker** - In-process polling worker
 *    - Polls for stalled workflows and resumes them
 *    - Good for trusted code or single-tenant deployments
 *    - Simple setup, lower overhead
 *
 * 2. **WorkflowJobManager + K8sJobExecutor** - Kubernetes Job-based execution
 *    - Each workflow runs in an ephemeral container
 *    - Complete tenant isolation (no shared state)
 *    - Required for multi-tenant untrusted code execution
 *
 * 3. **WorkflowJobManager + ProcessJobExecutor** - Local process execution
 *    - Spawns child processes for each workflow
 *    - Good for local development without K8s/Docker
 *    - Mirrors production behavior
 */

// In-process worker (single-tenant / trusted code)
export {
  createWorkflowWorker,
  type WorkerStats,
  type WorkerStatus,
  WorkflowWorker,
  type WorkflowWorkerConfig,
} from "./workflow-worker.ts";

// Job-based execution (multi-tenant / untrusted code)
export {
  createWorkflowJobManager,
  type ManagerStats,
  type ManagerStatus,
  WorkflowJobManager,
  type WorkflowJobManagerConfig,
} from "./job-manager.ts";

// Job Executors (pluggable runtime backends)
export {
  isJobExecutor,
  type JobConfig,
  type JobExecutor,
  type JobInfo,
  type JobStatus,
  type K8sClient,
  K8sJobExecutor,
  type K8sJobExecutorConfig,
  type K8sJobSpec,
  type K8sJobStatusResponse,
  ProcessJobExecutor,
  type ProcessJobExecutorConfig,
} from "./executors/index.ts";

// Job entrypoint (runs inside ephemeral container/process)
// Use this when workflows are pre-bundled in the container
export {
  createJobEntrypoint,
  type CreateJobEntrypointOptions,
  EXIT_CODES,
  type JobEntrypointConfig,
  runWorkflowJob,
} from "./job-entrypoint.ts";

// Dynamic job entrypoint (discovers workflows at runtime)
// Use this when workflows are stored in Veryfront API
export {
  createDynamicJobEntrypoint,
  type CreateDynamicJobEntrypointOptions,
  DYNAMIC_EXIT_CODES,
  type DynamicJobEntrypointConfig,
  runDynamicWorkflowJob,
} from "./dynamic-job-entrypoint.ts";
