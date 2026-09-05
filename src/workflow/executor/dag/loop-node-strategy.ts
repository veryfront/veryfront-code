import type {
  LoopExecutionContext,
  LoopNodeConfig,
  NodeState,
  WorkflowContext,
  WorkflowNode,
} from "../../types.ts";
import { parseDuration } from "../../types.ts";
import type { NodeExecutionResult } from "./types.ts";
import { sleep } from "#veryfront/utils";
import type { NodeStrategyRuntime } from "./node-strategy-types.ts";
import { captureWorkflowSourceIntegrationPolicy } from "../../source-integration-policy.ts";
import {
  collectWorkflowNodeIds,
  namespaceWorkflowNodes,
  removeWorkflowNodeNamespace,
} from "../../dsl/validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  applyContextPatch,
  applyRecordPatch,
  createRecordPatch,
  createSetContextPatch,
  mergeContextPatches,
} from "./context-patch.ts";

interface ExecuteLoopNodeStrategyInput {
  node: WorkflowNode;
  config: LoopNodeConfig;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  /** Declared node ids in the graph that owns this loop node. */
  parentNodeIds: ReadonlySet<string>;
  runtime: NodeStrategyRuntime;
  abortSignal?: AbortSignal;
}

const ArrayIsArray = Array.isArray;
const NumberIsSafeInteger = Number.isSafeInteger;
const ObjectHasOwn = Object.hasOwn;

/**
 * A `NodeState` in the shape that survives the context's JSON round trip.
 *
 * `WorkflowContext` is JSON-representable by contract, and `NodeState` is not:
 * `startedAt` and `completedAt` are `Date`. Writing them into the context puts
 * a value there that `JSON.stringify` rewrites, so a resumed iteration read
 * back a string where the suspending one wrote a `Date`, and the persistence
 * check reported the framework's own timestamps as user-authored lossy values.
 *
 * The encoded bytes are unchanged: `JSON.stringify` already produced these
 * strings. What changes is that the loop now writes them itself, so the value
 * in memory matches the value after a resume either way.
 */
type PersistedNodeState =
  & Omit<NodeState, "startedAt" | "completedAt">
  & {
    startedAt?: string;
    completedAt?: string;
  };

interface PersistedLoopState {
  __veryfrontLoopState?: { ownerNodeId: string; version: 1 };
  iteration: number;
  previousResults: unknown[];
  iterationNodeStates?: Record<string, PersistedNodeState>;
  completedNodeIds?: string[];
}

function isOwnedLoopState(value: unknown, nodeId: string): value is PersistedLoopState {
  if (typeof value !== "object" || value === null) return false;
  const marker = (value as PersistedLoopState).__veryfrontLoopState;
  return marker?.version === 1 && marker.ownerNodeId === nodeId;
}

function isPersistedLoopState(value: unknown): value is PersistedLoopState {
  if (
    !(typeof value === "object" && value !== null &&
      NumberIsSafeInteger((value as { iteration?: unknown }).iteration) &&
      ((value as { iteration: number }).iteration >= 0) &&
      ArrayIsArray((value as { previousResults?: unknown }).previousResults))
  ) return false;
  const state = value as PersistedLoopState;
  return state.__veryfrontLoopState?.version === 1 ||
    state.iterationNodeStates !== undefined ||
    ArrayIsArray(state.completedNodeIds);
}

/**
 * @internal Encode child node states so the context holds nothing JSON rewrites.
 *
 * Absent optional fields are dropped rather than written as `undefined`, which
 * JSON removes anyway. Keeping them would have the check report the framework's
 * own empty fields as lossy. `input` and `output` are copied through untouched:
 * they hold step values, and a step writing something JSON cannot carry is
 * exactly what the check exists to report.
 */
export function toPersistedNodeStates(
  states: Record<string, NodeState>,
): Record<string, PersistedNodeState> {
  const persisted: Record<string, PersistedNodeState> = {};
  for (const [nodeId, state] of Object.entries(states)) {
    persisted[nodeId] = {
      nodeId: state.nodeId,
      status: state.status,
      attempt: state.attempt,
      ...(state._waitInstanceId !== undefined ? { _waitInstanceId: state._waitInstanceId } : {}),
      ...(state._subWorkflowOwnerPath !== undefined
        ? { _subWorkflowOwnerPath: state._subWorkflowOwnerPath }
        : {}),
      ...(state._activeCompositeChildIds !== undefined
        ? { _activeCompositeChildIds: [...state._activeCompositeChildIds] }
        : {}),
      ...(state._completedCompositeChildIds !== undefined
        ? { _completedCompositeChildIds: [...state._completedCompositeChildIds] }
        : {}),
      ...(state.input !== undefined ? { input: state.input } : {}),
      ...(state.output !== undefined ? { output: state.output } : {}),
      ...(state.error !== undefined ? { error: state.error } : {}),
      ...(state.startedAt ? { startedAt: state.startedAt.toISOString() } : {}),
      ...(state.completedAt ? { completedAt: state.completedAt.toISOString() } : {}),
    };
  }
  return persisted;
}

