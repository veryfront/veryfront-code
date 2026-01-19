/**
 * Veryfront Workflow Module
 *
 * Durable, DAG-based agentic workflows with human-in-the-loop support.
 *
 * @example
 * ```typescript
 * import {
 *   workflow,
 *   step,
 *   parallel,
 *   branch,
 *   waitForApproval,
 *   WorkflowClient,
 * } from 'veryfront/workflow';
 *
 * // Define a workflow
 * const contentPipeline = workflow({
 *   id: 'content-pipeline',
 *   steps: ({ input }) => [
 *     step('research', { agent: 'researcher' }),
 *     parallel('generate', [
 *       step('write', { agent: 'writer' }),
 *       step('images', { tool: 'imageGenerator' }),
 *     ]),
 *     branch('review', {
 *       condition: () => input.requiresApproval,
 *       then: [waitForApproval('human-review', { timeout: '24h' })],
 *     }),
 *     step('publish', { agent: 'publisher' }),
 *   ],
 * });
 *
 * // Create client and register workflow
 * const client = new WorkflowClient();
 * client.register(contentPipeline);
 *
 * // Start a workflow
 * const handle = await client.start('content-pipeline', {
 *   topic: 'AI Safety',
 *   requiresApproval: true,
 * });
 *
 * // Wait for result
 * const result = await handle.result();
 * ```
 */

// =============================================================================
// Core Types
// =============================================================================
export type {
  // Operations
  ApprovalDecision,
  BaseNodeConfig,
  BlobResolver,
  BranchNodeConfig,
  Checkpoint,
  DurationString,
  // Run state
  NodeState,
  NodeStatus,
  ParallelNodeConfig,
  PendingApproval,
  RetryConfig,
  RunFilter,
  StepBuilderContext,
  StepNodeConfig,
  SubWorkflowNodeConfig,
  WaitNodeConfig,
  // Workflow definition
  WorkflowContext,
  WorkflowDefinition,
  WorkflowJob,
  WorkflowNode,
  WorkflowNodeConfig,
  // Node types
  WorkflowNodeType,
  WorkflowRun,
  // Status types
  WorkflowStatus,
} from "./types.ts";

export { generateId, parseDuration } from "./types.ts";

// =============================================================================
// DSL Builders
// =============================================================================
export {
  // Convenience builders
  agentStep,
  branch,
  dag,
  delay,
  dependsOn,
  map,
  parallel,
  // DAG helpers
  sequence,
  step,
  subWorkflow,
  toolStep,
  unless,
  waitForApproval,
  waitForEvent,
  when,
  // Main builders
  workflow,
} from "./dsl/index.ts";

export type {
  BranchOptions,
  MapOptions,
  ParallelOptions,
  StepOptions,
  SubWorkflowOptions,
  WaitForApprovalOptions,
  WaitForEventOptions,
  Workflow,
  WorkflowOptions,
} from "./dsl/index.ts";

// =============================================================================
// Blob Storage
// =============================================================================
export {
  type BlobRef,
  type BlobStorage,
  GCSBlobStorage,
  type GCSBlobStorageConfig,
  LocalBlobStorage,
  S3BlobStorage,
  type S3BlobStorageConfig,
  type StoreBlobOptions,
} from "./blob/index.ts";

// =============================================================================
// Backend
// =============================================================================
export type { BackendConfig, Lock, WorkflowBackend } from "./backends/types.ts";

export { hasEventSupport, hasLockSupport, hasQueueSupport } from "./backends/types.ts";

export { MemoryBackend } from "./backends/memory.ts";

// Redis backend (production)
export { RedisBackend } from "./backends/redis.ts";
export type { RedisAdapter, RedisBackendConfig } from "./backends/redis.ts";

// =============================================================================
// Executor
// =============================================================================
export {
  CheckpointManager,
  DAGExecutor,
  StepExecutor,
  WorkflowExecutor,
} from "./executor/index.ts";

export type {
  AgentRegistry,
  CheckpointManagerConfig,
  DAGExecutionResult,
  DAGExecutorConfig,
  ResumeInfo,
  StepExecutorConfig,
  StepResult,
  ToolRegistry,
  WorkflowExecutorConfig,
  WorkflowHandle,
} from "./executor/index.ts";

// =============================================================================
// Runtime
// =============================================================================
export { ApprovalManager } from "./runtime/index.ts";

export type { ApprovalManagerConfig, ApprovalNotifier, ApprovalRequest } from "./runtime/index.ts";

// Agent/Tool Registry
export {
  createMockAgent,
  createMockTool,
  DefaultAgentRegistry,
  DefaultToolRegistry,
} from "./runtime/agent-registry.ts";

// =============================================================================
// Client API
// =============================================================================
export { createWorkflowClient, WorkflowClient } from "./api/index.ts";

export type { WorkflowClientConfig } from "./api/index.ts";

// =============================================================================
// Workflow Registry (for discovery/dev tools)
// =============================================================================
export { getAllWorkflowIds, getWorkflow, registerWorkflow, workflowRegistry } from "./registry.ts";

export type { WorkflowMetadata } from "./registry.ts";

// =============================================================================
// Adapter Backends (for external workflow engines)
// =============================================================================
export { TemporalAdapter } from "./backends/temporal.ts";
export type { TemporalAdapterConfig } from "./backends/temporal.ts";

export { InngestAdapter } from "./backends/inngest.ts";
export type { InngestAdapterConfig } from "./backends/inngest.ts";

export { CloudflareAdapter } from "./backends/cloudflare.ts";
export type { CloudflareAdapterConfig } from "./backends/cloudflare.ts";

// =============================================================================
// React Hooks (re-exported for convenience)
// Note: For tree-shaking, prefer importing from 'veryfront/workflow/react'
// =============================================================================
export {
  useApproval,
  useWorkflow,
  useWorkflowList,
  useWorkflowStart,
} from "#veryfront/workflow/react";

export type {
  UseApprovalOptions,
  UseApprovalResult,
  UseWorkflowListOptions,
  UseWorkflowListResult,
  UseWorkflowOptions,
  UseWorkflowResult,
  UseWorkflowStartOptions,
  UseWorkflowStartResult,
} from "#veryfront/workflow/react";
