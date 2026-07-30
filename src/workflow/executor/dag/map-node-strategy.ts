import type { MapNodeConfig, NodeState, WorkflowContext, WorkflowNode } from "../../types.ts";
import type { NodeExecutionResult } from "./types.ts";
import { deriveNodeStatus } from "./utils.ts";
import type { NodeStrategyRuntime } from "./node-strategy-types.ts";
import { captureWorkflowSourceIntegrationPolicy } from "../../source-integration-policy.ts";
import {
  applyRecordPatch,
  createRecordPatch,
  createSetContextPatch,
  getOwnRecordValue,
} from "./context-patch.ts";
import { createMapChildNodes } from "./node-identity.ts";
import { captureWorkflowMapItems } from "../workflow-definition-snapshot.ts";
import { getExecutionFailure, retainExecutionFailure } from "../execution-failure.ts";

interface ExecuteMapNodeStrategyInput {
  node: WorkflowNode;
  config: MapNodeConfig;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  runtime: NodeStrategyRuntime;
  abortSignal?: AbortSignal;
}

export async function executeMapNodeStrategy(
  input: ExecuteMapNodeStrategyInput,
): Promise<NodeExecutionResult> {
  const { node, config, context, nodeStates, runtime } = input;
  runtime.abortSignal?.throwIfAborted();
  const startTime = Date.now();

  const rawItems = typeof config.items === "function" ? await config.items(context) : config.items;
  runtime.abortSignal?.throwIfAborted();
  const items = captureWorkflowMapItems(rawItems, `Map node "${node.id}" items`);

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
      context: { ...context },
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

  const state: NodeState = {
    nodeId: node.id,
    status: deriveNodeStatus(result.completed, result.waiting),
    output: outputs,
    error: result.error,
    attempt: 1,
    startedAt: new Date(startTime),
    completedAt: result.completed ? new Date() : undefined,
  };

  runtime.onNodeComplete?.(node.id, state);

  return retainExecutionFailure({
    state,
    contextPatch: createSetContextPatch(result.completed ? { [node.id]: outputs } : {}),
    waiting: result.waiting,
  }, getExecutionFailure(result));
}