/**
 * Restore child node states read back from the context.
 *
 * A run that suspended before this encoding existed holds the same strings,
 * because `JSON.stringify` is what wrote them, so no migration is needed. This
 * is also what makes a resumed iteration see the same types an in-memory one
 * sees, rather than a `Date` on one path and a string on the other.
 */
function fromPersistedNodeStates(
  states: Record<string, PersistedNodeState>,
): Record<string, NodeState> {
  const restored: Record<string, NodeState> = {};
  for (const [nodeId, state] of Object.entries(states)) {
    const { startedAt, completedAt, ...rest } = state;
    restored[nodeId] = {
      ...rest,
      ...(startedAt ? { startedAt: new Date(startedAt) } : {}),
      ...(completedAt ? { completedAt: new Date(completedAt) } : {}),
    };
  }
  return restored;
}

export async function executeLoopNodeStrategy(
  input: ExecuteLoopNodeStrategyInput,
): Promise<NodeExecutionResult> {
  const { node, config, context, nodeStates, parentNodeIds, runtime } = input;
  runtime.abortSignal?.throwIfAborted();
  const loopStateKey = `${node.id}_loop_state`;
  if (parentNodeIds.has(loopStateKey)) {
    throw INVALID_ARGUMENT.create({
      detail: `Loop node "${node.id}" reserves internal context key "${loopStateKey}", ` +
        "which collides with a declared node in the parent graph",
    });
  }
  const startTime = Date.now();
  const previousResults: unknown[] = [];
  let iteration = 0;
  let exitReason: "condition" | "maxIterations" | "error" = "condition";
  let lastError: string | undefined;
  let lastErrorCause: NodeExecutionResult["errorCause"];
  // Tracks whether the loop terminated because `while` returned false. A loop
  // that exhausts its iteration budget never trips this, so it is relabeled as
  // "maxIterations" below.
  let exitedViaCondition = false;

  const existingLoopStateValue = context[loopStateKey];
  const existingLoopState = isPersistedLoopState(existingLoopStateValue)
    ? existingLoopStateValue
    : undefined;

  // Child node states for the in-flight (resumed) iteration, so its already
  // completed steps are not re-executed on resume (H9).
  let resumeIterationNodeStates: Record<string, NodeState> | undefined;
  let resumeIteration: number | undefined;

  if (existingLoopState) {
    iteration = existingLoopState.iteration;
    previousResults.push(...existingLoopState.previousResults);
    resumeIterationNodeStates = existingLoopState.iterationNodeStates &&
      fromPersistedNodeStates(existingLoopState.iterationNodeStates);
    resumeIteration = existingLoopState.iteration;
  }

  const currentStaticChildIds = Array.isArray(config.steps)
    ? collectWorkflowNodeIds(config.steps)
    : undefined;
  const legacyStaticChildIds = Array.isArray(config.steps)
    ? collectWorkflowNodeIds(removeWorkflowNodeNamespace(`${node.id}/`, config.steps))
    : undefined;
  // Runs suspended before loop children were namespaced persist both their
  // private iteration snapshot and durable wait record under local IDs. Keep
  // that one in-flight iteration on its old graph identity; new iterations use
  // the namespaced definition and receive the collision fix.
  const resumeLegacyStaticChildIds = currentStaticChildIds !== undefined &&
    legacyStaticChildIds !== undefined &&
    resumeIterationNodeStates !== undefined &&
    hasLegacyDeclaredNodeState(
      resumeIterationNodeStates,
      currentStaticChildIds,
      legacyStaticChildIds,
    );

  let exposedIterationNodeStates: Record<string, NodeState> = resumeIterationNodeStates
    ? { ...resumeIterationNodeStates }
    : {};

  while (iteration < config.maxIterations) {
    runtime.abortSignal?.throwIfAborted();
    const loopContext: LoopExecutionContext = {
      iteration,
      totalIterations: iteration,
      previousResults: [...previousResults],
      isFirstIteration: iteration === 0,
      isLastAllowedIteration: iteration === config.maxIterations - 1,
    };

    const shouldContinue = await config.while(context, loopContext);
    runtime.abortSignal?.throwIfAborted();
    if (!shouldContinue) {
      exitReason = "condition";
      exitedViaCondition = true;
      break;
    }

    const resumingIterationNodeStates = resumeIteration === iteration
      ? resumeIterationNodeStates
      : undefined;
    let steps: WorkflowNode[];
    if (typeof config.steps === "function") {
      const generatedSteps = config.steps(context, loopContext);
      const namespacedSteps = namespaceWorkflowNodes(`${node.id}/`, generatedSteps);
      const namespacedIds = collectWorkflowNodeIds(namespacedSteps);
      const resumeLegacyDynamicChildIds = resumingIterationNodeStates !== undefined &&
        hasLegacyDeclaredNodeState(
          resumingIterationNodeStates,
          namespacedIds,
          collectWorkflowNodeIds(generatedSteps),
        );
      steps = resumeLegacyDynamicChildIds ? generatedSteps : namespacedSteps;
    } else {
      steps = resumingIterationNodeStates && resumeLegacyStaticChildIds
        ? removeWorkflowNodeNamespace(`${node.id}/`, config.steps)
        : config.steps;
    }
    runtime.abortSignal?.throwIfAborted();

    const collidingChildId = [...collectWorkflowNodeIds(steps)].find((childId) =>
      parentNodeIds.has(childId)
    );
    if (collidingChildId) {
      throw INVALID_ARGUMENT.create({
        detail: `Loop node "${node.id}" generated child id "${collidingChildId}", ` +
          "which collides with a declared node in the parent graph",
      });
    }

    // On resume, rehydrate the in-flight iteration's child node states so its
    // already-completed steps are skipped instead of re-executed (H9),
    // reconciled against the run's own map so the node that was just resolved
    // is not replayed as still pending.
    const iterationNodeStates = resumingIterationNodeStates
      ? reconcileIterationNodeStates(resumingIterationNodeStates, nodeStates)
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
      sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
    });
    runtime.abortSignal?.throwIfAborted();

    const stalledWaitingNodes = result.stalledWaitNodes ??
      (result.stalledWaitNode === undefined
        ? undefined
        : [{ nodeId: result.stalledWaitNode, waitConfig: undefined }]);
    const waitingNodes = result.waitingNodes ?? stalledWaitingNodes;
    const waiting = result.waiting || waitingNodes !== undefined;

    if (waiting) {
      // Diff the iteration against its own starting state, never against the
      // parent's map. `result.nodeStates` holds this iteration's children only,
      // so diffing the parent against it reports every completed sibling as
      // deleted -- which removes their state and gets them re-scheduled.
      applyRecordPatch(
        nodeStates,
        createRecordPatch(exposedIterationNodeStates, result.nodeStates),
      );

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
          result.contextPatch,
          createSetContextPatch({
            [loopStateKey]: {
              __veryfrontLoopState: { ownerNodeId: node.id, version: 1 },
              iteration,
              previousResults,
              // Persist the in-flight iteration's child states so completed
              // steps are not re-executed when this iteration resumes (H9).
              iterationNodeStates: toPersistedNodeStates(result.nodeStates),
            },
          }),
        ),
        waiting: true,
        waitingNode: result.waitingNode ?? waitingNodes?.[0]?.nodeId,
        waitingConfig: result.waitingConfig ?? waitingNodes?.[0]?.waitConfig,
        waitingNodes,
      };
    }

    if (result.error) {
      lastError = result.error;
      lastErrorCause = result.errorCause;
      exitReason = "error";
      break;
    }

    previousResults.push(result.context);
    applyContextPatch(context, result.contextPatch);
    applyRecordPatch(nodeStates, createRecordPatch(exposedIterationNodeStates, result.nodeStates));
    exposedIterationNodeStates = { ...result.nodeStates };

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
    ...(typeof config.steps === "function"
      ? { _completedCompositeChildIds: Object.keys(exposedIterationNodeStates) }
      : {}),
  };

  runtime.onNodeComplete?.(node.id, state);

  const contextPatch = createSetContextPatch({
    [node.id]: output,
    ...completionUpdates,
  });
  if (
    typeof config.steps === "function" && isOwnedLoopState(existingLoopStateValue, node.id) &&
    !ObjectHasOwn(completionUpdates, loopStateKey)
  ) {
    contextPatch.delete.push(loopStateKey);
  }

  return {
    state,
    contextPatch,
    waiting: false,
    errorCause: lastErrorCause,
  };
}

