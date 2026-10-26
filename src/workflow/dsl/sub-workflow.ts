import type {
  BaseNodeConfig,
  SubWorkflowNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

/** Options accepted by sub workflow. */
export interface SubWorkflowOptions extends BaseNodeConfig {
  workflow: WorkflowDefinition;
  /** Literal input or a function that derives it from workflow context. */
  input?: unknown;
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
    description: options.description,
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
