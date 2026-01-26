import type { Agent } from "../../agent/index.js";
import type { Tool } from "../../tool/index.js";
import type {
  BaseNodeConfig,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.js";
import { validateNodeId } from "./validation.js";

export interface StepOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  agent?: string | Agent;
  tool?: string | Tool;
  input?: string | Record<string, unknown> | ((context: WorkflowContext) => unknown);
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

export function step(id: string, options: StepOptions): WorkflowNode {
  validateNodeId(id);

  const hasAgent = !!options.agent;
  const hasTool = !!options.tool;

  if (!hasAgent && !hasTool) {
    throw new Error(`Step "${id}" must specify either 'agent' or 'tool'`);
  }

  if (hasAgent && hasTool) {
    throw new Error(`Step "${id}" cannot specify both 'agent' and 'tool'`);
  }

  const config: StepNodeConfig = {
    type: "step",
    agent: options.agent,
    tool: options.tool,
    input: options.input,
    checkpoint: options.checkpoint ?? hasAgent,
    retry: options.retry,
    timeout: options.timeout,
    skip: options.skip,
  };

  return { id, config };
}

export function agentStep(
  id: string,
  agent: string | Agent,
  options?: Omit<StepOptions, "agent" | "tool">,
): WorkflowNode {
  return step(id, { ...options, agent });
}

export function toolStep(
  id: string,
  tool: string | Tool,
  options?: Omit<StepOptions, "agent" | "tool">,
): WorkflowNode {
  return step(id, { ...options, tool });
}
