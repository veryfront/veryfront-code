import type {
  MapNodeConfig,
  NodeState,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeConfig,
} from "../../types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { NodeExecutionResult } from "./types.ts";
import { deriveNodeStatus } from "./utils.ts";
import type { NodeStrategyRuntime } from "./node-strategy-types.ts";

interface ExecuteMapNodeStrategyInput {
  node: WorkflowNode;
  config: MapNodeConfig;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  runtime: NodeStrategyRuntime;
}

function isWorkflowDefinition(processor: unknown): processor is WorkflowDefinition {
  return typeof processor === "object" && processor !== null && "steps" in processor;
}

function createMapChildNodes(
  node: WorkflowNode,
  config: MapNodeConfig,
  items: unknown[],
): WorkflowNode[] {
  return items.map((item, i) => {
    const childId = `${node.id}_${i}`;

    if (isWorkflowDefinition(config.processor)) {
      return {
        id: childId,
        config: {
          type: "subWorkflow",
          workflow: config.processor,
          input: item,
          retry: config.retry,
          checkpoint: false,
        },
      };
    }

    const processorConfig: WorkflowNodeConfig = { ...(config.processor as WorkflowNode).config };

    if (processorConfig.type === "step") {
      processorConfig.input = item as Record<string, unknown>;
    }

    return { id: childId, config: processorConfig };
  });
}

export async function executeMapNodeStrategy(
  input: ExecuteMapNodeStrategyInput,
): Promise<NodeExecutionResult> {
  const { node, config, context, nodeStates, runtime } = input;
  const startTime = Date.now();

  const items = typeof config.items === "function" ? await config.items(context) : config.items;

  if (!Array.isArray(items)) {
    throw INVALID_ARGUMENT.create({ detail: `Map node "${node.id}" items must be an array` });
  }

  if (items.length === 0) {
    const state: NodeState = {
      nodeId: node.id,
      status: "completed",
      output: [],
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: new Date(),
    };
    return { state, contextUpdates: { [node.id]: [] }, waiting: false };
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
    },
    config.concurrency ? { maxConcurrency: config.concurrency } : undefined,
  );

  Object.assign(nodeStates, result.nodeStates);

  const outputs = childNodes.map((child) => result.nodeStates[child.id]?.output);

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

  return {
    state,
    contextUpdates: result.completed ? { [node.id]: outputs } : {},
    waiting: result.waiting,
  };
}
