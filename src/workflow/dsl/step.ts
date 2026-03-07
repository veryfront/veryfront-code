import type { Agent } from "#veryfront/agent";
import type { Tool } from "#veryfront/tool";
import type {
  BaseNodeConfig,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

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

  const hasAgent = options.agent != null;
  const hasTool = options.tool != null;

  if (!hasAgent && !hasTool) {
    throw INVALID_ARGUMENT.create({ detail: `Step "${id}" must specify either 'agent' or 'tool'` });
  }

  if (hasAgent && hasTool) {
    throw INVALID_ARGUMENT.create({
      detail: `Step "${id}" cannot specify both 'agent' and 'tool'`,
    });
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
