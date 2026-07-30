import type {
  LoopExecutionContext,
  LoopNodeConfig,
  NodeState,
  WorkflowContext,
  WorkflowNode,
} from "../../types.ts";
import { parseDuration, parsePositiveDurationWithLabel } from "../../types.ts";
import type { ContextPatch, DAGInternalExecutionResult, NodeExecutionResult } from "./types.ts";
import { sleep } from "#veryfront/utils";
import { TIMEOUT_ERROR } from "#veryfront/errors";
import type { NodeStrategyRuntime } from "./node-strategy-types.ts";
import { captureWorkflowSourceIntegrationPolicy } from "../../source-integration-policy.ts";
import { captureWorkflowNodes } from "../workflow-definition-snapshot.ts";
import {
  applyContextPatch,
  applyRecordPatch,
  cloneExecutionState,
  createContextPatch,
  createRecordPatch,
  createSetContextPatch,
  getOwnRecordValue,
  mergeContextPatches,
} from "./context-patch.ts";
import { runAbortableOperation } from "../abortable-operation.ts";
import { getExecutionFailure, retainExecutionFailure } from "../execution-failure.ts";

interface ExecuteLoopNodeStrategyInput {
  node: WorkflowNode;
  config: LoopNodeConfig;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  runtime: NodeStrategyRuntime;
  abortSignal?: AbortSignal;
}

interface PersistedLoopState {
  iteration: number;
  previousResults: unknown[];
  iterationNodeStates?: Record<string, NodeState>;
}

type ActiveIterationResult =
  | { kind: "condition-false"; contextPatch: ContextPatch }
  | {
    kind: "executed";
    contextPatch: ContextPatch;
    childResult: DAGInternalExecutionResult;
  };

