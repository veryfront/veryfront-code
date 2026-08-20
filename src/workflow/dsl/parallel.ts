import type {
  BaseNodeConfig,
  ParallelNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { namespaceWorkflowNodes, validateNodeId } from "./validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

/** Options accepted by parallel. */
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
    throw INVALID_ARGUMENT.create({
      detail: `Parallel node "${id}" must have at least one child node`,
    });
  }

  const prefix = `${id}/`;
  nodes.forEach((node, index) => {
    if (typeof node.id !== "string" || node.id.length === 0) {
      throw INVALID_ARGUMENT.create({
        detail: `Child node at index ${index} in parallel "${id}" has invalid ID`,
      });
    }
  });
  const prefixedNodes = namespaceWorkflowNodes(prefix, nodes);

  const config: ParallelNodeConfig = {
    type: "parallel",
    description: options.description,
    nodes: prefixedNodes,
    strategy: options.strategy ?? "all",
    checkpoint: options.checkpoint ?? true,
    retry: options.retry,
    timeout: options.timeout,
    skip: options.skip,
  };

  return { id, config };
}
