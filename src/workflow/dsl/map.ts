import type {
  BaseNodeConfig,
  MapNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

export interface MapOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  items: unknown[] | ((context: WorkflowContext) => unknown[] | Promise<unknown[]>);
  processor: WorkflowNode | WorkflowDefinition;
  concurrency?: number;
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

export function map(id: string, options: MapOptions): WorkflowNode {
  validateNodeId(id);

  if (!options.items) {
    throw INVALID_ARGUMENT.create({ detail: `Map node "${id}" must have 'items' configured` });
  }
  if (!options.processor) {
    throw INVALID_ARGUMENT.create({
      detail: `Map node "${id}" must have a 'processor' configured`,
    });
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

  return { id, config };
}
