import type { MapNodeConfig, NodeState, WorkflowContext, WorkflowNode } from "../../types.ts";
import type { NodeExecutionResult } from "./types.ts";
import { deriveNodeStatus } from "./utils.ts";
import type { NodeStrategyRuntime } from "./node-strategy-types.ts";
import { captureWorkflowSourceIntegrationPolicy } from "../../source-integration-policy.ts";
import {
  applyContextPatch,
  applyRecordPatch,
  cloneExecutionState,
  createRecordPatch,
  createSetContextPatch,
  getOwnRecordValue,
} from "./context-patch.ts";
import { createMapChildNodes } from "./node-identity.ts";
import { captureWorkflowMapItems } from "../workflow-definition-snapshot.ts";
import { getExecutionFailure, retainExecutionFailure } from "../execution-failure.ts";
import {
  captureWorkflowProjectionPaths,
  INTERNAL_MAP_CHILD_NODE_IDS_FIELD,
  INTERNAL_MAP_CONTEXT_FIELD,
  INTERNAL_MAP_CONTEXT_PROJECTION_FIELD,
  INTERNAL_MAP_ITEMS_FIELD,
  INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD,
  runWithWorkflowContextProjectionTracking,
  SUBWORKFLOW_INPUT_KIND,
  type WorkflowContextProjection,
  type WorkflowProjectionPath,
} from "../../runtime-state.ts";

type PersistedMapNodeState = NodeState & {
  readonly [INTERNAL_MAP_ITEMS_FIELD]?: unknown[];
  readonly [INTERNAL_MAP_CONTEXT_FIELD]?: WorkflowContext;
  readonly [INTERNAL_MAP_CONTEXT_PROJECTION_FIELD]?: WorkflowContextProjection;
  readonly [INTERNAL_MAP_CHILD_NODE_IDS_FIELD]?: string[];
  readonly [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]?: WorkflowProjectionPath[];
};

interface ExecuteMapNodeStrategyInput {
  node: WorkflowNode;
  config: MapNodeConfig;
  context: WorkflowContext;
  contextProjection: WorkflowContextProjection;
  inputKind?: typeof SUBWORKFLOW_INPUT_KIND;
  nodeStates: Record<string, NodeState>;
  runtime: NodeStrategyRuntime;
  abortSignal?: AbortSignal;
  retryExecution?: MapRetryExecutionState;
  onRetryExecution?: (state: MapRetryExecutionState) => void;
}

export interface MapRetryExecutionState {
  readonly items: unknown[];
  readonly context: WorkflowContext;
  readonly contextProjection: WorkflowContextProjection;
}

export interface MapNodeStrategyResult extends NodeExecutionResult {
  retryExecution?: MapRetryExecutionState;
}

