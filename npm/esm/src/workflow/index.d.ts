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
import "../../_dnt.polyfills.js";
export type { ApprovalDecision, BaseNodeConfig, BlobResolver, BranchNodeConfig, Checkpoint, DurationString, NodeState, NodeStatus, ParallelNodeConfig, PendingApproval, RetryConfig, RunFilter, StepBuilderContext, StepNodeConfig, SubWorkflowNodeConfig, WaitNodeConfig, WorkflowContext, WorkflowDefinition, WorkflowJob, WorkflowNode, WorkflowNodeConfig, WorkflowNodeType, WorkflowRun, WorkflowStatus, } from "./types.js";
export { generateId, parseDuration } from "./types.js";
export { agentStep, branch, dag, delay, dependsOn, map, parallel, sequence, step, subWorkflow, toolStep, unless, waitForApproval, waitForEvent, when, workflow, } from "./dsl/index.js";
export type { BranchOptions, MapOptions, ParallelOptions, StepOptions, SubWorkflowOptions, WaitForApprovalOptions, WaitForEventOptions, Workflow, WorkflowOptions, } from "./dsl/index.js";
export { type BlobRef, type BlobStorage, GCSBlobStorage, type GCSBlobStorageConfig, LocalBlobStorage, S3BlobStorage, type S3BlobStorageConfig, type StoreBlobOptions, } from "./blob/index.js";
export type { BackendConfig, Lock, WorkflowBackend } from "./backends/types.js";
export { hasEventSupport, hasLockSupport, hasQueueSupport } from "./backends/types.js";
export { MemoryBackend } from "./backends/memory.js";
export { RedisBackend } from "./backends/redis.js";
export type { RedisAdapter, RedisBackendConfig } from "./backends/redis.js";
export { CheckpointManager, DAGExecutor, StepExecutor, WorkflowExecutor, } from "./executor/index.js";
export type { AgentRegistry, CheckpointManagerConfig, DAGExecutionResult, DAGExecutorConfig, ResumeInfo, StepExecutorConfig, StepResult, ToolRegistry, WorkflowExecutorConfig, WorkflowHandle, } from "./executor/index.js";
export { ApprovalManager } from "./runtime/index.js";
export type { ApprovalManagerConfig, ApprovalNotifier, ApprovalRequest } from "./runtime/index.js";
export { createMockAgent, createMockTool, DefaultAgentRegistry, DefaultToolRegistry, } from "./runtime/agent-registry.js";
export { createWorkflowClient, WorkflowClient } from "./api/index.js";
export type { WorkflowClientConfig } from "./api/index.js";
export { getAllWorkflowIds, getWorkflow, registerWorkflow, workflowRegistry } from "./registry.js";
export type { WorkflowMetadata } from "./registry.js";
export { useApproval, useWorkflow, useWorkflowList, useWorkflowStart, } from "./react/index.js";
export type { UseApprovalOptions, UseApprovalResult, UseWorkflowListOptions, UseWorkflowListResult, UseWorkflowOptions, UseWorkflowResult, UseWorkflowStartOptions, UseWorkflowStartResult, } from "./react/index.js";
//# sourceMappingURL=index.d.ts.map