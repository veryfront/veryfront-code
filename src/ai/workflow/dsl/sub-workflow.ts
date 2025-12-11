
import type {
  BaseNodeConfig,
  SubWorkflowNodeConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";

export interface SubWorkflowOptions extends BaseNodeConfig {
  workflow: WorkflowDefinition;
  input?: unknown | ((context: WorkflowContext) => unknown);
  output?: (result: unknown) => unknown;
}

export function subWorkflow(
  id: string,
  options: SubWorkflowOptions,
): WorkflowNode {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

  if (!options.workflow) {
    throw new Error(`SubWorkflow node "${id}" must have a 'workflow' configured`);
  }

  const config: SubWorkflowNodeConfig = {
    type: "subWorkflow",
    workflow: options.workflow,
    input: options.input,
    output: options.output,
    checkpoint: options.checkpoint,
    retry: options.retry,
    timeout: options.timeout,
    skip: options.skip,
  };

  return {
    id,
    config,
  };
}
