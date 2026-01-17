/**
 * Parallel Node Handler
 *
 * Handles execution of parallel nodes - executing multiple child nodes concurrently.
 */

import type {
  NodeState,
  NodeStatus,
  ParallelNodeConfig,
  WorkflowNode,
  WorkflowNodeConfig,
} from "../../types.ts";
import type { IDAGSubExecutor } from "./dag-executor-interface.ts";
import {
  BaseNodeHandler,
  type NodeExecutionResult,
  type NodeHandlerContext,
} from "./node-handler.ts";

function deriveNodeStatus(completed: boolean, waiting: boolean): NodeStatus {
  if (completed) return "completed";
  if (waiting) return "running";
  return "failed";
}

/**
 * Callbacks for parallel node events
 */
export interface ParallelNodeCallbacks {
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
}

/**
 * Handler for parallel nodes.
 *
 * Parallel nodes execute multiple child nodes concurrently,
 * collecting their results into the context.
 */
export class ParallelNodeHandler extends BaseNodeHandler<ParallelNodeConfig> {
  readonly nodeType = "parallel" as const;

  constructor(
    private subExecutor: IDAGSubExecutor,
    private callbacks?: ParallelNodeCallbacks,
  ) {
    super();
  }

  canHandle(config: WorkflowNodeConfig): config is ParallelNodeConfig {
    return config.type === "parallel";
  }

  async execute(
    node: WorkflowNode,
    handlerContext: NodeHandlerContext,
  ): Promise<NodeExecutionResult> {
    const { context, nodeStates } = handlerContext;
    const config = node.config as ParallelNodeConfig;
    const startTime = Date.now();

    // Execute child nodes using sub-executor
    const result = await this.subExecutor.executeSubDAG(config.nodes, {
      id: `${node.id}_parallel`,
      workflowId: "",
      status: "running",
      input: context.input,
      nodeStates: {},
      currentNodes: [],
      context,
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    });

    // Merge child node states
    Object.assign(nodeStates, result.nodeStates);

    const state: NodeState = {
      nodeId: node.id,
      status: deriveNodeStatus(result.completed, result.waiting),
      output: result.context,
      error: result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
    };

    this.callbacks?.onNodeComplete?.(node.id, state);

    return {
      state,
      contextUpdates: result.context,
      waiting: result.waiting,
    };
  }
}

/**
 * Create a parallel node handler.
 */
export function createParallelNodeHandler(
  subExecutor: IDAGSubExecutor,
  callbacks?: ParallelNodeCallbacks,
): ParallelNodeHandler {
  return new ParallelNodeHandler(subExecutor, callbacks);
}
