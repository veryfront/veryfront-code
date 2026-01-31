import type {
  BaseNodeConfig,
  ParallelNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";

export interface ParallelOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  strategy?: "all" | "race" | "allSettled";
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/** Create a parallel node for concurrent execution of multiple steps. */
export function parallel(
  id: string,
  nodes: WorkflowNode[],
  options: ParallelOptions = {},
): WorkflowNode {
  validateNodeId(id);

  if (nodes.length === 0) {
    throw new Error(`Parallel node "${id}" must have at least one child node`);
  }

  const prefix = `${id}/`;
  const prefixedNodes = nodes.map((node, index) => {
    if (typeof node.id !== "string" || node.id.length === 0) {
      throw new Error(
        `Child node at index ${index} in parallel "${id}" has invalid ID`,
      );
    }

    const childId = node.id.startsWith(prefix) ? node.id : `${prefix}${node.id}`;
    return { ...node, id: childId };
  });

  const config: ParallelNodeConfig = {
    type: "parallel",
    nodes: prefixedNodes,
    strategy: options.strategy ?? "all",
    checkpoint: options.checkpoint ?? true,
    retry: options.retry,
    timeout: options.timeout,
    skip: options.skip,
  };

  return { id, config };
}
