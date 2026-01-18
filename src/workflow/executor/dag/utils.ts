/**
 * DAG Executor Utilities
 *
 * Helper functions for DAG execution.
 *
 * @module ai/workflow/executor/dag/utils
 */

import type { NodeStatus, WorkflowNode } from "../../types.ts";

/**
 * Derives NodeStatus from execution result flags
 */
export function deriveNodeStatus(completed: boolean, waiting: boolean): NodeStatus {
  if (completed) return "completed";
  if (waiting) return "running";
  return "failed";
}

/**
 * Check if node should be checkpointed
 */
export function shouldCheckpoint(node: WorkflowNode): boolean {
  return node.config.checkpoint ?? false;
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
