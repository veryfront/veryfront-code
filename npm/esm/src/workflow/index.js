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
import "../../_dnt.polyfills.js";
export { generateId, parseDuration } from "./types.js";
// =============================================================================
// DSL Builders
// =============================================================================
export { agentStep, branch, dag, delay, dependsOn, map, parallel, sequence, step, subWorkflow, toolStep, unless, waitForApproval, waitForEvent, when, workflow, } from "./dsl/index.js";
// =============================================================================
// Blob Storage
// =============================================================================
export { GCSBlobStorage, LocalBlobStorage, S3BlobStorage, } from "./blob/index.js";
export { hasEventSupport, hasLockSupport, hasQueueSupport } from "./backends/types.js";
export { MemoryBackend } from "./backends/memory.js";
export { RedisBackend } from "./backends/redis.js";
// =============================================================================
// Executor
// =============================================================================
export { CheckpointManager, DAGExecutor, StepExecutor, WorkflowExecutor, } from "./executor/index.js";
// =============================================================================
// Runtime
// =============================================================================
export { ApprovalManager } from "./runtime/index.js";
export { createMockAgent, createMockTool, DefaultAgentRegistry, DefaultToolRegistry, } from "./runtime/agent-registry.js";
// =============================================================================
// Client API
// =============================================================================
export { createWorkflowClient, WorkflowClient } from "./api/index.js";
// =============================================================================
// Workflow Registry (for discovery/dev tools)
// =============================================================================
export { getAllWorkflowIds, getWorkflow, registerWorkflow, workflowRegistry } from "./registry.js";
// Stub workflow backends (Temporal, Inngest, Cloudflare) removed — zero consumers.
// See P2-2 Dead Export Audit.
// =============================================================================
// React Hooks (re-exported for convenience)
// Note: For tree-shaking, prefer importing from 'veryfront/workflow/react'
// =============================================================================
export { useApproval, useWorkflow, useWorkflowList, useWorkflowStart, } from "./react/index.js";
