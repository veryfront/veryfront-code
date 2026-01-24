/**
 * DAG Executor
 *
 * Re-export from modular implementation for backward compatibility.
 *
 * @module ai/workflow/executor/dag-executor
 */

export {
  type DAGExecutionResult,
  DAGExecutor,
  type DAGExecutorConfig,
  type NodeExecutionResult,
} from "./dag/index.ts";
