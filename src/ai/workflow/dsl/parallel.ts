
import type {
  BaseNodeConfig,
  ParallelNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";

export interface ParallelOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  strategy?: "all" | "race" | "allSettled";
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

export function parallel(
  id: string,
  nodes: WorkflowNode[],
  options: ParallelOptions = {},
): WorkflowNode {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

  if (!nodes || nodes.length === 0) {
    throw new Error(`Parallel node "${id}" must have at least one child node`);
  }

  const prefixedNodes = nodes.map((node, index) => {
    if (!node.id || typeof node.id !== "string") {
      throw new Error(`Child node at index ${index} in parallel "${id}" has invalid ID`);
    }
    return {
      ...node,
      id: node.id.startsWith(`${id}/`) ? node.id : `${id}/${node.id}`,
    };
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

  return {
    id,
    config,
  };
}
