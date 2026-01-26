import * as dntShim from "../../../../_dnt.shims.js";
import type { NodeStatus, WorkflowNode } from "../../types.js";

export function deriveNodeStatus(completed: boolean, waiting: boolean): NodeStatus {
  if (completed) return "completed";
  if (waiting) return "running";
  return "failed";
}

export function shouldCheckpoint(node: WorkflowNode): boolean {
  return node.config.checkpoint ?? false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => dntShim.setTimeout(resolve, ms));
}
