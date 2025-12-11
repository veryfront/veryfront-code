
import type { Agent } from "../../types/agent.ts";
import type { Tool } from "../../types/tool.ts";
import type {
  BaseNodeConfig,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";

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

export function step(id: string, options: StepOptions): WorkflowNode {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

  if (!options.agent && !options.tool) {
    throw new Error(`Step "${id}" must specify either 'agent' or 'tool'`);
  }

  if (options.agent && options.tool) {
    throw new Error(`Step "${id}" cannot specify both 'agent' and 'tool'`);
  }

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
