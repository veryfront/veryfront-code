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
  setOwnRecordValue,
} from "./context-patch.ts";
import { materializeWorkflowContextDelta } from "../../runtime/public-run.ts";
import { runAbortableOperation } from "../abortable-operation.ts";
import { getExecutionFailure, retainExecutionFailure } from "../execution-failure.ts";
import {
  INTERNAL_RUNTIME_PROJECTION_KIND,
  INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD,
  runWithWorkflowContextProjectionTracking,
  SUBWORKFLOW_INPUT_KIND,
  type WorkflowContextProjection,
  type WorkflowProjectionPath,
} from "../../runtime-state.ts";

interface ExecuteLoopNodeStrategyInput {
  node: WorkflowNode;
  config: LoopNodeConfig;
  context: WorkflowContext;
  contextProjection: WorkflowContextProjection;
  inputKind?: typeof SUBWORKFLOW_INPUT_KIND;
  nodeStates: Record<string, NodeState>;
  runtime: NodeStrategyRuntime;
  abortSignal?: AbortSignal;
  retryExecution?: LoopRetryExecutionState;
}

interface PersistedLoopState {
  iteration: number;
  previousResults: unknown[];
  iterationNodeStates?: Record<string, NodeState>;
  stepsEvaluationContext?: WorkflowContext;
  stepsEvaluationProjection?: WorkflowContextProjection;
  iterationBaseContext?: WorkflowContext;
  iterationBaseProjection?: WorkflowContextProjection;
  previousResultsProjection?: WorkflowProjectionPath[];
}

/** In-memory admission snapshot reused by an immediate composite retry. */
export interface LoopRetryExecutionState extends PersistedLoopState {
  admittedSteps?: WorkflowNode[];
}

export interface LoopNodeStrategyResult extends NodeExecutionResult {
  retryExecution?: LoopRetryExecutionState;
}

type ProjectionMarkedLoopNodeState = NodeState & {
  readonly [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]?: WorkflowProjectionPath[];
};

function remapContextPatchProjection(
  patch: ContextPatch,
  prefix: readonly (string | number)[],
): WorkflowProjectionPath[] {
  return Object.keys(patch.set).flatMap((root) =>
    (patch.projection[root] ?? []).map((entry) => ({
      kind: entry.kind,
      path: [...prefix, root, ...entry.path],
    }))
  );
}

type ActiveIterationResult =
  | { kind: "condition-false"; contextPatch: ContextPatch }
  | {
    kind: "executed";
    contextPatch: ContextPatch;
    childResult: DAGInternalExecutionResult;
    steps: WorkflowNode[];
    stepsEvaluationContext: WorkflowContext;
    stepsEvaluationProjection: WorkflowContextProjection;
  };

