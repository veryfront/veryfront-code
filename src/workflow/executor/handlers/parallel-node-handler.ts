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

export interface ParallelNodeCallbacks {
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
}

export class ParallelNodeHandler extends BaseNodeHandler<ParallelNodeConfig> {
  readonly nodeType = "parallel" as const;

  constructor(
    private readonly subExecutor: IDAGSubExecutor,
    private readonly callbacks?: ParallelNodeCallbacks,
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
    const startedAt = new Date();

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

    Object.assign(nodeStates, result.nodeStates);

    const state: NodeState = {
      nodeId: node.id,
      status: deriveNodeStatus(result.completed, result.waiting),
      output: result.context,
      error: result.error,
      attempt: 1,
      startedAt,
      completedAt: result.completed ? new Date() : undefined,
    };

    this.callbacks?.onNodeComplete?.(node.id, state);

    return { state, contextUpdates: result.context, waiting: result.waiting };
  }
}

export function createParallelNodeHandler(
  subExecutor: IDAGSubExecutor,
  callbacks?: ParallelNodeCallbacks,
): ParallelNodeHandler {
  return new ParallelNodeHandler(subExecutor, callbacks);
}
