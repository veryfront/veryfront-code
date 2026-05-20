/**
 * Workflow worker module
 *
 * Provides distributed workflow execution support.
 *
 * Three execution profiles are available:
 *
 * 1. **WorkflowWorker** - In-process polling worker
 *    - Polls for stalled workflows and resumes them
 *    - Good for trusted code or single-tenant deployments
 *    - Simple setup, lower overhead
 *
 * 2. **WorkflowRunManager + K8sJobExecutor** - Kubernetes Job-backed execution
 *    - Each workflow runs in an ephemeral container
 *    - Complete tenant isolation (no shared state)
 *    - Required for multi-tenant untrusted code execution
 *
 * 3. **WorkflowRunManager + ProcessJobExecutor** - Local process execution
 *    - Spawns child processes for each workflow
 *    - Good for local development without K8s/Docker
 *    - Mirrors production behavior
 *
 * A workflow run can be backed by a job executor without introducing another
 * user-visible execution type.
 */

// In-process worker (single-tenant / trusted code)
export {
  createWorkflowWorker,
  type WorkerStats,
  type WorkerStatus,
  WorkflowWorker,
  type WorkflowWorkerConfig,
} from "./workflow-worker.ts";

// Job-backed workflow run execution (multi-tenant / untrusted code)
export {
  createWorkflowRunManager,
  type ManagerStats,
  type ManagerStatus,
  WorkflowRunManager,
  type WorkflowRunManagerConfig,
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

// Workflow run entrypoint (runs inside ephemeral container/process)
// Use this when workflows are pre-bundled in the container
export {
  createWorkflowRunEntrypoint,
  type CreateWorkflowRunEntrypointOptions,
  EXIT_CODES,
  runWorkflowRun,
  type WorkflowRunEntrypointConfig,
} from "./job-entrypoint.ts";

// Dynamic workflow run entrypoint (discovers workflows at runtime)
// Use this when workflows are stored in Veryfront API
export {
  createDynamicWorkflowRunEntrypoint,
  type CreateDynamicWorkflowRunEntrypointOptions,
  DYNAMIC_EXIT_CODES,
  type DynamicWorkflowRunEntrypointConfig,
  runDynamicWorkflowRun,
} from "./dynamic-job-entrypoint.ts";
