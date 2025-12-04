/**
 * Wait Node Handler
 *
 * Handles execution of wait nodes - for human approvals, timers, or external events.
 */

import type { NodeState, WaitNodeConfig, WorkflowNode, WorkflowNodeConfig } from "../../types.ts";
import {
  BaseNodeHandler,
  type NodeExecutionResult,
  type NodeHandlerContext,
} from "./node-handler.ts";

/**
 * Callbacks for wait node events
 */
export interface WaitNodeCallbacks {
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
}

/**
 * Handler for wait nodes.
 *
 * Wait nodes pause workflow execution until:
 * - Human approval is received
 * - A timer expires
 * - An external event occurs
 */
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

    // Notify that we're waiting
    this.callbacks?.onWaiting?.(node.id, config);

    const state: NodeState = {
      nodeId: node.id,
      status: "running", // "waiting" is expressed via the result.waiting flag
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

    // Signal that workflow is now waiting
    return {
      state,
      contextUpdates: {},
      waiting: true,
    };
  }
}

/**
 * Create a wait node handler.
 */
export function createWaitNodeHandler(callbacks?: WaitNodeCallbacks): WaitNodeHandler {
  return new WaitNodeHandler(callbacks);
}
