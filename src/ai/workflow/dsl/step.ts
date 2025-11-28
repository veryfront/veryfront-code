/**
 * Step DSL Builder
 *
 * Creates step nodes for agent or tool execution
 */

import type { Agent } from "../../types/agent.ts";
import type { Tool } from "../../types/tool.ts";
import type {
  BaseNodeConfig,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";

/**
 * Options for creating a step node
 */
export interface StepOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  /** Agent ID or agent instance to execute */
  agent?: string | Agent;
  /** Tool ID or tool instance to execute */
  tool?: string | Tool;
  /** Input for the agent/tool */
  input?:
    | string
    | Record<string, unknown>
    | ((context: WorkflowContext) => unknown);
  /** Whether to checkpoint after this step (default: true for agents) */
  checkpoint?: boolean;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Timeout for this step */
  timeout?: string | number;
  /** Condition to skip this step */
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

/**
 * Create a step node for agent or tool execution
 *
 * @example
 * ```typescript
 * // Agent step
 * step('research', {
 *   agent: 'researcher',
 *   input: 'Research AI safety',
 *   checkpoint: true,
 * })
 *
 * // Tool step
 * step('fetch-data', {
 *   tool: 'dataFetcher',
 *   input: { url: 'https://api.example.com/data' },
 * })
 *
 * // Dynamic input from context
 * step('write', {
 *   agent: 'writer',
 *   input: (ctx) => ctx['research'].output,
 * })
 * ```
 */
export function step(id: string, options: StepOptions): WorkflowNode {
  // Validate node ID
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

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

/**
 * Create a step that executes an agent
 * Convenience wrapper around step()
 */
export function agentStep(
  id: string,
  agent: string | Agent,
  options?: Omit<StepOptions, "agent" | "tool">,
): WorkflowNode {
  return step(id, { ...options, agent });
}

/**
 * Create a step that executes a tool
 * Convenience wrapper around step()
 */
export function toolStep(
  id: string,
  tool: string | Tool,
  options?: Omit<StepOptions, "agent" | "tool">,
): WorkflowNode {
  return step(id, { ...options, tool });
}
