/**
 * SubWorkflow DSL Builder
 *
 * Creates sub-workflow nodes for nested workflow execution
 */

import type {
  BaseNodeConfig,
  SubWorkflowNodeConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";

/**
 * Options for creating a sub-workflow node
 */
export interface SubWorkflowOptions extends BaseNodeConfig {
  /** The workflow definition to execute */
  workflow: WorkflowDefinition;
  /** Input for the sub-workflow */
  input?: unknown | ((context: WorkflowContext) => unknown);
  /** Transform the sub-workflow output */
  output?: (result: unknown) => unknown;
}

/**
 * Create a sub-workflow node for nested execution
 *
 * @example
 * ```typescript
 * import mySubWorkflow from './my-sub-workflow';
 *
 * // Execute a sub-workflow
 * subWorkflow('nested-process', {
 *   workflow: mySubWorkflow.definition,
 *   input: (ctx) => ({ data: ctx.prevStep.result })
 * })
 * ```
 */
export function subWorkflow(
  id: string,
  options: SubWorkflowOptions,
): WorkflowNode {
  validateNodeId(id);

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
