import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";
import { validateNodeId } from "./validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

/** Default maximum number of loop iterations */
const DEFAULT_MAX_ITERATIONS = 10;

/** Absolute upper bound on loop iterations to prevent runaway loops */
const MAX_ITERATIONS_LIMIT = 100;

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

export function loop(id: string, options: LoopOptions): WorkflowNode {
  validateNodeId(id);

  if (typeof options.while !== "function") {
    throw INVALID_ARGUMENT.create({
      detail: `Loop "${id}" must have a 'while' condition function`,
    });
  }

  if (!options.steps) {
    throw INVALID_ARGUMENT.create({ detail: `Loop "${id}" must have 'steps' configured` });
  }

  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  if (maxIterations < 1) {
    throw INVALID_ARGUMENT.create({ detail: `Loop "${id}" maxIterations must be at least 1` });
  }

  if (maxIterations > MAX_ITERATIONS_LIMIT) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Loop "${id}" maxIterations cannot exceed ${MAX_ITERATIONS_LIMIT} (got ${maxIterations}). ` +
        `For higher limits, consider restructuring your workflow.`,
    });
  }

  return {
    id,
    config: {
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
    },
  };
}

export function doWhile(
  id: string,
  options: Omit<LoopOptions, "while"> & {
    until: (context: WorkflowContext, loop: LoopContext) => boolean | Promise<boolean>;
  },
): WorkflowNode {
  const { until, ...rest } = options;

  return loop(id, {
    ...rest,
    while: async (ctx, loopCtx) => {
      if (loopCtx.isFirstIteration) return true;
      return !(await until(ctx, loopCtx));
    },
  });
}

export function times(
  id: string,
  count: number,
  steps: WorkflowNode[],
  options?: Omit<LoopOptions, "while" | "steps" | "maxIterations">,
): WorkflowNode {
  return loop(id, {
    ...options,
    maxIterations: count,
    while: (_, loopCtx) => loopCtx.iteration < count,
    steps,
  });
}
