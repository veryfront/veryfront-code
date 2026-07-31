import type {
  LoopExecutionContext,
  LoopNodeConfig,
  NodeState,
  WorkflowContext,
  WorkflowGraphIdentity,
  WorkflowNode,
} from "../../types.ts";
import { parseDuration, parsePositiveDurationWithLabel } from "../../types.ts";
import type { ContextPatch, DAGInternalExecutionResult, NodeExecutionResult } from "./types.ts";
import { sleep } from "#veryfront/utils";
import { ORCHESTRATION_ERROR, TIMEOUT_ERROR } from "#veryfront/errors";
import type {
  CheckpointResumeSnapshot,
  CheckpointResumeTransform,
  NodeStrategyRuntime,
} from "./node-strategy-types.ts";
import { captureWorkflowSourceIntegrationPolicy } from "../../source-integration-policy.ts";
import { captureWorkflowNodes } from "../workflow-definition-snapshot.ts";
import { captureCanonicalWorkflowGraphIdentity } from "./graph-identity.ts";
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
  workflowRuntimeValuesEqual,
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
  checkpointResumeTransform?: CheckpointResumeTransform;
  transactionContext: WorkflowContext;
  transactionProjection: WorkflowContextProjection;
  activeAttempt: number;
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
  iterationContext?: WorkflowContext;
  iterationContextProjection?: WorkflowContextProjection;
  stepsGraphIdentity?: WorkflowGraphIdentity;
  admissionContextPatch?: ContextPatch;
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

function chainCheckpointResumeTransform(
  upstream: CheckpointResumeTransform | undefined,
  wrap: CheckpointResumeTransform,
): CheckpointResumeTransform {
  return (snapshot) => {
    const parentSnapshot = wrap(snapshot);
    return upstream ? upstream(parentSnapshot) : parentSnapshot;
  };
}

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
    stepsGraphIdentity: WorkflowGraphIdentity;
  };

