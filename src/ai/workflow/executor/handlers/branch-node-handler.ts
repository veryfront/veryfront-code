/**
 * Branch Node Handler
 *
 * Handles execution of branch nodes - conditional workflow branches.
 */

import type { BranchNodeConfig, NodeState, WorkflowNode, WorkflowNodeConfig } from "../../types.ts";
import type { IDAGSubExecutor } from "./dag-executor-interface.ts";
import {
  BaseNodeHandler,
  type NodeExecutionResult,
  type NodeHandlerContext,
} from "./node-handler.ts";

/**
 * Callbacks for branch node events
 */
export interface BranchNodeCallbacks {
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
}

/**
 * Handler for branch nodes.
 *
 * Branch nodes evaluate a condition and execute either
 * the "then" or "else" branch based on the result.
 */
export class BranchNodeHandler extends BaseNodeHandler<BranchNodeConfig> {
  readonly nodeType = "branch" as const;

  constructor(
    private subExecutor: IDAGSubExecutor,
    private callbacks?: BranchNodeCallbacks,
  ) {
    super();
  }

  canHandle(config: WorkflowNodeConfig): config is BranchNodeConfig {
    return config.type === "branch";
  }

  async execute(
    node: WorkflowNode,
    handlerContext: NodeHandlerContext,
  ): Promise<NodeExecutionResult> {
    const { context, nodeStates } = handlerContext;
    const config = node.config as BranchNodeConfig;
    const startTime = Date.now();

    // Evaluate condition
    const conditionResult = await config.condition(context);

    // Select branch to execute
    const branchNodes = conditionResult ? config.then : (config.else || []);

    if (branchNodes.length === 0) {
      // No nodes to execute - branch is skipped
      const state: NodeState = {
        nodeId: node.id,
        status: "completed",
        output: { branch: conditionResult ? "then" : "else", skipped: true },
        attempt: 1,
        startedAt: new Date(startTime),
        completedAt: new Date(),
      };

      return { state, contextUpdates: {}, waiting: false };
    }

    // Execute branch nodes
    const result = await this.subExecutor.executeSubDAG(branchNodes, {
      id: `${node.id}_branch`,
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
      status: result.completed ? "completed" : (result.waiting ? "running" : "failed"),
      output: {
        branch: conditionResult ? "then" : "else",
        result: result.context,
      },
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
 * Create a branch node handler.
 */
export function createBranchNodeHandler(
  subExecutor: IDAGSubExecutor,
  callbacks?: BranchNodeCallbacks,
): BranchNodeHandler {
  return new BranchNodeHandler(subExecutor, callbacks);
}
