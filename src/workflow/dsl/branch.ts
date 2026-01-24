import type {
  BaseNodeConfig,
  BranchNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { validateNodeId } from "./validation.ts";

export interface BranchOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  condition: (context: WorkflowContext) => boolean | Promise<boolean>;
  then: WorkflowNode[];
  else?: WorkflowNode[];
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

function prefixNodes(id: string, branch: "then" | "else", nodes: WorkflowNode[]): WorkflowNode[] {
  const prefix = `${id}/${branch}/`;
  return nodes.map((node) => ({
    ...node,
    id: node.id.startsWith(prefix) ? node.id : `${prefix}${node.id}`,
  }));
}

/** Create a conditional branch node. */
export function branch(id: string, options: BranchOptions): WorkflowNode {
  validateNodeId(id);

  if (!options.condition) {
    throw new Error(`Branch "${id}" must specify a condition`);
  }

  if (!options.then?.length) {
    throw new Error(`Branch "${id}" must have at least one 'then' node`);
  }

  const config: BranchNodeConfig = {
    type: "branch",
    condition: options.condition,
    then: prefixNodes(id, "then", options.then),
    else: options.else ? prefixNodes(id, "else", options.else) : undefined,
    checkpoint: options.checkpoint ?? false,
    retry: options.retry,
    timeout: options.timeout,
    skip: options.skip,
  };

  return { id, config };
}

/** Create a branch that only executes if condition is true (no else). */
export function when(
  id: string,
  condition: (context: WorkflowContext) => boolean | Promise<boolean>,
  nodes: WorkflowNode[],
): WorkflowNode {
  return branch(id, { condition, then: nodes });
}

/** Create a branch that only executes if condition is false. */
export function unless(
  id: string,
  condition: (context: WorkflowContext) => boolean | Promise<boolean>,
  nodes: WorkflowNode[],
): WorkflowNode {
  return branch(id, {
    condition: async (ctx) => !(await condition(ctx)),
    then: nodes,
  });
}