/** Detect an old snapshot from a declared local child, not a generated descendant. */
function hasLegacyDeclaredNodeState(
  states: Record<string, NodeState>,
  currentIds: Set<string>,
  legacyIds: Set<string>,
): boolean {
  return Object.keys(states).some((nodeId) => legacyIds.has(nodeId) && !currentIds.has(nodeId));
}

/**
 * Overlay the run's authoritative node states onto a resumed iteration's
 * snapshot.
 *
 * The snapshot is frozen at the moment the loop suspended. Whatever resolves
 * the wait afterwards -- an approval decision, a signal -- patches the run's
 * own `nodeStates` and then resumes; it has no idea the loop is holding a
 * private copy. Replaying the iteration from that copy leaves the wait node
 * `running`, so `getReadyNodes` excludes it, the step depending on it never
 * becomes ready, and the child graph reports completion having scheduled
 * nothing -- losing the step silently while the iteration looks successful.
 *
 * The run's map wins for every node it also knows about. Nodes it has never
 * heard of stay as the snapshot left them, so this cannot pull a sibling from
 * outside the loop into the iteration's graph.
 */
function reconcileIterationNodeStates(
  snapshot: Record<string, NodeState>,
  runNodeStates: Record<string, NodeState>,
): Record<string, NodeState> {
  const reconciled: Record<string, NodeState> = { ...snapshot };
  for (const [nodeId, state] of Object.entries(runNodeStates)) {
    if (nodeId in reconciled) reconciled[nodeId] = state;
  }
  return reconciled;
}
