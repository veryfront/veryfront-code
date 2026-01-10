import type { NodeState, StepNodeConfig, WorkflowNode, WorkflowNodeConfig } from "../../types.ts";
import type { StepExecutor } from "../step-executor.ts";
import {
  BaseNodeHandler,
  type NodeExecutionResult,
  type NodeHandlerContext,
} from "./node-handler.ts";

export interface StepNodeCallbacks {
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
}

/** Executes a single function with retry support */
export class StepNodeHandler extends BaseNodeHandler<StepNodeConfig> {
  readonly nodeType = "step" as const;

  constructor(
    private stepExecutor: StepExecutor,
    private callbacks?: StepNodeCallbacks,
  ) {
    super();
  }

  canHandle(config: WorkflowNodeConfig): config is StepNodeConfig {
    return config.type === "step";
  }

  async execute(
    node: WorkflowNode,
    handlerContext: NodeHandlerContext,
  ): Promise<NodeExecutionResult> {
    const { context } = handlerContext;
    const result = await this.stepExecutor.execute(node, context);

    const state: NodeState = {
      nodeId: node.id,
      status: result.success ? "completed" : "failed",
      input: context.input,
      output: result.output,
      error: result.error,
      attempt: 1,
      startedAt: new Date(Date.now() - result.executionTime),
      completedAt: new Date(),
    };

    this.callbacks?.onNodeComplete?.(node.id, state);

    return {
      state,
      contextUpdates: result.success ? { [node.id]: result.output } : {},
      waiting: false,
    };
  }
}

export function createStepNodeHandler(
  stepExecutor: StepExecutor,
  callbacks?: StepNodeCallbacks,
): StepNodeHandler {
  return new StepNodeHandler(stepExecutor, callbacks);
}
