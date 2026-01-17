/**
 * Node Handler Interface
 *
 * Defines the contract for workflow node execution handlers.
 * Each node type (step, parallel, branch, wait, subWorkflow) has its own handler.
 */

import type {
  NodeState,
  WorkflowContext,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowNodeType,
} from "../../types.ts";

/**
 * Result of executing a node
 */
export interface NodeExecutionResult {
  /** The final state of the node */
  state: NodeState;
  /** Updates to apply to the workflow context */
  contextUpdates: Record<string, unknown>;
  /** Whether the node is waiting (e.g., for human approval, timer, event) */
  waiting: boolean;
}

/**
 * Context passed to node handlers
 */
export interface NodeHandlerContext {
  /** The workflow execution context */
  context: WorkflowContext;
  /** Current state of all nodes in the workflow */
  nodeStates: Record<string, NodeState>;
}

/**
 * Interface for node execution handlers.
 *
 * Implementing the Strategy pattern to replace the switch statement
 * in DAGExecutor.executeNode().
 */
export interface INodeHandler<TConfig extends WorkflowNodeConfig = WorkflowNodeConfig> {
  /**
   * The node type this handler supports
   */
  readonly nodeType: WorkflowNodeType;

  /**
   * Check if this handler can handle the given node config
   */
  canHandle(config: WorkflowNodeConfig): config is TConfig;

  /**
   * Execute the node
   *
   * @param node - The node to execute
   * @param handlerContext - Execution context with workflow context and node states
   * @returns Promise resolving to execution result
   */
  execute(node: WorkflowNode, handlerContext: NodeHandlerContext): Promise<NodeExecutionResult>;
}

/**
 * Base class for node handlers providing common functionality
 */
export abstract class BaseNodeHandler<TConfig extends WorkflowNodeConfig = WorkflowNodeConfig>
  implements INodeHandler<TConfig> {
  abstract readonly nodeType: WorkflowNodeType;

  abstract canHandle(config: WorkflowNodeConfig): config is TConfig;

  abstract execute(
    node: WorkflowNode,
    handlerContext: NodeHandlerContext,
  ): Promise<NodeExecutionResult>;

  /**
   * Helper to create a completed node state
   */
  protected createCompletedState(
    nodeId: string,
    input: unknown,
    output: unknown,
    executionTime: number,
  ): NodeState {
    return {
      nodeId,
      status: "completed",
      input,
      output,
      attempt: 1,
      startedAt: new Date(Date.now() - executionTime),
      completedAt: new Date(),
    };
  }

  /**
   * Helper to create a failed node state
   */
  protected createFailedState(
    nodeId: string,
    input: unknown,
    error: string,
    executionTime: number,
  ): NodeState {
    return {
      nodeId,
      status: "failed",
      input,
      error,
      attempt: 1,
      startedAt: new Date(Date.now() - executionTime),
      completedAt: new Date(),
    };
  }

  /**
   * Helper to create a running/waiting node state.
   * "waiting" behavior uses "running" status (NodeStatus doesn't include "waiting").
   */
  protected createWaitingState(
    nodeId: string,
    input: unknown,
    _waitReason?: string,
  ): NodeState {
    return {
      nodeId,
      status: "running", // "waiting" is expressed via the 'waiting: true' result
      input,
      attempt: 1,
      startedAt: new Date(),
    };
  }
}
