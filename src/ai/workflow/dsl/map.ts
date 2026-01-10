import type {
  BaseNodeConfig,
  MapNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";

export interface MapOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  items: unknown[] | ((context: WorkflowContext) => unknown[] | Promise<unknown[]>);
  processor: WorkflowNode | WorkflowDefinition;
  concurrency?: number;
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Create a map node for dynamic fan-out execution.
 */
export function map(
  id: string,
  options: MapOptions,
): WorkflowNode {
  validateNodeId(id);

  if (!options.items) {
    throw new Error(`Map node "${id}" must have 'items' configured`);
  }

  if (!options.processor) {
    throw new Error(`Map node "${id}" must have a 'processor' configured`);
  }

  const config: MapNodeConfig = {
    type: "map",
    items: options.items,
    processor: options.processor,
    concurrency: options.concurrency,
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
