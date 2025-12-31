/**
 * Loop DSL Builder
 *
 * Creates loop nodes for iterative execution until a condition is met.
 * Supports max iterations, timeout, and escape conditions.
 */

import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";

/**
 * Loop state passed to steps within the loop
 */
export interface LoopContext {
  /** Current iteration (0-indexed) */
  iteration: number;
  /** Total iterations completed so far */
  totalIterations: number;
  /** Results from previous iterations */
  previousResults: unknown[];
  /** Whether this is the first iteration */
  isFirstIteration: boolean;
  /** Whether max iterations will be reached after this iteration */
  isLastAllowedIteration: boolean;
}

/**
 * Options for creating a loop node
 */
export interface LoopOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  /**
   * Condition to continue looping.
   * Return `true` to continue, `false` to exit the loop.
   * Has access to workflow context and loop-specific context.
   */
  while: (context: WorkflowContext, loop: LoopContext) => boolean | Promise<boolean>;

  /**
   * Steps to execute each iteration.
   * Can be a static array or a function that returns steps based on context.
   */
  steps: WorkflowNode[] | ((context: WorkflowContext, loop: LoopContext) => WorkflowNode[]);

  /**
   * Maximum number of iterations (required to prevent infinite loops).
   * @default 10
   */
  maxIterations?: number;

  /**
   * Handler called when max iterations is reached without condition becoming false.
   * Return value is merged into workflow context.
   */
  onMaxIterations?: (
    context: WorkflowContext,
    loop: LoopContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * Handler called when loop exits normally (condition became false).
   * Return value is merged into workflow context.
   */
  onComplete?: (
    context: WorkflowContext,
    loop: LoopContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;

  /**
   * Whether to checkpoint after each iteration (default: true)
   */
  checkpoint?: boolean;

  /** Retry configuration for the entire loop */
  retry?: RetryConfig;

  /** Timeout for the entire loop (all iterations combined) */
  timeout?: string | number;

  /** Timeout per iteration */
  iterationTimeout?: string | number;

  /** Condition to skip this loop entirely */
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;

  /** Delay between iterations (ms or duration string like "1s") */
  delay?: number | string;
}

/**
 * Loop node configuration
 */
export interface LoopNodeConfig {
  type: "loop";
  while: LoopOptions["while"];
  steps: LoopOptions["steps"];
  maxIterations: number;
  onMaxIterations?: LoopOptions["onMaxIterations"];
  onComplete?: LoopOptions["onComplete"];
  checkpoint: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  iterationTimeout?: string | number;
  skip?: LoopOptions["skip"];
  delay?: number | string;
}

/**
 * Create a loop node for iterative execution
 *
 * @example
 * ```typescript
 * // Gather info until complete (max 3 attempts)
 * loop('gather-info', {
 *   maxIterations: 3,
 *   while: (ctx) => !ctx['analyze'].output.isComplete,
 *   steps: [
 *     step('request-info', { tool: 'send-email' }),
 *     waitForApproval('user-response', { timeout: '48h' }),
 *     step('analyze', { agent: 'analyzer' }),
 *   ],
 *   onMaxIterations: (ctx, loop) => ({
 *     escalate: true,
 *     reason: `Max iterations (${loop.totalIterations}) reached`,
 *   }),
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Retry with exponential backoff
 * loop('retry-api', {
 *   maxIterations: 5,
 *   while: (ctx) => ctx.lastError !== null,
 *   delay: (ctx, loop) => Math.pow(2, loop.iteration) * 1000, // 1s, 2s, 4s, 8s, 16s
 *   steps: [
 *     step('call-api', { tool: 'api-client' }),
 *   ],
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Dynamic steps based on iteration
 * loop('progressive-analysis', {
 *   maxIterations: 3,
 *   while: (ctx) => ctx.confidence < 0.9,
 *   steps: (ctx, loop) => [
 *     step('analyze', {
 *       agent: 'analyzer',
 *       input: `Attempt ${loop.iteration + 1}: Analyze with ${
 *         loop.isFirstIteration ? 'basic' : 'detailed'
 *       } strategy`,
 *     }),
 *   ],
 * })
 * ```
 */
export function loop(id: string, options: LoopOptions): WorkflowNode {
  // Validate node ID
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

  // Validate required options
  if (!options.while || typeof options.while !== "function") {
    throw new Error(`Loop "${id}" must have a 'while' condition function`);
  }

  if (!options.steps) {
    throw new Error(`Loop "${id}" must have 'steps' configured`);
  }

  // Ensure maxIterations has a sensible default to prevent infinite loops
  const maxIterations = options.maxIterations ?? 10;
  if (maxIterations < 1) {
    throw new Error(`Loop "${id}" maxIterations must be at least 1`);
  }
  if (maxIterations > 100) {
    throw new Error(
      `Loop "${id}" maxIterations cannot exceed 100 (got ${maxIterations}). ` +
        `For higher limits, consider restructuring your workflow.`,
    );
  }

  const config: LoopNodeConfig = {
    type: "loop",
    while: options.while,
    steps: options.steps,
    maxIterations,
    onMaxIterations: options.onMaxIterations,
    onComplete: options.onComplete,
    checkpoint: options.checkpoint ?? true,
    retry: options.retry,
    timeout: options.timeout,
    iterationTimeout: options.iterationTimeout,
    skip: options.skip,
    delay: options.delay,
  };

  return {
    id,
    config,
  };
}

/**
 * Convenience function for "do-while" style loops (execute at least once)
 *
 * @example
 * ```typescript
 * doWhile('validate', {
 *   until: (ctx) => ctx.isValid,
 *   steps: [
 *     step('get-input', { tool: 'prompt-user' }),
 *     step('validate', { agent: 'validator' }),
 *   ],
 * })
 * ```
 */
export function doWhile(
  id: string,
  options: Omit<LoopOptions, "while"> & {
    /** Condition to stop looping (opposite of while - stops when true) */
    until: (context: WorkflowContext, loop: LoopContext) => boolean | Promise<boolean>;
  },
): WorkflowNode {
  const { until, ...rest } = options;

  return loop(id, {
    ...rest,
    // Invert the condition and skip first check (do-while executes at least once)
    while: async (ctx, loopCtx) => {
      if (loopCtx.isFirstIteration) {
        return true; // Always execute first iteration
      }
      return !(await until(ctx, loopCtx));
    },
  });
}

/**
 * Convenience function for count-based loops
 *
 * @example
 * ```typescript
 * times('retry', 3, [
 *   step('attempt', { tool: 'risky-operation' }),
 * ])
 * ```
 */
export function times(
  id: string,
  count: number,
  steps: WorkflowNode[],
  options?: Omit<LoopOptions, "while" | "steps" | "maxIterations">,
): WorkflowNode {
  return loop(id, {
    ...options,
    maxIterations: count,
    while: (_, loop) => loop.iteration < count,
    steps,
  });
}