export async function executeLoopNodeStrategy(
  input: ExecuteLoopNodeStrategyInput,
): Promise<LoopNodeStrategyResult> {
  const {
    node,
    config,
    context,
    contextProjection,
    inputKind,
    nodeStates,
    runtime,
    transactionContext,
    transactionProjection,
    activeAttempt,
  } = input;
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
  const admissionContextPatch = cloneExecutionState(
    existingLoopState?.admissionContextPatch ??
      createContextPatch(
        transactionContext,
        context,
        transactionProjection,
        contextProjection,
      ),
    `Loop "${node.id}" admission context patch`,
  );

  // Child node states for the in-flight (resumed) iteration, so its already
  // completed steps are not re-executed on resume (H9).
  let resumeIterationNodeStates: Record<string, NodeState> | undefined;
  let resumeStepsEvaluationContext: WorkflowContext | undefined;
  let resumeStepsEvaluationProjection: WorkflowContextProjection | undefined;
  let resumeIterationBaseContext: WorkflowContext | undefined;
  let resumeIterationBaseProjection: WorkflowContextProjection | undefined;
  let resumeAdmittedSteps: WorkflowNode[] | undefined;
  let resumeIteration: number | undefined;
  let resumeIterationContext: WorkflowContext | undefined;
  let resumeIterationContextProjection: WorkflowContextProjection | undefined;
  let resumeStepsGraphIdentity: WorkflowGraphIdentity | undefined;

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
    resumeIterationContext = existingLoopState.iterationContext
      ? cloneExecutionState(
        existingLoopState.iterationContext,
        `Loop "${node.id}" persisted iteration context`,
      )
      : undefined;
    resumeIterationContextProjection = existingLoopState.iterationContextProjection
      ? cloneExecutionState(
        existingLoopState.iterationContextProjection,
        `Loop "${node.id}" persisted iteration context projection`,
      )
      : undefined;
    resumeStepsGraphIdentity = existingLoopState.stepsGraphIdentity
      ? cloneExecutionState(
        existingLoopState.stepsGraphIdentity,
        `Loop "${node.id}" persisted steps graph identity`,
      )
      : undefined;
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

    const currentIterationContext = resumeIteration === iteration && resumeIterationContext
      ? cloneExecutionState(
        resumeIterationContext,
        `Loop "${node.id}" iteration ${iteration} resumed context`,
      )
      : cloneExecutionState(
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
    const iterationProjection = resumeIteration === iteration && resumeIterationContextProjection
      ? cloneExecutionState(
        resumeIterationContextProjection,
        `Loop "${node.id}" iteration ${iteration} resumed projection`,
      )
      : cloneExecutionState(
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
        const stepsGraphIdentity = captureCanonicalWorkflowGraphIdentity(steps);
        if (
          isResumingInFlightIteration && resumeStepsGraphIdentity !== undefined &&
          !workflowRuntimeValuesEqual(resumeStepsGraphIdentity, stepsGraphIdentity)
        ) {
          throw ORCHESTRATION_ERROR.create({
            detail:
              `Cannot resume loop "${node.id}" iteration ${iteration} because its admitted graph changed`,
          });
        }
        if (
          isResumingInFlightIteration && resumeStepsGraphIdentity === undefined &&
          typeof config.steps === "function"
        ) {
          throw ORCHESTRATION_ERROR.create({
            detail:
              `Cannot safely resume legacy dynamic loop "${node.id}" without an admitted graph identity`,
          });
        }

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
        resumeIterationContext = undefined;
        resumeIterationContextProjection = undefined;
        resumeStepsGraphIdentity = undefined;

        const loopCheckpointResumeTransform = chainCheckpointResumeTransform(
          input.checkpointResumeTransform,
          (childSnapshot): CheckpointResumeSnapshot => {
            const privateIterationContext = cloneExecutionState(
              childSnapshot.context,
              `Loop "${node.id}" checkpoint iteration context`,
            );
            Reflect.deleteProperty(privateIterationContext, "_loop");
            const persistedLoopState: PersistedLoopState = {
              iteration,
              previousResults: cloneExecutionState(
                previousResults,
                `Loop "${node.id}" checkpoint previous results`,
              ),
              previousResultsProjection: cloneExecutionState(
                previousResultsProjection,
                `Loop "${node.id}" checkpoint previous result projection`,
              ),
              iterationNodeStates: cloneExecutionState(
                childSnapshot.nodeStates,
                `Loop "${node.id}" checkpoint iteration node states`,
              ),
              stepsEvaluationContext: cloneExecutionState(
                stepsEvaluationContext,
                `Loop "${node.id}" checkpoint steps evaluation context`,
              ),
              stepsEvaluationProjection: cloneExecutionState(
                stepsEvaluationProjection,
                `Loop "${node.id}" checkpoint steps evaluation projection`,
              ),
              iterationBaseContext: cloneExecutionState(
                iterationBaseContext,
                `Loop "${node.id}" checkpoint iteration base context`,
              ),
              iterationBaseProjection: cloneExecutionState(
                iterationBaseProjection,
                `Loop "${node.id}" checkpoint iteration base projection`,
              ),
              iterationContext: privateIterationContext,
              iterationContextProjection: cloneExecutionState(
                childSnapshot.workflowProjection.context,
                `Loop "${node.id}" checkpoint iteration projection`,
              ),
              stepsGraphIdentity: cloneExecutionState(
                stepsGraphIdentity,
                `Loop "${node.id}" checkpoint steps graph identity`,
              ),
              admissionContextPatch: cloneExecutionState(
                admissionContextPatch,
                `Loop "${node.id}" checkpoint admission context patch`,
              ),
            };
            const parentContext = cloneExecutionState(
              transactionContext,
              `Loop "${node.id}" checkpoint transaction context`,
            );
            setOwnRecordValue(parentContext, `${node.id}_loop_state`, persistedLoopState);
            const parentProjection: WorkflowContextProjection = cloneExecutionState(
              transactionProjection,
              `Loop "${node.id}" checkpoint transaction projection`,
            );
            setOwnRecordValue<WorkflowProjectionPath[]>(
              parentProjection,
              `${node.id}_loop_state`,
              [{
                kind: INTERNAL_RUNTIME_PROJECTION_KIND,
                path: [],
              }],
            );
            const parentNodeStates = cloneExecutionState(
              nodeStates,
              `Loop "${node.id}" checkpoint parent node states`,
            );
            applyRecordPatch(
              parentNodeStates,
              createRecordPatch({}, childSnapshot.nodeStates),
            );
            const parentState: ProjectionMarkedLoopNodeState = {
              nodeId: node.id,
              status: "running",
              output: { iteration, waiting: true, previousResults },
              attempt: activeAttempt,
              startedAt: getOwnRecordValue(nodeStates, node.id)?.startedAt ??
                new Date(startTime),
              ...(previousResultsProjection.length > 0
                ? {
                  [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: previousResultsProjection,
                }
                : {}),
            };
            setOwnRecordValue(parentNodeStates, node.id, parentState);
            return {
              ownerNodeId: node.id,
              context: parentContext,
              nodeStates: parentNodeStates,
              workflowProjection: {
                context: parentProjection,
                ...(inputKind ? { inputKind } : {}),
              },
            };
          },
        );
        const admissionLoopState: PersistedLoopState = {
          iteration,
          previousResults: cloneExecutionState(
            previousResults,
            `Loop "${node.id}" admission previous results`,
          ),
          previousResultsProjection: cloneExecutionState(
            previousResultsProjection,
            `Loop "${node.id}" admission previous result projection`,
          ),
          iterationNodeStates: cloneExecutionState(
            iterationNodeStates,
            `Loop "${node.id}" admission iteration node states`,
          ),
          stepsEvaluationContext: cloneExecutionState(
            stepsEvaluationContext,
            `Loop "${node.id}" admission steps evaluation context`,
          ),
          stepsEvaluationProjection: cloneExecutionState(
            stepsEvaluationProjection,
            `Loop "${node.id}" admission steps evaluation projection`,
          ),
          iterationBaseContext: cloneExecutionState(
            iterationBaseContext,
            `Loop "${node.id}" admission iteration base context`,
          ),
          iterationBaseProjection: cloneExecutionState(
            iterationBaseProjection,
            `Loop "${node.id}" admission iteration base projection`,
          ),
          iterationContext: cloneExecutionState(
            iterationContext,
            `Loop "${node.id}" admission iteration context`,
          ),
          iterationContextProjection: cloneExecutionState(
            iterationProjection,
            `Loop "${node.id}" admission iteration projection`,
          ),
          stepsGraphIdentity: cloneExecutionState(
            stepsGraphIdentity,
            `Loop "${node.id}" admission steps graph identity`,
          ),
          admissionContextPatch: cloneExecutionState(
            admissionContextPatch,
            `Loop "${node.id}" admission context patch`,
          ),
        };
        const admissionParentContext = cloneExecutionState(
          transactionContext,
          `Loop "${node.id}" admission parent context`,
        );
        setOwnRecordValue(
          admissionParentContext,
          `${node.id}_loop_state`,
          admissionLoopState,
        );
        const admissionParentProjection: WorkflowContextProjection = cloneExecutionState(
          transactionProjection,
          `Loop "${node.id}" admission parent projection`,
        );
        setOwnRecordValue<WorkflowProjectionPath[]>(
          admissionParentProjection,
          `${node.id}_loop_state`,
          [{ kind: INTERNAL_RUNTIME_PROJECTION_KIND, path: [] }],
        );
        const admissionParentNodeStates = cloneExecutionState(
          nodeStates,
          `Loop "${node.id}" admission parent node states`,
        );
        applyRecordPatch(
          admissionParentNodeStates,
          createRecordPatch({}, iterationNodeStates),
        );
        setOwnRecordValue(
          admissionParentNodeStates,
          node.id,
          {
            nodeId: node.id,
            status: "running",
            output: { iteration, waiting: true, previousResults },
            attempt: activeAttempt,
            startedAt: new Date(startTime),
            ...(previousResultsProjection.length > 0
              ? { [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: previousResultsProjection }
              : {}),
          } satisfies ProjectionMarkedLoopNodeState,
        );
        await runtime.persistCheckpoint?.(
          node.id,
          admissionParentContext,
          {
            context: admissionParentProjection,
            ...(inputKind ? { inputKind } : {}),
          },
          admissionParentNodeStates,
          input.checkpointResumeTransform,
        );
        iterationSignal.throwIfAborted();

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
          {
            abortSignal: iterationSignal,
            checkpointResumeTransform: loopCheckpointResumeTransform,
          },
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
          stepsGraphIdentity,
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
        attempt: activeAttempt,
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
          admissionContextPatch,
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
              stepsGraphIdentity: activeIteration.stepsGraphIdentity,
              admissionContextPatch,
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
        stepsGraphIdentity: activeIteration.stepsGraphIdentity,
        admissionContextPatch,
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
    attempt: activeAttempt,
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
    contextPatch: mergeContextPatches(admissionContextPatch, completionPatch),
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
