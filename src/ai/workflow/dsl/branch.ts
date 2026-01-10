/**
 * Branch DSL Builder
 *
 * Creates conditional branch nodes for workflow control flow
 */

import type {
  BaseNodeConfig,
  BranchNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";

/**
 * Options for creating a branch node
 */
export interface BranchOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  /** Condition to evaluate */
  condition: (context: WorkflowContext) => boolean | Promise<boolean>;
  /** Nodes to execute if condition is true */
  then: WorkflowNode[];
  /** Nodes to execute if condition is false (optional) */
  else?: WorkflowNode[];
  /** Whether to checkpoint after branching */
  checkpoint?: boolean;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Timeout for the entire branch */
  timeout?: string | number;
  /** Condition to skip the entire branch */
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Create a conditional branch node
 *
 * @example
 * ```typescript
 * // Simple if-then branch
 * branch('approval-gate', {
 *   condition: (ctx) => ctx.input.requiresApproval,
 *   then: [
 *     waitForApproval('human-review', { timeout: '24h' }),
 *   ],
 * })
 *
 * // If-then-else branch
 * branch('quality-check', {
 *   condition: async (ctx) => {
 *     const score = ctx['analyze'].output.score;
 *     return score >= 0.8;
 *   },
 *   then: [
 *     step('publish', { agent: 'publisher' }),
 *   ],
 *   else: [
 *     step('revise', { agent: 'editor' }),
 *     step('reanalyze', { agent: 'analyzer' }),
 *   ],
 * })
 * ```
 */
export function branch(id: string, options: BranchOptions): WorkflowNode {
  validateNodeId(id);

  if (!options.condition) {
    throw new Error(`Branch "${id}" must specify a condition`);
  }

  if (!options.then || options.then.length === 0) {
    throw new Error(`Branch "${id}" must have at least one 'then' node`);
  }

  // Prefix child node IDs for proper namespacing
  const prefixThenNodes = options.then.map((node) => ({
    ...node,
    id: node.id.startsWith(`${id}/then/`) ? node.id : `${id}/then/${node.id}`,
  }));

  const prefixElseNodes = options.else?.map((node) => ({
    ...node,
    id: node.id.startsWith(`${id}/else/`) ? node.id : `${id}/else/${node.id}`,
  }));

  const config: BranchNodeConfig = {
    type: "branch",
    condition: options.condition,
    then: prefixThenNodes,
    else: prefixElseNodes,
    checkpoint: options.checkpoint ?? false,
    retry: options.retry,
    timeout: options.timeout,
    skip: options.skip,
  };

  return {
    id,
    config,
  };
}

/**
 * Create a branch that only executes if condition is true (no else)
 * Convenience wrapper around branch()
 */
export function when(
  id: string,
  condition: (context: WorkflowContext) => boolean | Promise<boolean>,
  nodes: WorkflowNode[],
): WorkflowNode {
  return branch(id, { condition, then: nodes });
}

/**
 * Create a branch that only executes if condition is false
 * Convenience wrapper around branch()
 */
export function unless(
  id: string,
  condition: (context: WorkflowContext) => boolean | Promise<boolean>,
  nodes: WorkflowNode[],
): WorkflowNode {
  return branch(id, {
    condition: async (ctx) => !(await condition(ctx)),
    then: nodes,
  });
}
