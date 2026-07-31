/**
 * DAG Executor
 *
 * Executes workflow DAGs with proper dependency ordering and parallel execution.
 *
 * @module ai/workflow/executor/dag
 */

import type {
  BranchNodeConfig,
  Checkpoint,
  NodeState,
  ParallelNodeConfig,
  SubWorkflowNodeConfig,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowRun,
} from "../../types.ts";
import { generateId, parseDurationWithLabel } from "../../types.ts";
import {
  captureWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../../source-integration-policy.ts";
import {
  ensureError,
  INVALID_ARGUMENT,
  NOT_SUPPORTED,
  ORCHESTRATION_ERROR,
} from "#veryfront/errors";
import type { CheckpointOwnership } from "../checkpoint-manager.ts";

export type { DAGExecutionResult, DAGExecutorConfig, NodeExecutionResult } from "./types.ts";

import type {
  ContextPatch,
  DAGExecutionResult,
  DAGExecutorConfig,
  DAGExecutorInternalConfig,
  DAGInternalExecutionResult,
  NodeExecutionResult,
} from "./types.ts";
import { deriveNodeStatus, shouldCheckpoint } from "./utils.ts";
import { buildGraph, getReadyNodes, hasCycle, updateInDegreesForCompletedNodes } from "./graph.ts";
import { executeLoopNodeStrategy, type LoopRetryExecutionState } from "./loop-node-strategy.ts";
import { executeMapNodeStrategy, type MapRetryExecutionState } from "./map-node-strategy.ts";
import type { ChildGraphExecutionOptions } from "./node-strategy-types.ts";
import { executeCompositeNodeWithPolicy } from "./composite-node-execution.ts";
import { canonicalizeWorkflowNodes } from "./node-identity.ts";
import { findStaticNodeAdmissionFailure, validateRuntimeNodeOptions } from "./node-admission.ts";
import {
  captureWorkflowNodes,
  captureWorkflowStaticValue,
  cloneCapturedWorkflowStaticValue,
} from "../workflow-definition-snapshot.ts";
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
import { throwIfAbortedWithCleanup } from "../abortable-operation.ts";
import { getExecutionFailure, retainExecutionFailure } from "../execution-failure.ts";
import { getConfiguredTimedWaitKind, INTERNAL_WAIT_KIND_FIELD } from "../../timed-wait-state.ts";
import {
  captureWorkflowContextProjection,
  FRAMEWORK_CONTEXT_PROJECTION_KIND,
  INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD,
  INTERNAL_SUBWORKFLOW_STATE_FIELD,
  INTERNAL_WORKFLOW_INPUT_KIND_FIELD,
  INTERNAL_WORKFLOW_OUTPUT_KIND_FIELD,
  INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD,
  runWithWorkflowContextProjectionTracking,
  SUBWORKFLOW_CONTEXT_OUTPUT_KIND,
  SUBWORKFLOW_INPUT_KIND,
  type WorkflowContextProjection,
  type WorkflowProjectionPath,
  type WorkflowProjectionState,
  workflowRuntimeValuesEqual,
} from "../../runtime-state.ts";

const DEFAULT_MAX_CONCURRENCY = 10;

function isReentrantCompositeNode(node: WorkflowNode): boolean {
  return node.config.type === "parallel" || node.config.type === "branch" ||
    node.config.type === "loop" || node.config.type === "map" ||
    node.config.type === "subWorkflow";
}

interface PersistedSubWorkflowExecutionState {
  readonly input: unknown;
  readonly stepsEvaluationContext: WorkflowContext;
  readonly stepsEvaluationProjection: WorkflowContextProjection;
  readonly context: WorkflowContext;
  readonly contextProjection: WorkflowContextProjection;
}

type PersistedSubWorkflowNodeState = NodeState & {
  readonly [INTERNAL_SUBWORKFLOW_STATE_FIELD]?: PersistedSubWorkflowExecutionState;
  readonly [INTERNAL_WORKFLOW_OUTPUT_KIND_FIELD]?: typeof SUBWORKFLOW_CONTEXT_OUTPUT_KIND;
  readonly [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]?: WorkflowProjectionPath[];
};

type ProjectionMarkedNodeState = NodeState & {
  readonly [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]?: WorkflowProjectionPath[];
  readonly [INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD]?: ContextPatch;
};

function remapContextPatchProjection(
  patch: ContextPatch,
  prefix: readonly (string | number)[] = [],
): WorkflowProjectionPath[] {
  const paths: WorkflowProjectionPath[] = [];
  for (const root of Object.keys(patch.set)) {
    for (const entry of patch.projection[root] ?? []) {
      paths.push({ kind: entry.kind, path: [...prefix, root, ...entry.path] });
    }
  }
  return paths;
}

function remapWorkflowContextProjection(
  projection: WorkflowContextProjection,
  prefix: readonly (string | number)[] = [],
): WorkflowProjectionPath[] {
  return Object.entries(projection).flatMap(([root, paths]) =>
    paths.map((entry) => ({
      kind: entry.kind,
      path: [...prefix, root, ...entry.path],
    }))
  );
}

export class DAGExecutor {
  private config: DAGExecutorInternalConfig;

  constructor(config: DAGExecutorConfig) {
    const {
      maxConcurrency = DEFAULT_MAX_CONCURRENCY,
      cancellationGracePeriod,
      debug = false,
      ...rest
    } = config;
    if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
      throw INVALID_ARGUMENT.create({
        detail: `maxConcurrency must be a positive safe integer, got: ${maxConcurrency}`,
      });
    }
    const validatedCancellationGracePeriod = cancellationGracePeriod === undefined
      ? undefined
      : parseDurationWithLabel(
        cancellationGracePeriod,
        "DAGExecutor cancellationGracePeriod",
      );

    this.config = {
      ...rest,
      maxConcurrency,
      cancellationGracePeriod: validatedCancellationGracePeriod,
      debug,
    };
  }

  async execute(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    startFromNode?: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<DAGExecutionResult> {
    const {
      contextPatch: _contextPatch,
      _retryContextPatch,
      ...result
    } = await runWithWorkflowSourceIntegrationPolicy(
      run,
      () => this.executeUnwrapped(nodes, run, startFromNode, abortSignal, ownership),
    );
    return result;
  }

  private async executeUnwrapped(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    startFromNode?: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
    identityPrefix = "",
    checkpointRunId = run.id,
  ): Promise<DAGInternalExecutionResult> {
    abortSignal?.throwIfAborted();
    const canonicalNodes = canonicalizeWorkflowNodes(nodes, identityPrefix);
    const context = cloneExecutionState(run.context, "Workflow context");
    const contextProjection = captureWorkflowContextProjection(
      run._workflowProjection?.context,
    );
    const runtimeProjection: WorkflowProjectionState = {
      context: contextProjection,
      ...(run._workflowProjection?.inputKind === SUBWORKFLOW_INPUT_KIND
        ? { inputKind: SUBWORKFLOW_INPUT_KIND }
        : {}),
    };
    const nodeStates = cloneExecutionState(run.nodeStates, "Workflow node states");
    let contextPatch = createSetContextPatch();
    let retryContextPatch = createSetContextPatch();

    const admissionFailure = findStaticNodeAdmissionFailure(canonicalNodes);
    if (admissionFailure) {
      const { nodeId, error } = admissionFailure;
      setOwnRecordValue(nodeStates, nodeId, {
        nodeId,
        status: "failed",
        error: error.message,
        attempt: (getOwnRecordValue(nodeStates, nodeId)?.attempt ?? 0) + 1,
        completedAt: new Date(),
      });
      return {
        completed: false,
        waiting: false,
        context,
        nodeStates,
        contextPatch,
        _workflowProjection: runtimeProjection,
        error: `Node "${nodeId}" failed: ${error.message}`,
      };
    }

    const { adjList, inDegree, nodeMap } = buildGraph(canonicalNodes);
    const reentrantCompositeNodes = new Set(
      canonicalNodes
        .filter(isReentrantCompositeNode)
        .map((node) => node.id),
    );

    updateInDegreesForCompletedNodes(nodeStates, adjList, inDegree);

    if (hasCycle(canonicalNodes, adjList)) {
      return {
        completed: false,
        waiting: false,
        context,
        nodeStates,
        contextPatch,
        _workflowProjection: runtimeProjection,
        error: "Workflow DAG contains cycles",
      };
    }

    let ready = startFromNode
      ? [startFromNode]
      : getReadyNodes(inDegree, nodeStates, reentrantCompositeNodes);

    while (ready.length > 0) {
      abortSignal?.throwIfAborted();
      const batch = ready.slice(0, this.config.maxConcurrency);
      ready = ready.slice(this.config.maxConcurrency);

      // Clone the batch baseline and each node's view deeply. Workflow context
      // is durable, structured-cloneable state, so this matches checkpoint and
      // resume semantics while preventing nested mutation from crossing an
      // in-flight node boundary.
      const baseContext = cloneExecutionState(context, "Workflow context");
      const baseContextProjection = cloneExecutionState(
        contextProjection,
        "Workflow context projection",
      );
      const baseNodeStates = cloneExecutionState(nodeStates, "Workflow node states");
      const contextSnapshots = batch.map(() =>
        cloneExecutionState(baseContext, "Workflow context")
      );
      const contextProjectionSnapshots = batch.map(() =>
        cloneExecutionState(baseContextProjection, "Workflow context projection")
      );
      const nodeStateSnapshots = batch.map(() =>
        cloneExecutionState(baseNodeStates, "Workflow node states")
      );

      const results = await Promise.allSettled(
        batch.map((nodeId, i) =>
          this.executeNode(
            nodeMap.get(nodeId)!,
            contextSnapshots[i]!,
            contextProjectionSnapshots[i]!,
            runtimeProjection.inputKind,
            nodeStateSnapshots[i]!,
            checkpointRunId,
            abortSignal,
            ownership,
          )
        ),
      );
      // Wait for the full in-flight batch to settle before propagating abort so
      // the caller keeps its lock until cooperative cleanup has completed.
      throwIfAbortedWithCleanup(
        abortSignal,
        results.flatMap((result) => result.status === "rejected" ? [result.reason] : []),
        `Workflow DAG batch [${batch.join(", ")}]`,
      );

      // Record the state of EVERY node in the batch before deciding the batch's
      // outcome. The whole batch already ran (Promise.allSettled), so returning
      // on the first failure would drop the persisted state of later nodes that
      // actually succeeded, and those would re-execute on resume. We capture
      // the earliest waiting/failed node (preserving index-order precedence) and
      // return only after all states are recorded.
      let outcome:
        | {
          kind: "waiting" | "failed";
          nodeId: string;
          error?: string;
          failureCause?: Error;
        }
        | undefined;

      for (let i = 0; i < batch.length; i++) {
        const nodeId = batch[i]!;
        const result = results[i]!;

        if (result.status !== "fulfilled") {
          const failureCause = ensureError(result.reason);
          const error = failureCause.message;

          setOwnRecordValue(nodeStates, nodeId, {
            nodeId,
            status: "failed",
            error,
            attempt: (getOwnRecordValue(nodeStates, nodeId)?.attempt ?? 0) + 1,
            completedAt: new Date(),
          });

          if (!outcome) outcome = { kind: "failed", nodeId, error, failureCause };
          continue;
        }

        const nodeResult = result.value;

        // Convert mutable callback effects into explicit top-level patches.
        // Patches are applied in node declaration order, preserving the existing
        // deterministic policy that a later sibling wins a same-key write.
        const nodeStateSnapshot = nodeStateSnapshots[i]!;
        applyRecordPatch(nodeStates, createRecordPatch(baseNodeStates, nodeStateSnapshot));
        const contextSnapshot = contextSnapshots[i]!;
        const contextProjectionSnapshot = contextProjectionSnapshots[i]!;
        const capturedNodeContextPatch = mergeContextPatches(
          createContextPatch(
            baseContext,
            contextSnapshot,
            baseContextProjection,
            contextProjectionSnapshot,
          ),
          nodeResult.contextPatch,
        );
        const failedReentrantComposite = nodeResult.state.status === "failed" &&
          isReentrantCompositeNode(nodeMap.get(nodeId)!);
        if (failedReentrantComposite) {
          retryContextPatch = mergeContextPatches(
            retryContextPatch,
            cloneExecutionState(
              capturedNodeContextPatch,
              "Workflow retry-only context changes",
            ),
          );
        }
        const nodeContextPatch = nodeResult.state.status === "failed"
          ? createSetContextPatch()
          : capturedNodeContextPatch;
        const isolatedContextPatch = cloneExecutionState(
          nodeContextPatch,
          "Workflow context changes",
        );
        applyContextPatch(context, isolatedContextPatch, contextProjection);
        contextPatch = mergeContextPatches(contextPatch, isolatedContextPatch);

        setOwnRecordValue(nodeStates, nodeId, nodeResult.state);

        if (nodeResult.waiting) {
          if (!outcome) outcome = { kind: "waiting", nodeId };
          continue;
        }

        const nodeConfig = nodeMap.get(nodeId);
        if (nodeResult.state.status === "completed" && nodeConfig && shouldCheckpoint(nodeConfig)) {
          await this.checkpoint(
            checkpointRunId,
            nodeId,
            context,
            runtimeProjection,
            nodeStates,
            ownership,
          );
        }

        if (nodeResult.state.status === "failed") {
          if (!outcome) {
            outcome = {
              kind: "failed",
              nodeId,
              error: nodeResult.state.error ?? "Unknown error",
              failureCause: getExecutionFailure(nodeResult),
            };
          }
          continue;
        }

        if (nodeResult.state.status === "completed" || nodeResult.state.status === "skipped") {
          for (const dependent of adjList.get(nodeId) ?? []) {
            inDegree.set(dependent, inDegree.get(dependent)! - 1);
          }
        }
      }

      if (outcome?.kind === "waiting") {
        return {
          completed: false,
          waiting: true,
          waitingNode: outcome.nodeId,
          context,
          nodeStates,
          contextPatch,
          _workflowProjection: runtimeProjection,
        };
      }

      if (outcome?.kind === "failed") {
        return retainExecutionFailure({
          completed: false,
          waiting: false,
          context,
          nodeStates,
          contextPatch,
          ...(Object.keys(retryContextPatch.set).length > 0 ||
              retryContextPatch.delete.length > 0 ||
              Object.keys(retryContextPatch.projection).length > 0
            ? { _retryContextPatch: retryContextPatch }
            : {}),
          _workflowProjection: runtimeProjection,
          error: `Node "${outcome.nodeId}" failed: ${outcome.error}`,
        }, outcome.failureCause);
      }

      // Merge freshly-unblocked nodes with any overflow nodes still queued in
      // `ready` (the slice beyond maxConcurrency that has not run yet). Those
      // overflow nodes have inDegree 0 and no recorded state, so
      // getReadyNodes() would return them again. De-duplicate to avoid
      // scheduling (and double-decrementing dependents for) a node that is
      // already queued.
      const queued = new Set(ready);
      for (const nodeId of getReadyNodes(inDegree, nodeStates, reentrantCompositeNodes)) {
        if (queued.has(nodeId)) continue;
        queued.add(nodeId);
        ready.push(nodeId);
      }
    }

    const persistedRunningNode = canonicalNodes.find((node) =>
      getOwnRecordValue(nodeStates, node.id)?.status === "running"
    );
    if (persistedRunningNode) {
      return {
        completed: false,
        waiting: true,
        waitingNode: persistedRunningNode.id,
        context,
        nodeStates,
        contextPatch,
        _workflowProjection: runtimeProjection,
      };
    }

    return {
      completed: true,
      waiting: false,
      context,
      nodeStates,
      contextPatch,
      _workflowProjection: runtimeProjection,
    };
  }

  private async executeNode(
    node: WorkflowNode,
    context: WorkflowContext,
    contextProjection: WorkflowContextProjection,
    inputKind: typeof SUBWORKFLOW_INPUT_KIND | undefined,
    nodeStates: Record<string, NodeState>,
    checkpointRunId: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const nodeId = node.id;

    const existingState = getOwnRecordValue(nodeStates, nodeId);
    if (existingState?.status === "completed") {
      return { state: existingState, contextPatch: createSetContextPatch(), waiting: false };
    }

    validateRuntimeNodeOptions(node);
    this.config.onNodeStart?.(nodeId);

    const reenteringRunningComposite = existingState?.status === "running" &&
      isReentrantCompositeNode(node);
    if (node.config.skip && !reenteringRunningComposite) {
      const shouldSkip = await runWithWorkflowContextProjectionTracking(
        context,
        contextProjection,
        (callbackContext) => node.config.skip!(callbackContext),
      );
      abortSignal?.throwIfAborted();
      if (shouldSkip) {
        const state = this.config.stepExecutor.createSkippedState(nodeId);
        this.config.onNodeComplete?.(nodeId, state);
        return { state, contextPatch: createSetContextPatch(), waiting: false };
      }
    }

    const config = node.config;

    switch (config.type) {
      case "step":
        return this.executeStepNode(node, context, contextProjection, inputKind, abortSignal);
      case "parallel": {
        let retryContextPatch = cloneExecutionState(
          (existingState as ProjectionMarkedNodeState | undefined)?.[
            INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD
          ] ?? createSetContextPatch(),
          `Parallel "${node.id}" retry context patch`,
        );
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: async (attemptSignal) => {
            const result = await this.executeParallelNode(
              node,
              config,
              context,
              contextProjection,
              inputKind,
              nodeStates,
              checkpointRunId,
              attemptSignal,
              ownership,
              retryContextPatch,
            );
            retryContextPatch = (result.state as ProjectionMarkedNodeState)[
              INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD
            ] ?? retryContextPatch;
            return result;
          },
        });
      }
      case "map": {
        let retryExecution: MapRetryExecutionState | undefined;
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: async (attemptSignal) => {
            const result = await executeMapNodeStrategy({
              node,
              config,
              context,
              contextProjection,
              inputKind,
              nodeStates,
              runtime: {
                executeChildGraph: (nodes, run, options) =>
                  this.executeChildGraph(
                    nodes,
                    run,
                    options,
                    checkpointRunId,
                    attemptSignal,
                    ownership,
                  ),
                onNodeComplete: this.config.onNodeComplete,
                abortSignal: attemptSignal,
              },
              retryExecution,
              onRetryExecution: (state) => retryExecution = state,
            });
            retryExecution = result.retryExecution;
            return result;
          },
        });
      }
      case "branch": {
        // A composite retry is another attempt at the same selected branch.
        // Cache the first successful condition result so context produced by a
        // partially successful child cannot switch the retry to the other arm.
        const persistedBranch = typeof existingState?.output === "object" &&
            existingState.output !== null &&
            !Array.isArray(existingState.output)
          ? (existingState.output as Record<string, unknown>).branch
          : undefined;
        let hasSelectedBranch = persistedBranch === "then" || persistedBranch === "else";
        let selectedBranch = persistedBranch === "then";
        let retryContextPatch = cloneExecutionState(
          (existingState as ProjectionMarkedNodeState | undefined)?.[
            INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD
          ] ?? createSetContextPatch(),
          `Branch "${node.id}" retry context patch`,
        );
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: async (attemptSignal) => {
            if (!hasSelectedBranch) {
              selectedBranch = await runWithWorkflowContextProjectionTracking(
                context,
                contextProjection,
                (callbackContext) => config.condition(callbackContext),
              );
              attemptSignal.throwIfAborted();
              hasSelectedBranch = true;
            }
            const result = await this.executeBranchNode(
              node,
              config,
              selectedBranch,
              context,
              contextProjection,
              inputKind,
              nodeStates,
              checkpointRunId,
              attemptSignal,
              ownership,
              retryContextPatch,
            );
            retryContextPatch = (result.state as ProjectionMarkedNodeState)[
              INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD
            ] ?? retryContextPatch;
            return result;
          },
        });
      }
      case "wait":
        return this.executeWaitNode(node, config, context, contextProjection, abortSignal);
      case "subWorkflow": {
        let retryExecution: PersistedSubWorkflowExecutionState | undefined;
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: async (attemptSignal) => {
            const result = await this.executeSubWorkflowNode(
              node,
              config,
              context,
              contextProjection,
              inputKind,
              nodeStates,
              checkpointRunId,
              attemptSignal,
              ownership,
              retryExecution,
            );
            retryExecution = (result.state as PersistedSubWorkflowNodeState)[
              INTERNAL_SUBWORKFLOW_STATE_FIELD
            ];
            return result;
          },
        });
      }
      case "loop": {
        let retryExecution: LoopRetryExecutionState | undefined;
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: async (attemptSignal) => {
            const result = await executeLoopNodeStrategy({
              node,
              config,
              context,
              contextProjection,
              inputKind,
              nodeStates,
              runtime: {
                executeChildGraph: (nodes, run, options) =>
                  this.executeChildGraph(
                    nodes,
                    run,
                    { ...options, identityPrefix: `${node.id}/` },
                    checkpointRunId,
                    attemptSignal,
                    ownership,
                  ),
                onNodeComplete: this.config.onNodeComplete,
                abortSignal: attemptSignal,
                cancellationGracePeriod: this.config.cancellationGracePeriod,
              },
              retryExecution,
            });
            retryExecution = result.retryExecution;
            return result;
          },
        });
      }
      default:
        throw INVALID_ARGUMENT.create({
          detail:
            `Unknown node type "${(config as WorkflowNodeConfig).type}" for node "${node.id}". ` +
            "Valid types are: step, parallel, map, branch, wait, subWorkflow, loop",
        });
    }
  }

  private async executeStepNode(
    node: WorkflowNode,
    context: WorkflowContext,
    contextProjection: WorkflowContextProjection,
    inputKind: typeof SUBWORKFLOW_INPUT_KIND | undefined,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    const result = await runWithWorkflowContextProjectionTracking(
      context,
      contextProjection,
      (callbackContext) => this.config.stepExecutor.execute(node, callbackContext, abortSignal),
    );
    abortSignal?.throwIfAborted();

    const state: NodeState = {
      nodeId: node.id,
      status: result.success ? "completed" : "failed",
      input: context.input,
      output: result.output,
      error: result.error,
      attempt: 1,
      startedAt: new Date(Date.now() - result.executionTime),
      completedAt: new Date(),
      ...(inputKind === SUBWORKFLOW_INPUT_KIND
        ? { [INTERNAL_WORKFLOW_INPUT_KIND_FIELD]: SUBWORKFLOW_INPUT_KIND }
        : {}),
    };

    this.config.onNodeComplete?.(node.id, state);

    return retainExecutionFailure({
      state,
      contextPatch: createSetContextPatch(result.success ? { [node.id]: result.output } : {}),
      waiting: false,
    }, getExecutionFailure(result));
  }

  private async executeParallelNode(
    node: WorkflowNode,
    config: ParallelNodeConfig,
    context: WorkflowContext,
    contextProjection: WorkflowContextProjection,
    inputKind: typeof SUBWORKFLOW_INPUT_KIND | undefined,
    nodeStates: Record<string, NodeState>,
    checkpointRunId: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
    priorContextPatch: ContextPatch = createSetContextPatch(),
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const startTime = Date.now();
    // The generic DAG treats an omitted dependency list as sequential shorthand.
    // Immediate parallel children are independent unless callers explicitly
    // declare dependencies, so make that boundary choice visible to the graph.
    const parallelNodes = config.strategy === undefined || config.strategy === "all"
      ? config.nodes.map((child) =>
        child.dependsOn === undefined ? { ...child, dependsOn: [] } : child
      )
      : config.nodes;

    const result = await this.executeUnwrapped(
      parallelNodes,
      {
        id: `${node.id}_parallel`,
        workflowId: "",
        status: "running",
        input: context.input,
        // Carry already-accumulated child states so completed children are
        // skipped on resume instead of re-executing (H8).
        nodeStates,
        currentNodes: [],
        context,
        _workflowProjection: {
          context: contextProjection,
          ...(inputKind ? { inputKind } : {}),
        },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      undefined,
      abortSignal,
      ownership,
      `${node.id}/`,
      checkpointRunId,
    );
    abortSignal?.throwIfAborted();

    // Keep successful child work inside this isolated composite transaction so
    // a parent retry can skip completed children without losing their context.
    // The outer batch commits this snapshot only if the composite eventually
    // completes or waits; a final failed state discards it in full.
    applyContextPatch(context, result.contextPatch, contextProjection);
    applyRecordPatch(nodeStates, createRecordPatch(nodeStates, result.nodeStates));

    const cumulativeContextPatch = mergeContextPatches(priorContextPatch, result.contextPatch);
    const outputProjection = remapContextPatchProjection(cumulativeContextPatch);
    const state: ProjectionMarkedNodeState = {
      nodeId: node.id,
      status: deriveNodeStatus(result.completed, result.waiting),
      output: materializeWorkflowContextDelta(cumulativeContextPatch.set),
      error: result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
      ...(outputProjection.length > 0
        ? { [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: outputProjection }
        : {}),
      ...(!result.completed
        ? { [INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD]: cumulativeContextPatch }
        : {}),
    };

    this.config.onNodeComplete?.(node.id, state);

    return retainExecutionFailure({
      state,
      contextPatch: result.contextPatch,
      waiting: result.waiting,
    }, getExecutionFailure(result));
  }

  private async executeBranchNode(
    node: WorkflowNode,
    config: BranchNodeConfig,
    conditionResult: boolean,
    context: WorkflowContext,
    contextProjection: WorkflowContextProjection,
    inputKind: typeof SUBWORKFLOW_INPUT_KIND | undefined,
    nodeStates: Record<string, NodeState>,
    checkpointRunId: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
    priorContextPatch: ContextPatch = createSetContextPatch(),
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const startTime = Date.now();

    const branchNodes = conditionResult ? config.then : (config.else ?? []);

    if (branchNodes.length === 0) {
      const state: NodeState = {
        nodeId: node.id,
        status: "completed",
        output: { branch: conditionResult ? "then" : "else", skipped: true },
        attempt: 1,
        startedAt: new Date(startTime),
        completedAt: new Date(),
      };

      return { state, contextPatch: createSetContextPatch(), waiting: false };
    }

    const result = await this.executeUnwrapped(
      branchNodes,
      {
        id: `${node.id}_branch`,
        workflowId: "",
        status: "running",
        input: context.input,
        // Carry already-accumulated child states so completed children are
        // skipped on resume instead of re-executing (H8).
        nodeStates,
        currentNodes: [],
        context,
        _workflowProjection: {
          context: contextProjection,
          ...(inputKind ? { inputKind } : {}),
        },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      undefined,
      abortSignal,
      ownership,
      `${node.id}/`,
      checkpointRunId,
    );
    abortSignal?.throwIfAborted();

    applyContextPatch(context, result.contextPatch, contextProjection);
    applyRecordPatch(nodeStates, createRecordPatch(nodeStates, result.nodeStates));

    const cumulativeContextPatch = mergeContextPatches(priorContextPatch, result.contextPatch);
    const outputProjection = remapContextPatchProjection(cumulativeContextPatch, ["result"]);
    const state: ProjectionMarkedNodeState = {
      nodeId: node.id,
      status: deriveNodeStatus(result.completed, result.waiting),
      output: {
        branch: conditionResult ? "then" : "else",
        result: materializeWorkflowContextDelta(cumulativeContextPatch.set),
      },
      error: result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
      ...(outputProjection.length > 0
        ? { [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: outputProjection }
        : {}),
      ...(!result.completed
        ? { [INTERNAL_COMPOSITE_CONTEXT_PATCH_FIELD]: cumulativeContextPatch }
        : {}),
    };

    this.config.onNodeComplete?.(node.id, state);

    return retainExecutionFailure({
      state,
      contextPatch: result.contextPatch,
      waiting: result.waiting,
    }, getExecutionFailure(result));
  }

  private async executeWaitNode(
    node: WorkflowNode,
    config: WaitNodeConfig,
    context: WorkflowContext,
    contextProjection: WorkflowContextProjection,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    this.config.onWaiting?.(node.id, config);

    const payloadFactory = typeof config.payload === "function" ? config.payload : undefined;
    const payload = payloadFactory
      ? await runWithWorkflowContextProjectionTracking(
        context,
        contextProjection,
        (callbackContext) => payloadFactory(callbackContext),
      )
      : config.payload;
    abortSignal?.throwIfAborted();

    const state: NodeState = {
      nodeId: node.id,
      status: "running",
      input: {
        type: config.waitType,
        message: config.message,
        payload,
        approvers: config.approvers === undefined ? undefined : [...config.approvers],
        timeout: config.timeout,
        eventName: config.eventName,
        ...(config.waitType === "event"
          ? { [INTERNAL_WAIT_KIND_FIELD]: getConfiguredTimedWaitKind(config) }
          : {}),
      },
      attempt: 1,
      startedAt: new Date(),
    };

    return {
      state,
      contextPatch: createSetContextPatch(),
      waiting: true,
    };
  }

  private async executeSubWorkflowNode(
    node: WorkflowNode,
    config: SubWorkflowNodeConfig,
    context: WorkflowContext,
    contextProjection: WorkflowContextProjection,
    _inputKind: typeof SUBWORKFLOW_INPUT_KIND | undefined,
    nodeStates: Record<string, NodeState>,
    checkpointRunId: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
    retryExecution?: PersistedSubWorkflowExecutionState,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const startTime = Date.now();

    if (typeof config.workflow === "string") {
      throw NOT_SUPPORTED.create({
        detail:
          "Resolving workflow by ID is not yet supported in this execution context. Pass the WorkflowDefinition object.",
      });
    }

    const workflowDef = config.workflow;

    const existingState = getOwnRecordValue(nodeStates, node.id) as
      | PersistedSubWorkflowNodeState
      | undefined;
    const persistedExecution = retryExecution ??
      (existingState?.status === "running"
        ? existingState[INTERNAL_SUBWORKFLOW_STATE_FIELD]
        : undefined);

    const inputFactory = typeof config.input === "function" ? config.input : undefined;
    const admittedInput = persistedExecution
      ? cloneCapturedWorkflowStaticValue(
        persistedExecution.input,
        `Sub-workflow "${workflowDef.id}" persisted input`,
      )
      : inputFactory
      ? captureWorkflowStaticValue(
        await runWithWorkflowContextProjectionTracking(
          context,
          contextProjection,
          (callbackContext) => inputFactory(callbackContext),
        ),
        `Sub-workflow "${workflowDef.id}" dynamic input`,
      )
      : cloneCapturedWorkflowStaticValue(
        config.input === undefined ? context.input : config.input,
        `Sub-workflow "${workflowDef.id}" input`,
      );
    const input = cloneCapturedWorkflowStaticValue(
      admittedInput,
      `Sub-workflow "${workflowDef.id}" attempt input`,
    );
    abortSignal?.throwIfAborted();

    const stepsEvaluationContext = persistedExecution
      ? cloneExecutionState(
        persistedExecution.stepsEvaluationContext,
        `Sub-workflow "${workflowDef.id}" persisted steps evaluation context`,
      )
      : cloneExecutionState(
        context,
        `Sub-workflow "${workflowDef.id}" steps evaluation context`,
      );
    const stepsEvaluationProjection = persistedExecution
      ? cloneExecutionState(
        persistedExecution.stepsEvaluationProjection,
        `Sub-workflow "${workflowDef.id}" persisted steps evaluation projection`,
      )
      : cloneExecutionState(
        contextProjection,
        `Sub-workflow "${workflowDef.id}" steps evaluation projection`,
      );
    const stepsCallbackContext = persistedExecution
      ? cloneExecutionState(
        stepsEvaluationContext,
        `Sub-workflow "${workflowDef.id}" resumed steps callback context`,
      )
      : context;
    const stepsCallbackProjection = persistedExecution
      ? cloneExecutionState(
        stepsEvaluationProjection,
        `Sub-workflow "${workflowDef.id}" resumed steps callback projection`,
      )
      : contextProjection;

    const stepsFactory = typeof workflowDef.steps === "function" ? workflowDef.steps : undefined;
    const rawSteps = stepsFactory
      ? await runWithWorkflowContextProjectionTracking(
        stepsCallbackContext,
        stepsCallbackProjection,
        (callbackContext) => stepsFactory({ input, context: callbackContext }),
      )
      : workflowDef.steps;
    abortSignal?.throwIfAborted();
    const steps = captureWorkflowNodes(
      rawSteps,
      `Sub-workflow "${workflowDef.id}"`,
      { allowEmpty: true, emptyElementName: "step" },
    );

    const subRunId = `${node.id}_sub_${generateId()}`;

    const result = await this.executeUnwrapped(
      steps,
      {
        id: subRunId,
        workflowId: workflowDef.id,
        status: "running",
        input,
        nodeStates,
        currentNodes: [],
        context: persistedExecution
          ? {
            ...cloneExecutionState(
              persistedExecution.context,
              `Sub-workflow "${workflowDef.id}" persisted execution context`,
            ),
            input,
          }
          : { input },
        _workflowProjection: {
          context: persistedExecution
            ? cloneExecutionState(
              persistedExecution.contextProjection,
              `Sub-workflow "${workflowDef.id}" persisted context projection`,
            )
            : {},
          inputKind: SUBWORKFLOW_INPUT_KIND,
        },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      undefined,
      abortSignal,
      ownership,
      `${node.id}/`,
      checkpointRunId,
    );
    abortSignal?.throwIfAborted();

    for (const [childId, childState] of Object.entries(result.nodeStates)) {
      if (
        childId.startsWith(`${node.id}/`) && Object.hasOwn(childState, "input") &&
        workflowRuntimeValuesEqual(childState.input, input)
      ) {
        (childState as NodeState & Record<string, unknown>)[
          INTERNAL_WORKFLOW_INPUT_KIND_FIELD
        ] = SUBWORKFLOW_INPUT_KIND;
      }
    }

    applyRecordPatch(nodeStates, createRecordPatch(nodeStates, result.nodeStates));

    // Keep the raw child context durable for downstream compatibility. Public
    // boundaries use the explicit provenance below to project framework data.
    let finalOutput: unknown = result.context;
    if (result.completed && config.output) {
      finalOutput = config.output(result.context);
      abortSignal?.throwIfAborted();
    }

    const defaultOutputProjection: WorkflowProjectionPath[] = [
      { kind: FRAMEWORK_CONTEXT_PROJECTION_KIND, path: [] },
      ...remapWorkflowContextProjection(result._workflowProjection?.context ?? {}),
    ];
    const hasDefaultOutput = !(result.completed && config.output);
    const state: PersistedSubWorkflowNodeState = {
      nodeId: node.id,
      status: deriveNodeStatus(result.completed, result.waiting),
      output: finalOutput,
      error: result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
      ...(hasDefaultOutput
        ? { [INTERNAL_WORKFLOW_OUTPUT_KIND_FIELD]: SUBWORKFLOW_CONTEXT_OUTPUT_KIND }
        : {}),
      ...(hasDefaultOutput
        ? { [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: defaultOutputProjection }
        : {}),
      ...(!result.completed
        ? {
          [INTERNAL_SUBWORKFLOW_STATE_FIELD]: {
            input: admittedInput,
            stepsEvaluationContext,
            stepsEvaluationProjection,
            context: result.context,
            contextProjection: result._workflowProjection?.context ?? {},
          },
        }
        : {}),
    };

    this.config.onNodeComplete?.(node.id, state);

    return retainExecutionFailure({
      state,
      contextPatch: createSetContextPatch(
        result.completed ? { [node.id]: finalOutput } : {},
        result.completed && hasDefaultOutput ? { [node.id]: defaultOutputProjection } : {},
      ),
      waiting: result.waiting,
    }, getExecutionFailure(result));
  }

  private async checkpoint(
    runId: string,
    nodeId: string,
    context: WorkflowContext,
    workflowProjection: WorkflowProjectionState,
    nodeStates: Record<string, NodeState>,
    ownership?: CheckpointOwnership,
  ): Promise<void> {
    if (!this.config.checkpointManager) {
      return;
    }

    const checkpoint: Checkpoint = {
      id: generateId("cp"),
      nodeId,
      timestamp: new Date(),
      context: structuredClone(context),
      nodeStates: structuredClone(nodeStates),
      _workflowProjection: structuredClone(workflowProjection),
    };

    const saved = await this.config.checkpointManager.save(runId, checkpoint, ownership);
    // Legacy test/double implementations returned void. Only an explicit false
    // from the owner-aware CheckpointManager means the fenced append was denied.
    if (saved === false) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow execution ownership changed before checkpoint persistence",
      });
    }
  }

  private async executeChildGraph(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    options?: ChildGraphExecutionOptions,
    checkpointRunId = run.id,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<DAGInternalExecutionResult> {
    const childAbortSignal = options?.abortSignal ?? abortSignal;
    if (options?.maxConcurrency === undefined) {
      return await this.executeUnwrapped(
        nodes,
        run,
        undefined,
        childAbortSignal,
        ownership,
        options?.identityPrefix,
        checkpointRunId,
      );
    }

    // Run the child graph on a scoped executor rather than mutating
    // this.config.maxConcurrency. Concurrent child graphs (e.g. parallel map
    // nodes) would otherwise race on the shared field and leave the parent
    // executor's concurrency permanently corrupted.
    const childExecutor = new DAGExecutor({
      ...this.config,
      maxConcurrency: options.maxConcurrency,
    });
    return await childExecutor.executeUnwrapped(
      nodes,
      run,
      undefined,
      childAbortSignal,
      ownership,
      options.identityPrefix,
      checkpointRunId,
    );
  }
}
