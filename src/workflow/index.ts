/**
 * DAG-based agentic workflows with human-in-the-loop support.
 *
 * @module workflow
 *
 * @example Simple sequential workflow
 * ```typescript
 * import { workflow, step } from "veryfront/workflow";
 *
 * const pipeline = workflow({
 *   id: "summarize",
 *   steps: () => [
 *     step("fetch", { tool: "webScraper" }),
 *     step("summarize", { agent: "writer" }),
 *   ],
 * });
 * ```
 *
 * @example Parallel steps and human-in-the-loop
 * ```typescript
 * import { workflow, step, parallel, branch, waitForApproval } from "veryfront/workflow";
 *
 * const contentPipeline = workflow({
 *   id: "content-pipeline",
 *   steps: ({ input }) => [
 *     step("research", { agent: "researcher" }),
 *     parallel("generate", [
 *       step("write", { agent: "writer" }),
 *       step("images", { tool: "imageGenerator" }),
 *     ]),
 *     branch("review", {
 *       condition: () => input.requiresApproval,
 *       then: [waitForApproval("human-review", { timeout: "24h" })],
 *     }),
 *     step("publish", { agent: "publisher" }),
 *   ],
 * });
 * ```
 */

// =============================================================================
// Core Types
// =============================================================================
export type {
  CapturedTenantContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowRun,
  WorkflowStatus,
} from "./types.ts";

export { generateId, parseDuration } from "./types.ts";

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
export { hasWorkerSupport } from "./backends/types.ts";

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

// =============================================================================
// Executor
// =============================================================================
export {
  WorkflowExecutor,
  type WorkflowExecutorConfig,
  type WorkflowHandle,
} from "./executor/workflow-executor.ts";
export { getWorkflowTenant } from "./executor/step-executor.ts";

// =============================================================================
// Context-Aware API
// =============================================================================
export { api } from "./api.ts";
