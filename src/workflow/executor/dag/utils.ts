import type { NodeStatus, WorkflowNode } from "../../types.ts";

export function deriveNodeStatus(completed: boolean, waiting: boolean): NodeStatus {
  if (completed) return "completed";
  if (waiting) return "running";
  return "failed";
}

export function shouldCheckpoint(node: WorkflowNode): boolean {
  return node.config.checkpoint ?? false;
}

export function sleep(ms: number): Promise<void> {
  // no cleanup needed: one-shot
  return new Promise((resolve) => setTimeout(resolve, ms));
}