export async function executeMapNodeStrategy(
  input: ExecuteMapNodeStrategyInput,
): Promise<MapNodeStrategyResult> {
  const { node, config, context, contextProjection, inputKind, nodeStates, runtime } = input;
  runtime.abortSignal?.throwIfAborted();
  const startTime = Date.now();

  const existingState = getOwnRecordValue(nodeStates, node.id) as
    | PersistedMapNodeState
    | undefined;
  const persistedItems = input.retryExecution?.items ??
    (existingState?.status === "running" ? existingState[INTERNAL_MAP_ITEMS_FIELD] : undefined);
  const persistedContext = input.retryExecution?.context ??
    (existingState?.status === "running" ? existingState[INTERNAL_MAP_CONTEXT_FIELD] : undefined);
  const persistedContextProjection = input.retryExecution?.contextProjection ??
    (existingState?.status === "running"
      ? existingState[INTERNAL_MAP_CONTEXT_PROJECTION_FIELD]
      : undefined);
  const itemsFactory = typeof config.items === "function" ? config.items : undefined;
  const rawItems = persistedItems ??
    (itemsFactory
      ? await runWithWorkflowContextProjectionTracking(
        context,
        contextProjection,
        (callbackContext) => itemsFactory(callbackContext),
      )
      : config.items);
  runtime.abortSignal?.throwIfAborted();
  const items = captureWorkflowMapItems(
    rawItems,
    persistedItems === undefined
      ? `Map node "${node.id}" items`
      : `Map node "${node.id}" persisted items`,
  );

  const admittedContext = persistedContext
    ? cloneExecutionState(persistedContext, `Map node "${node.id}" admitted context`)
    : cloneExecutionState(context, `Map node "${node.id}" admitted context`);
  const admittedContextProjection = persistedContextProjection
    ? cloneExecutionState(
      persistedContextProjection,
      `Map node "${node.id}" admitted context projection`,
    )
    : cloneExecutionState(
      contextProjection,
      `Map node "${node.id}" admitted context projection`,
    );
  input.onRetryExecution?.({
    items,
    context: admittedContext,
    contextProjection: admittedContextProjection,
  });

  if (items.length === 0) {
    const state: NodeState = {
      nodeId: node.id,
      status: "completed",
      output: [],
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: new Date(),
    };
    return { state, contextPatch: createSetContextPatch({ [node.id]: [] }), waiting: false };
  }

  const childNodes = createMapChildNodes(node, config, items);

  const result = await runtime.executeChildGraph(
    childNodes,
    {
      id: `${node.id}_map`,
      workflowId: "",
      status: "running",
      input: context.input,
      // Carry already-accumulated child states so completed children are
      // skipped on resume instead of re-executing (H8).
      nodeStates,
      currentNodes: [],
      context: admittedContext,
      _workflowProjection: {
        context: admittedContextProjection,
        ...(inputKind ? { inputKind } : {}),
      },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
    },
    config.concurrency === undefined ? undefined : { maxConcurrency: config.concurrency },
  );
  runtime.abortSignal?.throwIfAborted();

  applyRecordPatch(nodeStates, createRecordPatch(nodeStates, result.nodeStates));

  const outputs = childNodes.map((child) => getOwnRecordValue(result.nodeStates, child.id)?.output);
  const outputProjection = childNodes.flatMap((child, index) =>
    captureWorkflowProjectionPaths(
      (getOwnRecordValue(result.nodeStates, child.id) as Record<string, unknown> | undefined)?.[
        INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD
      ],
    ).map((entry) => ({ kind: entry.kind, path: [index, ...entry.path] }))
  );

  const state: PersistedMapNodeState = {
    nodeId: node.id,
    status: deriveNodeStatus(result.completed, result.waiting),
    output: outputs,
    error: result.error,
    attempt: 1,
    startedAt: new Date(startTime),
    completedAt: result.completed ? new Date() : undefined,
    [INTERNAL_MAP_CHILD_NODE_IDS_FIELD]: childNodes.map((child) => child.id),
    ...(outputProjection.length > 0
      ? { [INTERNAL_WORKFLOW_OUTPUT_PROJECTION_FIELD]: outputProjection }
      : {}),
    ...(result.waiting ? { [INTERNAL_MAP_ITEMS_FIELD]: items } : {}),
    ...(result.waiting
      ? {
        [INTERNAL_MAP_CONTEXT_FIELD]: cloneExecutionState(
          result.context,
          `Map node "${node.id}" resumable context`,
        ),
        [INTERNAL_MAP_CONTEXT_PROJECTION_FIELD]: cloneExecutionState(
          result._workflowProjection?.context ?? {},
          `Map node "${node.id}" resumable context projection`,
        ),
      }
      : {}),
  };

  runtime.onNodeComplete?.(node.id, state);

  let retryExecution: MapRetryExecutionState | undefined;
  if (result.error) {
    const retryContext = cloneExecutionState(
      result.context,
      `Map node "${node.id}" retry context`,
    );
    const retryContextProjection = cloneExecutionState(
      result._workflowProjection?.context ?? {},
      `Map node "${node.id}" retry context projection`,
    );
    if (result._retryContextPatch) {
      applyContextPatch(retryContext, result._retryContextPatch, retryContextProjection);
    }
    retryExecution = {
      items,
      context: retryContext,
      contextProjection: retryContextProjection,
    };
  }
  if (retryExecution) input.onRetryExecution?.(retryExecution);

  return retainExecutionFailure({
    state,
    contextPatch: createSetContextPatch(
      result.completed ? { [node.id]: outputs } : {},
      result.completed ? { [node.id]: outputProjection } : {},
    ),
    waiting: result.waiting,
    ...(retryExecution ? { retryExecution } : {}),
  }, getExecutionFailure(result));
}