export async function executeLoopNodeStrategy(
  input: ExecuteLoopNodeStrategyInput,
): Promise<NodeExecutionResult> {
  const { node, config, context, nodeStates, runtime } = input;
  runtime.abortSignal?.throwIfAborted();
  const startTime = Date.now();
  const iterationTimeout = config.iterationTimeout === undefined
    ? undefined
    : parsePositiveDurationWithLabel(
      config.iterationTimeout,
      `Loop "${node.id}" iterationTimeout`,
    );
  const previousResults: unknown[] = [];
  let iteration = 0;
  let exitReason: "condition" | "maxIterations" | "error" = "condition";
  let lastError: string | undefined;
  let lastFailureCause: Error | undefined;
  // Tracks whether the loop terminated because `while` returned false. A loop
  // that exhausts its iteration budget never trips this, so it is relabeled as
  // "maxIterations" below.
  let exitedViaCondition = false;

  const existingLoopState = getOwnRecordValue(
    context,
    `${node.id}_loop_state`,
  ) as PersistedLoopState | undefined;

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
    runtime.abortSignal?.throwIfAborted();
    const loopContext: LoopExecutionContext = {
      iteration,
      totalIterations: iteration,
      previousResults: [...previousResults],
      isFirstIteration: iteration === 0,
      isLastAllowedIteration: iteration === config.maxIterations - 1,
    };

    const iterationBaseContext = cloneExecutionState(
      context,
      `Loop "${node.id}" iteration ${iteration} context`,
    );
    const iterationContext = cloneExecutionState(
      iterationBaseContext,
      `Loop "${node.id}" iteration ${iteration} context`,
    );

    const activeIteration = await runAbortableOperation(
      async (iterationSignal): Promise<ActiveIterationResult> => {
        iterationSignal.throwIfAborted();
        const shouldContinue = await config.while(iterationContext, loopContext);
        iterationSignal.throwIfAborted();
        if (!shouldContinue) {
          return {
            kind: "condition-false",
            contextPatch: captureIterationContextPatch(
              iterationBaseContext,
              iterationContext,
              node.id,
              iteration,
            ),
          };
        }

        const rawSteps = typeof config.steps === "function"
          ? config.steps(iterationContext, loopContext)
          : config.steps;
        iterationSignal.throwIfAborted();
        const steps = captureWorkflowNodes(
          rawSteps,
          `Loop "${node.id}" iteration ${iteration}`,
          { allowEmpty: true, emptyElementName: "step" },
        );
        iterationSignal.throwIfAborted();

        // On resume, rehydrate the in-flight iteration's child node states so
        // its already-completed steps are skipped instead of re-executed (H9).
        const iterationNodeStates = resumeIteration === iteration && resumeIterationNodeStates
          ? cloneExecutionState(
            resumeIterationNodeStates,
            `Loop "${node.id}" iteration ${iteration} node states`,
          )
          : {};
        // Only rehydrate once; subsequent iterations start fresh.
        resumeIterationNodeStates = undefined;

        const childResult = await runtime.executeChildGraph(
          steps,
          {
            id: `${node.id}_iter_${iteration}`,
            workflowId: "",
            status: "running",
            input: iterationContext.input,
            nodeStates: iterationNodeStates,
            currentNodes: [],
            context: { ...iterationContext, _loop: loopContext },
            checkpoints: [],
            pendingApprovals: [],
            createdAt: new Date(),
            sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
          },
          { abortSignal: iterationSignal },
        );
        iterationSignal.throwIfAborted();

        return {
          kind: "executed",
          contextPatch: captureIterationContextPatch(
            iterationBaseContext,
            iterationContext,
            node.id,
            iteration,
          ),
          childResult,
        };
      },
      {
        label: `Loop "${node.id}" iteration ${iteration}`,
        parentSignal: runtime.abortSignal,
        cancellationGracePeriod: runtime.cancellationGracePeriod,
        timeout: iterationTimeout === undefined ? undefined : {
          milliseconds: iterationTimeout,
          reason: TIMEOUT_ERROR.create({
            detail:
              `Loop "${node.id}" iteration ${iteration} timed out after ${iterationTimeout}ms`,
          }),
        },
      },
    );

    if (activeIteration.kind === "condition-false") {
      applyContextPatch(context, activeIteration.contextPatch);
      exitReason = "condition";
      exitedViaCondition = true;
      break;
    }

    const result = activeIteration.childResult;
    const iterationContextPatch = mergeContextPatches(
      activeIteration.contextPatch,
      result.contextPatch,
    );

    if (result.waiting) {
      applyRecordPatch(nodeStates, createRecordPatch({}, result.nodeStates));

      const state: NodeState = {
        nodeId: node.id,
        status: "running",
        output: { iteration, waiting: true, previousResults },
        attempt: 1,
        startedAt: new Date(startTime),
      };

      return {
        state,
        contextPatch: mergeContextPatches(
          iterationContextPatch,
          createSetContextPatch({
            [`${node.id}_loop_state`]: {
              iteration,
              previousResults,
              // Persist the in-flight iteration's child states so completed
              // steps are not re-executed when this iteration resumes (H9).
              iterationNodeStates: result.nodeStates,
            },
          }),
        ),
        waiting: true,
      };
    }

    if (result.error) {
      lastError = result.error;
      lastFailureCause = getExecutionFailure(result);
      exitReason = "error";
      break;
    }

    previousResults.push(result.context);
    applyContextPatch(context, iterationContextPatch);
    applyRecordPatch(nodeStates, createRecordPatch({}, result.nodeStates));

    if (config.delay && iteration < config.maxIterations - 1) {
      const delayMs = typeof config.delay === "number" ? config.delay : parseDuration(config.delay);
      await sleep(delayMs, runtime.abortSignal);
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
    runtime.abortSignal?.throwIfAborted();
  } else if (exitReason === "condition" && config.onComplete) {
    completionUpdates = await config.onComplete(context, finalLoopContext);
    runtime.abortSignal?.throwIfAborted();
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

  return retainExecutionFailure({
    state,
    contextPatch: createSetContextPatch({
      [node.id]: output,
      ...completionUpdates,
    }),
    waiting: false,
  }, lastFailureCause);
}

function captureIterationContextPatch(
  before: WorkflowContext,
  after: WorkflowContext,
  nodeId: string,
  iteration: number,
): ContextPatch {
  return cloneExecutionState(
    createContextPatch(before, after),
    `Loop "${nodeId}" iteration ${iteration} context changes`,
  );
}
