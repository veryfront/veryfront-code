import type {
  LoopExecutionContext,
  LoopNodeConfig,
  NodeState,
  WorkflowContext,
  WorkflowNode,
} from "../../types.ts";
import { parseDuration } from "../../types.ts";
import type { NodeExecutionResult } from "./types.ts";
import { sleep } from "./utils.ts";
import type { NodeStrategyRuntime } from "./node-strategy-types.ts";

interface ExecuteLoopNodeStrategyInput {
  node: WorkflowNode;
  config: LoopNodeConfig;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  runtime: NodeStrategyRuntime;
}

interface PersistedLoopState {
  iteration: number;
  previousResults: unknown[];
  iterationNodeStates?: Record<string, NodeState>;
}

export async function executeLoopNodeStrategy(
  input: ExecuteLoopNodeStrategyInput,
): Promise<NodeExecutionResult> {
  const { node, config, context, nodeStates, runtime } = input;
  const startTime = Date.now();
  const previousResults: unknown[] = [];
  let iteration = 0;
  let exitReason: "condition" | "maxIterations" | "error" = "condition";
  let lastError: string | undefined;
  // Tracks whether the loop terminated because `while` returned false. A loop
  // that exhausts its iteration budget never trips this, so it is relabeled as
  // "maxIterations" below.
  let exitedViaCondition = false;

  const existingLoopState = context[`${node.id}_loop_state`] as PersistedLoopState | undefined;

  // Child node states for the in-flight (resumed) iteration, so its already
  // completed steps are not re-executed on resume (H9).
  let resumeIterationNodeStates: Record<string, NodeState> | undefined;
  let resumeIteration: number | undefined;

  if (existingLoopState) {
    iteration = existingLoopState.iteration;
    previousResults.push(...existingLoopState.previousResults);
    resumeIterationNodeStates = existingLoopState.iterationNodeStates;
    resumeIteration = existingLoopState.iteration;
  }

  while (iteration < config.maxIterations) {
    const loopContext: LoopExecutionContext = {
      iteration,
      totalIterations: iteration,
      previousResults: [...previousResults],
      isFirstIteration: iteration === 0,
      isLastAllowedIteration: iteration === config.maxIterations - 1,
    };

    if (!(await config.while(context, loopContext))) {
      exitReason = "condition";
      exitedViaCondition = true;
      break;
    }

    const steps = typeof config.steps === "function"
      ? config.steps(context, loopContext)
      : config.steps;

    // On resume, rehydrate the in-flight iteration's child node states so its
    // already-completed steps are skipped instead of re-executed (H9).
    const iterationNodeStates = resumeIteration === iteration && resumeIterationNodeStates
      ? { ...resumeIterationNodeStates }
      : {};
    // Only rehydrate once; subsequent iterations start fresh.
    resumeIterationNodeStates = undefined;

    const result = await runtime.executeChildGraph(steps, {
      id: `${node.id}_iter_${iteration}`,
      workflowId: "",
      status: "running",
      input: context.input,
      nodeStates: iterationNodeStates,
      currentNodes: [],
      context: { ...context, _loop: loopContext },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    });

    if (result.waiting) {
      Object.assign(nodeStates, result.nodeStates);

      const state: NodeState = {
        nodeId: node.id,
        status: "running",
        output: { iteration, waiting: true, previousResults },
        attempt: 1,
        startedAt: new Date(startTime),
      };

      return {
        state,
        contextUpdates: {
          ...result.context,
          [`${node.id}_loop_state`]: {
            iteration,
            previousResults,
            // Persist the in-flight iteration's child states so completed
            // steps are not re-executed when this iteration resumes (H9).
            iterationNodeStates: result.nodeStates,
          },
        },
        waiting: true,
      };
    }

    if (result.error) {
      lastError = result.error;
      exitReason = "error";
      break;
    }

    previousResults.push(result.context);
    Object.assign(context, result.context);
    Object.assign(nodeStates, result.nodeStates);

    if (config.delay && iteration < config.maxIterations - 1) {
      const delayMs = typeof config.delay === "number" ? config.delay : parseDuration(config.delay);
      await sleep(delayMs);
    }

    iteration++;
  }

  if (exitReason !== "error" && !exitedViaCondition) {
    exitReason = "maxIterations";
  }

  const finalLoopContext: LoopExecutionContext = {
    iteration,
    totalIterations: iteration,
    previousResults,
    isFirstIteration: false,
    isLastAllowedIteration: true,
  };

  let completionUpdates: Record<string, unknown> = {};
  if (exitReason === "maxIterations" && config.onMaxIterations) {
    completionUpdates = await config.onMaxIterations(context, finalLoopContext);
  } else if (exitReason === "condition" && config.onComplete) {
    completionUpdates = await config.onComplete(context, finalLoopContext);
  }

  const output = {
    exitReason,
    iterations: iteration,
    previousResults,
    ...completionUpdates,
  };

  const state: NodeState = {
    nodeId: node.id,
    status: exitReason === "error" ? "failed" : "completed",
    output,
    error: lastError,
    attempt: 1,
    startedAt: new Date(startTime),
    completedAt: new Date(),
  };

  runtime.onNodeComplete?.(node.id, state);

  return {
    state,
    contextUpdates: {
      [node.id]: output,
      ...completionUpdates,
    },
    waiting: false,
  };
}
