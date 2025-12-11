
import type { NodeState, WaitNodeConfig, WorkflowNode, WorkflowNodeConfig } from "../../types.ts";
import {
  BaseNodeHandler,
  type NodeExecutionResult,
  type NodeHandlerContext,
} from "./node-handler.ts";

export interface WaitNodeCallbacks {
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
}

export class WaitNodeHandler extends BaseNodeHandler<WaitNodeConfig> {
  readonly nodeType = "wait" as const;

  constructor(private callbacks?: WaitNodeCallbacks) {
    super();
  }

  canHandle(config: WorkflowNodeConfig): config is WaitNodeConfig {
    return config.type === "wait";
  }

  async execute(
    node: WorkflowNode,
    handlerContext: NodeHandlerContext,
  ): Promise<NodeExecutionResult> {
    const { context } = handlerContext;
    const config = node.config as WaitNodeConfig;

    this.callbacks?.onWaiting?.(node.id, config);

    const state: NodeState = {
      nodeId: node.id,
      status: "running",
      input: {
        type: config.waitType,
        message: config.message,
        payload: typeof config.payload === "function"
          ? await config.payload(context)
          : config.payload,
      },
      attempt: 1,
      startedAt: new Date(),
    };

    return {
      state,
      contextUpdates: {},
      waiting: true,
    };
  }
}

export function createWaitNodeHandler(callbacks?: WaitNodeCallbacks): WaitNodeHandler {
  return new WaitNodeHandler(callbacks);
}
