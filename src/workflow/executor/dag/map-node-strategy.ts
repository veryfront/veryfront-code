import type {
  MapNodeConfig,
  NodeState,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../../types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { NodeExecutionResult } from "./types.ts";
import { deriveNodeStatus } from "./utils.ts";
import type { NodeStrategyRuntime } from "./node-strategy-types.ts";
import { captureWorkflowSourceIntegrationPolicy } from "../../source-integration-policy.ts";
import { applyRecordPatch, createRecordPatch, createSetContextPatch } from "./context-patch.ts";
import {
  collectWorkflowNodeIds,
  namespaceWorkflowDefinition,
  rebaseCompositeDescendants,
} from "../../dsl/validation.ts";

interface ExecuteMapNodeStrategyInput {
  node: WorkflowNode;
  config: MapNodeConfig;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  /** Declared node ids in the graph that owns this map node. */
  parentNodeIds: ReadonlySet<string>;
  runtime: NodeStrategyRuntime;
  abortSignal?: AbortSignal;
}

function isWorkflowDefinition(processor: unknown): processor is WorkflowDefinition {
  return typeof processor === "object" && processor !== null && "steps" in processor;
}

function createMapChildNodes(
  node: WorkflowNode,
  config: MapNodeConfig,
  items: unknown[],
  parentNodeIds: ReadonlySet<string>,
): WorkflowNode[] {
  return items.map((item, i) => {
    const childId = `${node.id}_${i}`;

    if (isWorkflowDefinition(config.processor)) {
      const workflow = namespaceWorkflowDefinition(`${childId}/`, config.processor);
      const workflowSteps = workflow.steps;
      return {
        id: childId,
        config: {
          type: "subWorkflow",
          workflow: typeof workflowSteps === "function"
            ? {
              ...workflow,
              steps: (context) => {
                const steps = workflowSteps(context);
                const collidingChildId = findParentIdCollision(steps, parentNodeIds);
                if (collidingChildId) {
                  throwMapChildIdCollision(node.id, collidingChildId);
                }
                return steps;
              },
            }
            : workflow,
          input: item,
          retry: config.retry,
          checkpoint: false,
        },
      };
    }

    const processor = config.processor as WorkflowNode;
    const processorConfig = rebaseCompositeDescendants(
      processor.config,
      processor.id,
      childId,
    );

    if (processorConfig.type === "step") {
      return {
        id: childId,
        config: {
          ...processorConfig,
          input: item as Record<string, unknown>,
        },
      };
    }

    // Non-step processors do not receive item input through their config. Keep
    // their registered config identity so wait nodes retain their durable
    // definition-path association during execution.
    return { id: childId, config: processorConfig };
  });
}

function findParentIdCollision(
  nodes: WorkflowNode[],
  parentNodeIds: ReadonlySet<string>,
): string | undefined {
  return [...collectWorkflowNodeIds(nodes)].find((childId) => parentNodeIds.has(childId));
}

function throwMapChildIdCollision(mapNodeId: string, collidingChildId: string): never {
  throw INVALID_ARGUMENT.create({
    detail: `Map node "${mapNodeId}" generated child id "${collidingChildId}", ` +
      "which collides with a declared node in the parent graph",
  });
}

export async function executeMapNodeStrategy(
  input: ExecuteMapNodeStrategyInput,
): Promise<NodeExecutionResult> {
  const { node, config, context, nodeStates, parentNodeIds, runtime } = input;
  runtime.abortSignal?.throwIfAborted();
  const startTime = Date.now();

  const items = typeof config.items === "function" ? await config.items(context) : config.items;
  runtime.abortSignal?.throwIfAborted();

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
    return { state, contextPatch: createSetContextPatch({ [node.id]: [] }), waiting: false };
  }

  const childNodes = createMapChildNodes(node, config, items, parentNodeIds);
  const collidingChildId = findParentIdCollision(childNodes, parentNodeIds);
  if (collidingChildId) {
    throwMapChildIdCollision(node.id, collidingChildId);
  }
  const childNodeStates = runtime.selectChildNodeStates?.(childNodes, nodeStates) ?? nodeStates;

  const result = await runtime.executeChildGraph(
    childNodes,
    {
      id: `${node.id}_map`,
      workflowId: "",
      status: "running",
      input: context.input,
      // Carry already-accumulated child states so completed children are
      // skipped on resume instead of re-executing (H8).
      nodeStates: childNodeStates,
      currentNodes: [],
      context: { ...context },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
      sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
    },
    config.concurrency ? { maxConcurrency: config.concurrency } : undefined,
  );
  runtime.abortSignal?.throwIfAborted();

  applyRecordPatch(nodeStates, createRecordPatch(childNodeStates, result.nodeStates));

  const outputs = childNodes.map((child) => result.nodeStates[child.id]?.output);

  const stalledWaitingNodes = result.stalledWaitNodes ??
    (result.stalledWaitNode === undefined
      ? undefined
      : [{ nodeId: result.stalledWaitNode, waitConfig: undefined }]);
  const waitingNodes = result.waitingNodes ?? stalledWaitingNodes;
  const waiting = result.waiting || waitingNodes !== undefined;

  const state: NodeState = {
    nodeId: node.id,
    status: deriveNodeStatus(result.completed, waiting),
    output: outputs,
    error: waiting ? undefined : result.error,
    attempt: 1,
    startedAt: new Date(startTime),
    completedAt: result.completed ? new Date() : undefined,
  };

  runtime.onNodeComplete?.(node.id, state);

  return {
    state,
    contextPatch: createSetContextPatch(result.completed ? { [node.id]: outputs } : {}),
    waiting,
    errorCause: waiting ? undefined : result.errorCause,
    waitingNode: result.waitingNode ?? waitingNodes?.[0]?.nodeId,
    waitingConfig: result.waitingConfig ?? waitingNodes?.[0]?.waitConfig,
    waitingNodes,
  };
}
