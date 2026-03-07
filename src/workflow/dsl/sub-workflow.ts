import type {
  BaseNodeConfig,
  SubWorkflowNodeConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

export interface SubWorkflowOptions extends BaseNodeConfig {
  workflow: WorkflowDefinition;
  input?: unknown | ((context: WorkflowContext) => unknown);
  output?: (result: unknown) => unknown;
}

/** Create a sub-workflow node for nested execution. */
export function subWorkflow(id: string, options: SubWorkflowOptions): WorkflowNode {
  validateNodeId(id);

  if (!options.workflow) {
    throw INVALID_ARGUMENT.create({
      detail: `SubWorkflow node "${id}" must have a 'workflow' configured`,
    });
  }

  const config: SubWorkflowNodeConfig = {
    type: "subWorkflow",
    workflow: options.workflow,
    checkpoint: options.checkpoint,
    retry: options.retry,
    timeout: options.timeout,
    skip: options.skip,
    input: options.input,
    output: options.output,
  };

  return { id, config };
}
