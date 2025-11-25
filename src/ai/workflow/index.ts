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
 * } from 'veryfront/ai/workflow';
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
  // Status types
  WorkflowStatus,
  NodeStatus,

  // Node types
  WorkflowNodeType,
  RetryConfig,
  BaseNodeConfig,
  StepNodeConfig,
  ParallelNodeConfig,
  BranchNodeConfig,
  WaitNodeConfig,
  SubWorkflowNodeConfig,
  WorkflowNodeConfig,
  WorkflowNode,

  // Workflow definition
  WorkflowContext,
  StepBuilderContext,
  WorkflowDefinition,

  // Run state
  NodeState,
  Checkpoint,
  PendingApproval,
  WorkflowRun,

  // Operations
  ApprovalDecision,
  WorkflowJob,
  RunFilter,
  DurationString,
} from "./types.ts";

export { parseDuration, generateId } from "./types.ts";

// =============================================================================
// DSL Builders
// =============================================================================
export {
  // Main builders
  workflow,
  step,
  parallel,
  branch,
  waitForApproval,
  waitForEvent,
  delay,

  // Convenience builders
  agentStep,
  toolStep,
  when,
  unless,

  // DAG helpers
  sequence,
  dag,
  dependsOn,
} from "./dsl/index.ts";

export type {
  WorkflowOptions,
  Workflow,
  StepOptions,
  ParallelOptions,
  BranchOptions,
  WaitForApprovalOptions,
  WaitForEventOptions,
} from "./dsl/index.ts";

// =============================================================================
// Backend
// =============================================================================
export type {
  WorkflowBackend,
  BackendConfig,
  Lock,
} from "./backends/types.ts";

export {
  hasQueueSupport,
  hasLockSupport,
  hasEventSupport,
} from "./backends/types.ts";

export { MemoryBackend } from "./backends/memory.ts";

// Redis backend (production)
export { RedisBackend } from "./backends/redis.ts";
export type { RedisBackendConfig, RedisClient } from "./backends/redis.ts";

// =============================================================================
// Executor
// =============================================================================
export {
  WorkflowExecutor,
  DAGExecutor,
  StepExecutor,
  CheckpointManager,
} from "./executor/index.ts";

export type {
  WorkflowExecutorConfig,
  WorkflowHandle,
  DAGExecutorConfig,
  DAGExecutionResult,
  StepExecutorConfig,
  StepResult,
  AgentRegistry,
  ToolRegistry,
  CheckpointManagerConfig,
  ResumeInfo,
} from "./executor/index.ts";

// =============================================================================
// Runtime
// =============================================================================
export { ApprovalManager } from "./runtime/index.ts";

export type {
  ApprovalManagerConfig,
  ApprovalNotifier,
  ApprovalRequest,
} from "./runtime/index.ts";

// Agent/Tool Registry
export {
  DefaultAgentRegistry,
  DefaultToolRegistry,
  createMockAgent,
  createMockTool,
} from "./runtime/agent-registry.ts";

// =============================================================================
// Client API
// =============================================================================
export { WorkflowClient, createWorkflowClient } from "./api/index.ts";

export type { WorkflowClientConfig } from "./api/index.ts";

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
// Note: For tree-shaking, prefer importing from 'veryfront/ai/workflow/react'
// =============================================================================
export {
  useWorkflow,
  useApproval,
  useWorkflowList,
  useWorkflowStart,
} from "./react/index.ts";

export type {
  UseWorkflowOptions,
  UseWorkflowResult,
  UseApprovalOptions,
  UseApprovalResult,
  UseWorkflowListOptions,
  UseWorkflowListResult,
  UseWorkflowStartOptions,
  UseWorkflowStartResult,
} from "./react/index.ts";
