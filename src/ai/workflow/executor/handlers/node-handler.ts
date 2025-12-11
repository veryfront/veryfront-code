
import type {
  NodeState,
  WorkflowContext,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowNodeType,
} from "../../types.ts";

export interface NodeExecutionResult {
  state: NodeState;
  contextUpdates: Record<string, unknown>;
  waiting: boolean;
}

export interface NodeHandlerContext {
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
}

export interface INodeHandler<TConfig extends WorkflowNodeConfig = WorkflowNodeConfig> {
  readonly nodeType: WorkflowNodeType;

  canHandle(config: WorkflowNodeConfig): config is TConfig;

  execute(node: WorkflowNode, handlerContext: NodeHandlerContext): Promise<NodeExecutionResult>;
}

export abstract class BaseNodeHandler<TConfig extends WorkflowNodeConfig = WorkflowNodeConfig>
  implements INodeHandler<TConfig> {
  abstract readonly nodeType: WorkflowNodeType;

  abstract canHandle(config: WorkflowNodeConfig): config is TConfig;

  abstract execute(
    node: WorkflowNode,
    handlerContext: NodeHandlerContext,
  ): Promise<NodeExecutionResult>;

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

  protected createWaitingState(
    nodeId: string,
    input: unknown,
    _waitReason?: string,
  ): NodeState {
    return {
      nodeId,
      status: "running",
      input,
      attempt: 1,
      startedAt: new Date(),
    };
  }
}
