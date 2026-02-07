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
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStatus,
} from "./types.ts";

// =============================================================================
// DSL Builders
// =============================================================================
export {
  agentStep,
  branch,
  dag,
  delay,
  dependsOn,
  doWhile,
  loop,
  map,
  parallel,
  sequence,
  step,
  subWorkflow,
  times,
  toolStep,
  unless,
  waitForApproval,
  waitForEvent,
  when,
  workflow,
} from "./dsl/index.ts";

export type {
  BranchOptions,
  LoopOptions,
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
// Backend
// =============================================================================
export type { BackendConfig, WorkflowBackend } from "./backends/types.ts";

export { MemoryBackend } from "./backends/memory.ts";

export { RedisBackend } from "./backends/redis.ts";
export type { RedisAdapter, RedisBackendConfig } from "./backends/redis.ts";

// =============================================================================
// Client API
// =============================================================================
export { createWorkflowClient, WorkflowClient } from "./api/index.ts";
export type { WorkflowClientConfig } from "./api/index.ts";

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