export async function executeLoopNodeStrategy(
  input: ExecuteLoopNodeStrategyInput,
): Promise<LoopNodeStrategyResult> {
  const { node, config, context, contextProjection, inputKind, nodeStates, runtime } = input;
  runtime.abortSignal?.throwIfAborted();
  const startTime = Date.now();
  const iterationTimeout = config.iterationTimeout === undefined
    ? undefined
    : parsePositiveDurationWithLabel(
      config.iterationTimeout,
      `Loop "${node.id}" iterationTimeout`,
    );
  const previousResults: unknown[] = [];
  const previousResultsProjection: WorkflowProjectionPath[] = [];
  let iteration = 0;
  let exitReason: "condition" | "maxIterations" | "error" = "condition";
  let lastError: string | undefined;
  let lastFailureCause: Error | undefined;
  let retryExecution: LoopRetryExecutionState | undefined;
  // Tracks whether the loop terminated because `while` returned false. A loop
  // that exhausts its iteration budget never trips this, so it is relabeled as
  // "maxIterations" below.
  let exitedViaCondition = false;

  const existingLoopState = input.retryExecution ??
    (getOwnRecordValue(
      context,
      `${node.id}_loop_state`,
    ) as PersistedLoopState | undefined);

  // Child node states for the in-flight (resumed) iteration, so its already
  // completed steps are not re-executed on resume (H9).
  let resumeIterationNodeStates: Record<string, NodeState> | undefined;
  let resumeStepsEvaluationContext: WorkflowContext | undefined;
  let resumeStepsEvaluationProjection: WorkflowContextProjection | undefined;
  let resumeIterationBaseContext: WorkflowContext | undefined;
  let resumeIterationBaseProjection: WorkflowContextProjection | undefined;
  let resumeAdmittedSteps: WorkflowNode[] | undefined;
  let resumeIteration: number | undefined;

  if (existingLoopState) {
    iteration = existingLoopState.iteration;
    previousResults.push(...existingLoopState.previousResults);
    previousResultsProjection.push(...(existingLoopState.previousResultsProjection ?? []));
    resumeIterationNodeStates = existingLoopState.iterationNodeStates
      ? cloneExecutionState(
        existingLoopState.iterationNodeStates,
        `Loop "${node.id}" persisted iteration node states`,
      )
      : undefined;
    if (resumeIterationNodeStates) {
      // The root run is authoritative for external decisions made while this
      // iteration was paused (approval or timed-delay completion). Overlay only
      // identities already captured for this exact in-flight iteration.
      for (const childId of Object.keys(resumeIterationNodeStates)) {
        const authoritative = getOwnRecordValue(nodeStates, childId);
        if (authoritative) {
          setOwnRecordValue(
            resumeIterationNodeStates,
            childId,
            cloneExecutionState(
              authoritative,
              `Loop "${node.id}" authoritative state for "${childId}"`,
            ),
          );
        }
      }
    }
    resumeStepsEvaluationContext = existingLoopState.stepsEvaluationContext
      ? cloneExecutionState(
        existingLoopState.stepsEvaluationContext,
        `Loop "${node.id}" persisted steps evaluation context`,
      )
      : undefined;
    resumeStepsEvaluationProjection = existingLoopState.stepsEvaluationProjection
      ? cloneExecutionState(
        existingLoopState.stepsEvaluationProjection,
        `Loop "${node.id}" persisted steps evaluation projection`,
      )
      : undefined;
    resumeIterationBaseContext = existingLoopState.iterationBaseContext
      ? cloneExecutionState(
        existingLoopState.iterationBaseContext,
        `Loop "${node.id}" persisted iteration base context`,
      )
      : undefined;
    resumeIterationBaseProjection = existingLoopState.iterationBaseProjection
      ? cloneExecutionState(
        existingLoopState.iterationBaseProjection,
        `Loop "${node.id}" persisted iteration base projection`,
      )
      : undefined;
    resumeIteration = existingLoopState.iteration;
    resumeAdmittedSteps = input.retryExecution?.admittedSteps;
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

    const currentIterationContext = cloneExecutionState(
      context,
      `Loop "${node.id}" iteration ${iteration} context`,
    );
    const iterationBaseContext = resumeIteration === iteration && resumeIterationBaseContext
      ? cloneExecutionState(
        resumeIterationBaseContext,
        `Loop "${node.id}" iteration ${iteration} original base context`,
      )
      : cloneExecutionState(
        currentIterationContext,
        `Loop "${node.id}" iteration ${iteration} base context`,
      );
    const iterationBaseProjection = resumeIteration === iteration && resumeIterationBaseProjection
      ? cloneExecutionState(
        resumeIterationBaseProjection,
        `Loop "${node.id}" iteration ${iteration} original base projection`,
      )
      : cloneExecutionState(
        contextProjection,
        `Loop "${node.id}" iteration ${iteration} base projection`,
      );
    const iterationContext = cloneExecutionState(
      currentIterationContext,
      `Loop "${node.id}" iteration ${iteration} context`,
    );
    const iterationProjection = cloneExecutionState(
      contextProjection,
      `Loop "${node.id}" iteration ${iteration} projection`,
    );
    const isResumingInFlightIteration = resumeIteration === iteration &&
      resumeIterationNodeStates !== undefined;

    const activeIteration = await runAbortableOperation(
      async (iterationSignal): Promise<ActiveIterationResult> => {
        iterationSignal.throwIfAborted();
        // This condition already admitted the exact iteration whose child DAG
        // is durably paused. Re-evaluating it against context mutated by its
        // completed children can incorrectly abandon the rest of that DAG.
        if (!isResumingInFlightIteration) {
          const shouldContinue = await runWithWorkflowContextProjectionTracking(
            iterationContext,
            iterationProjection,
            (callbackContext) => config.while(callbackContext, loopContext),
          );
          iterationSignal.throwIfAborted();
          if (!shouldContinue) {
            return {
              kind: "condition-false",
              contextPatch: captureIterationContextPatch(
                iterationBaseContext,
                iterationContext,
                iterationBaseProjection,
                iterationProjection,
                node.id,
                iteration,
              ),
            };
          }
        }

        const stepsEvaluationContext = isResumingInFlightIteration &&
            resumeStepsEvaluationContext
          ? cloneExecutionState(
            resumeStepsEvaluationContext,
            `Loop "${node.id}" iteration ${iteration} resumed steps evaluation context`,
          )
          : cloneExecutionState(
            iterationContext,
            `Loop "${node.id}" iteration ${iteration} steps evaluation context`,
          );
        const stepsEvaluationProjection = isResumingInFlightIteration &&
            resumeStepsEvaluationProjection
          ? cloneExecutionState(
            resumeStepsEvaluationProjection,
            `Loop "${node.id}" iteration ${iteration} resumed steps evaluation projection`,
          )
          : cloneExecutionState(
            iterationProjection,
            `Loop "${node.id}" iteration ${iteration} steps evaluation projection`,
          );
        const stepsCallbackContext = isResumingInFlightIteration
          ? cloneExecutionState(
            stepsEvaluationContext,
            `Loop "${node.id}" iteration ${iteration} steps callback context`,
          )
          : iterationContext;
        const stepsCallbackProjection = isResumingInFlightIteration
          ? cloneExecutionState(
            stepsEvaluationProjection,
            `Loop "${node.id}" iteration ${iteration} steps callback projection`,
          )
          : iterationProjection;
        const stepsFactory = typeof config.steps === "function" ? config.steps : undefined;
        const steps = isResumingInFlightIteration && resumeAdmittedSteps
          ? resumeAdmittedSteps
          : captureWorkflowNodes(
            stepsFactory
              ? await runWithWorkflowContextProjectionTracking(
                stepsCallbackContext,
                stepsCallbackProjection,
                (callbackContext) => stepsFactory(callbackContext, loopContext),
              )
              : config.steps,
            `Loop "${node.id}" iteration ${iteration}`,
            { allowEmpty: true, emptyElementName: "step" },
          );
        iterationSignal.throwIfAborted();

        // On resume, rehydrate the in-flight iteration's child node states so
        // its already-completed steps are skipped instead of re-executed (H9).
        const iterationNodeStates = isResumingInFlightIteration
          ? cloneExecutionState(
            resumeIterationNodeStates!,
            `Loop "${node.id}" iteration ${iteration} node states`,
          )
          : {};
        // Only rehydrate once; subsequent iterations start fresh.
        resumeIterationNodeStates = undefined;
        resumeStepsEvaluationContext = undefined;
        resumeStepsEvaluationProjection = undefined;
        resumeIterationBaseContext = undefined;
        resumeIterationBaseProjection = undefined;
        resumeAdmittedSteps = undefined;

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
            _workflowProjection: {
              context: iterationProjection,
              ...(inputKind ? { inputKind } : {}),
            },
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
            iterationBaseProjection,
            iterationProjection,
            node.id,
            iteration,
          ),
          childResult,
          steps,
          stepsEvaluationContext,
          stepsEvaluationProjection,
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
      applyContextPatch(context, activeIteration.contextPatch, contextProjection);
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

      const state: ProjectionMarkedLoopNodeState = {
        nodeId: node.id,
        status: "running",
        output: { iteration, waiting: true, previousResults },
        attempt: 1,
        startedAt: new Date(startTime),
        ...(previousResultsProjection.length > 0
          ? {
            [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: previousResultsProjection,
          }
          : {}),
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
              // Dynamic step selection must be recomputed from the same
              // pre-child context, not partial outputs committed before wait.
              stepsEvaluationContext: activeIteration.stepsEvaluationContext,
              stepsEvaluationProjection: activeIteration.stepsEvaluationProjection,
              // Preserve the pre-child baseline so a resumed iteration's
              // materialized result includes work completed before the wait.
              iterationBaseContext,
              iterationBaseProjection,
              previousResultsProjection,
            },
          }, {
            [`${node.id}_loop_state`]: [{
              kind: INTERNAL_RUNTIME_PROJECTION_KIND,
              path: [],
            }],
          }),
        ),
        waiting: true,
      };
    }

    if (result.error) {
      // Preserve the admitted iteration transaction inside this node attempt.
      // The outer DAG will still discard it if all retries fail, but the next
      // immediate retry can skip completed children without re-running `while`
      // or selecting a different dynamic child graph.
      applyContextPatch(context, iterationContextPatch, contextProjection);
      applyRecordPatch(nodeStates, createRecordPatch({}, result.nodeStates));
      retryExecution = {
        iteration,
        previousResults: [...previousResults],
        previousResultsProjection: [...previousResultsProjection],
        iterationNodeStates: cloneExecutionState(
          result.nodeStates,
          `Loop "${node.id}" retry node states`,
        ),
        stepsEvaluationContext: cloneExecutionState(
          activeIteration.stepsEvaluationContext,
          `Loop "${node.id}" retry steps evaluation context`,
        ),
        stepsEvaluationProjection: cloneExecutionState(
          activeIteration.stepsEvaluationProjection,
          `Loop "${node.id}" retry steps evaluation projection`,
        ),
        iterationBaseContext: cloneExecutionState(
          iterationBaseContext,
          `Loop "${node.id}" retry base context`,
        ),
        iterationBaseProjection: cloneExecutionState(
          iterationBaseProjection,
          `Loop "${node.id}" retry base projection`,
        ),
        admittedSteps: activeIteration.steps,
      };
      lastError = result.error;
      lastFailureCause = getExecutionFailure(result);
      exitReason = "error";
      break;
    }

    const previousResultIndex = previousResults.length;
    previousResults.push(materializeWorkflowContextDelta(iterationContextPatch.set));
    previousResultsProjection.push(...remapContextPatchProjection(
      iterationContextPatch,
      ["previousResults", previousResultIndex],
    ));
    applyContextPatch(context, iterationContextPatch, contextProjection);
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
    completionUpdates = await runWithWorkflowContextProjectionTracking(
      context,
      contextProjection,
      (callbackContext) => config.onMaxIterations!(callbackContext, finalLoopContext),
    );
    runtime.abortSignal?.throwIfAborted();
  } else if (exitReason === "condition" && config.onComplete) {
    completionUpdates = await runWithWorkflowContextProjectionTracking(
      context,
      contextProjection,
      (callbackContext) => config.onComplete!(callbackContext, finalLoopContext),
    );
    runtime.abortSignal?.throwIfAborted();
  }

  const output = {
    exitReason,
    iterations: iteration,
    previousResults,
    ...completionUpdates,
  };

  const state: ProjectionMarkedLoopNodeState = {
    nodeId: node.id,
    status: exitReason === "error" ? "failed" : "completed",
    output,
    error: lastError,
    attempt: 1,
    startedAt: new Date(startTime),
    completedAt: new Date(),
    ...(previousResultsProjection.length > 0
      ? { [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: previousResultsProjection }
      : {}),
  };

  runtime.onNodeComplete?.(node.id, state);

  const completionPatch = createSetContextPatch(
    {
      [node.id]: output,
      ...completionUpdates,
    },
    { [node.id]: previousResultsProjection },
  );
  completionPatch.delete.push(`${node.id}_loop_state`);

  return retainExecutionFailure({
    state,
    contextPatch: completionPatch,
    waiting: false,
    ...(retryExecution ? { retryExecution } : {}),
  }, lastFailureCause);
}

function captureIterationContextPatch(
  before: WorkflowContext,
  after: WorkflowContext,
  beforeProjection: WorkflowContextProjection,
  afterProjection: WorkflowContextProjection,
  nodeId: string,
  iteration: number,
): ContextPatch {
  return cloneExecutionState(
    createContextPatch(before, after, beforeProjection, afterProjection),
    `Loop "${nodeId}" iteration ${iteration} context changes`,
  );
}
