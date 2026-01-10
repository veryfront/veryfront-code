/**
 * Parallel DSL Builder
 *
 * Creates parallel nodes for concurrent execution
 */

import type {
  BaseNodeConfig,
  ParallelNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";

/**
 * Options for creating a parallel node
 */
export interface ParallelOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  /** How to handle parallel completion */
  strategy?: "all" | "race" | "allSettled";
  /** Whether to checkpoint after all parallel steps complete */
  checkpoint?: boolean;
  /** Retry configuration for the parallel group */
  retry?: RetryConfig;
  /** Timeout for all parallel steps */
  timeout?: string | number;
  /** Condition to skip this parallel group */
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Create a parallel node for concurrent execution of multiple steps
 *
 * @example
 * ```typescript
 * // Execute multiple agents in parallel
 * parallel('analyze', [
 *   step('security-scan', { agent: 'securityAgent' }),
 *   step('code-quality', { agent: 'codeReviewAgent' }),
 *   step('test-coverage', { tool: 'coverageAnalyzer' }),
 * ])
 *
 * // Race condition - first to complete wins
 * parallel('fast-response', [
 *   step('gpt4', { agent: 'gpt4Agent' }),
 *   step('claude', { agent: 'claudeAgent' }),
 * ], { strategy: 'race' })
 *
 * // Continue even if some fail
 * parallel('optional-checks', [
 *   step('lint', { tool: 'linter' }),
 *   step('typecheck', { tool: 'typechecker' }),
 * ], { strategy: 'allSettled' })
 * ```
 */
export function parallel(
  id: string,
  nodes: WorkflowNode[],
  options: ParallelOptions = {},
): WorkflowNode {
  validateNodeId(id);

  if (!nodes || nodes.length === 0) {
    throw new Error(`Parallel node "${id}" must have at least one child node`);
  }

  // Generate unique IDs for child nodes if they're nested under this parallel
  // Also validate child node IDs
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
