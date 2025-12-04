/**
 * Veryfront Workflow React Hooks
 *
 * Headless React hooks for workflow interactions.
 *
 * @example
 * ```tsx
 * import {
 *   useWorkflow,
 *   useWorkflowList,
 *   useWorkflowStart,
 *   useApproval,
 * } from 'veryfront/ai/workflow/react';
 *
 * // Track a specific workflow run
 * const { run, status, progress, pendingApprovals } = useWorkflow({
 *   runId: 'run_abc123',
 * });
 *
 * // List workflow runs
 * const { runs, loadMore, hasMore } = useWorkflowList({
 *   workflowId: 'content-pipeline',
 *   status: 'running',
 * });
 *
 * // Start a new workflow
 * const { start, isStarting } = useWorkflowStart({
 *   workflowId: 'content-pipeline',
 * });
 *
 * // Handle approval
 * const { approval, approve, reject } = useApproval({
 *   runId: 'run_abc123',
 *   approvalId: 'approval_xyz',
 * });
 * ```
 */

export { useWorkflow } from "./use-workflow.ts";
export type { UseWorkflowOptions, UseWorkflowResult } from "./use-workflow.ts";

export { useApproval } from "./use-approval.ts";
export type { UseApprovalOptions, UseApprovalResult } from "./use-approval.ts";

export { useWorkflowList } from "./use-workflow-list.ts";
export type { UseWorkflowListOptions, UseWorkflowListResult } from "./use-workflow-list.ts";

export { useWorkflowStart } from "./use-workflow-start.ts";
export type { UseWorkflowStartOptions, UseWorkflowStartResult } from "./use-workflow-start.ts";
