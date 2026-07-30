/**
 * Workflow Backend Exports
 */

export type {
  BackendConfig,
  Lock,
  PendingApprovalMetadataUpdate,
  WorkflowBackend,
  WorkflowRunUpdate,
} from "./types.ts";
export { hasEventSupport, hasLockSupport, hasQueueSupport } from "./types.ts";

export { MemoryBackend } from "./memory.ts";
export {
  createDistributedWorkflowBackend,
  createDistributedWorkflowWorkerResources,
  type DistributedWorkflowBackendOptions,
  type DistributedWorkflowWorkerEnvironment,
  type DistributedWorkflowWorkerResources,
} from "./distributed.ts";
