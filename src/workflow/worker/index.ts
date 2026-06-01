/**
 * Workflow worker module
 *
 * Provides distributed workflow execution support.
 *
 * Two execution profiles are available:
 *
 * 1. **WorkflowWorker** - In-process polling worker
 *    - Polls for stalled workflows and resumes them
 *    - Good for trusted code or single-tenant deployments
 *    - Simple setup, lower overhead
 *
 * 2. **WorkflowRunManager + ProcessRunExecutor** - Local process execution
 *    - Spawns child processes for each workflow
 *    - Good for local development without K8s/Docker
 *
 * A workflow run can be backed by a run executor without introducing another
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

// Isolated workflow run execution (multi-tenant / untrusted code)
export {
  createWorkflowRunManager,
  type ManagerStats,
  type ManagerStatus,
  WorkflowRunManager,
  type WorkflowRunManagerConfig,
} from "./run-manager.ts";

// Run executors (pluggable runtime backends)
export {
  isRunExecutor,
  ProcessRunExecutor,
  type ProcessRunExecutorConfig,
  type RunExecutionConfig,
  type RunExecutionInfo,
  type RunExecutionStatus,
  type RunExecutor,
} from "./executors/index.ts";

// Workflow run entrypoint (runs inside ephemeral container/process)
// Use this when workflows are pre-bundled in the container
export {
  createWorkflowRunEntrypoint,
  type CreateWorkflowRunEntrypointOptions,
  EXIT_CODES,
  runWorkflowRun,
  type WorkflowRunEntrypointConfig,
} from "./run-entrypoint.ts";

// Dynamic workflow run entrypoint (discovers workflows at runtime)
// Use this when workflows are stored in Veryfront API
export {
  createDynamicWorkflowRunEntrypoint,
  type CreateDynamicWorkflowRunEntrypointOptions,
  DYNAMIC_EXIT_CODES,
  type DynamicWorkflowRunEntrypointConfig,
  runDynamicWorkflowRun,
} from "./dynamic-run-entrypoint.ts";
