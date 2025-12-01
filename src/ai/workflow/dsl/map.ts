/**
 * Map DSL Builder
 *
 * Creates map nodes for dynamic fan-out execution
 */

import type {
  BaseNodeConfig,
  MapNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";

/**
 * Options for creating a map node
 */
export interface MapOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  /** Items to iterate over */
  items: unknown[] | ((context: WorkflowContext) => unknown[] | Promise<unknown[]>);
  /** Node or workflow to execute for each item */
  processor: WorkflowNode | WorkflowDefinition;
  /** Maximum concurrent executions */
  concurrency?: number;
  /** Whether to checkpoint after all items complete */
  checkpoint?: boolean;
  /** Retry configuration for the map group */
  retry?: RetryConfig;
  /** Timeout for all map items */
  timeout?: string | number;
  /** Condition to skip this map group */
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Create a map node for dynamic fan-out execution
 *
 * @example
 * ```typescript
 * // Process a list of URLs dynamically
 * map('process-urls', {
 *   items: (ctx) => ctx.input.urls,
 *   processor: step('scrape', { tool: 'webScraper' }),
 *   concurrency: 5
 * })
 * ```
 */
export function map(
  id: string,
  options: MapOptions,
): WorkflowNode {
  // Validate node ID
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

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
