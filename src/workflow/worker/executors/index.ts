/**
 * Run executors
 *
 * Abstraction layer for executing workflow runs in different
 * environments.
 */

// Types
export type {
  RunExecutionConfig,
  RunExecutionInfo,
  RunExecutionStatus,
  RunExecutor,
} from "./types.ts";
export { isRunExecutor } from "./types.ts";

// Process Executor (local dev)
export { ProcessRunExecutor } from "./process.ts";
export type { ProcessRunExecutorConfig } from "./process.ts";
