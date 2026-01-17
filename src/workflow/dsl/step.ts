import type { Agent } from "@veryfront/agent";
import type { Tool } from "@veryfront/tool";
import type {
  BaseNodeConfig,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";

export interface StepOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  agent?: string | Agent;
  tool?: string | Tool | undefined;
  input?:
    | string
    | Record<string, unknown>
    | ((context: WorkflowContext) => unknown);
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Create a step node for agent or tool execution.
 */
export function step(id: string, options: StepOptions): WorkflowNode {
  validateNodeId(id);

  // Validate that either agent or tool is specified
  if (!options.agent && !options.tool) {
    throw new Error(`Step "${id}" must specify either 'agent' or 'tool'`);
  }

  if (options.agent && options.tool) {
    throw new Error(`Step "${id}" cannot specify both 'agent' and 'tool'`);
  }

  // Default checkpoint to true for agent steps
  const shouldCheckpoint = options.checkpoint ?? !!options.agent;

  const config: StepNodeConfig = {
    type: "step",
    agent: options.agent,
    tool: options.tool,
    input: options.input,
    checkpoint: shouldCheckpoint,
    retry: options.retry,
    timeout: options.timeout,
    skip: options.skip,
  };

  return {
    id,
    config,
  };
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
