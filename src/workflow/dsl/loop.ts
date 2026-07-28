import type { BaseNodeConfig, RetryConfig, WorkflowContext, WorkflowNode } from "../types.ts";
import {
  validateDelay,
  validateExecutionPolicy,
  validateNodeId,
  validatePositiveTimeout,
} from "./validation.ts";
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

/** Options accepted by loop. */
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

/** Create a loop workflow step. */
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

  if (!Number.isSafeInteger(maxIterations)) {
    throw INVALID_ARGUMENT.create({
      detail: `Loop "${id}" maxIterations must be a positive safe integer, got: ${maxIterations}`,
    });
  }

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
  const iterationTimeout = options.iterationTimeout;
  const delay = options.delay;
  const policy = validateExecutionPolicy(`Loop "${id}"`, options);
  if (iterationTimeout !== undefined) {
    validatePositiveTimeout(
      iterationTimeout,
      `Loop "${id}" iterationTimeout`,
    );
  }
  if (delay !== undefined) {
    validateDelay(delay, `Loop "${id}" delay`);
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
      retry: policy.retry,
      timeout: policy.timeout,
      iterationTimeout,
      skip: options.skip,
      delay,
    },
  };
}

/** Create a do-while workflow loop. */
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

/** Create a fixed-count workflow loop. */
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
