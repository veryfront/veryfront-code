import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";

export interface LoopContext {
  iteration: number;
  totalIterations: number;
  previousResults: unknown[];
  isFirstIteration: boolean;
  isLastAllowedIteration: boolean;
}

export interface LoopOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  while: (context: WorkflowContext, loop: LoopContext) => boolean | Promise<boolean>;
  steps: WorkflowNode[] | ((context: WorkflowContext, loop: LoopContext) => WorkflowNode[]);
  maxIterations?: number;
  onMaxIterations?: (
    context: WorkflowContext,
    loop: LoopContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  onComplete?: (
    context: WorkflowContext,
    loop: LoopContext,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  iterationTimeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
  delay?: number | string;
}

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
 * Create a loop node for iterative execution.
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
 * Do-while style loop (execute at least once).
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
 * Count-based loop.
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
