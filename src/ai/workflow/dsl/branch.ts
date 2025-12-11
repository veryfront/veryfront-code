
import type {
  BaseNodeConfig,
  BranchNodeConfig,
  RetryConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";

export interface BranchOptions extends Omit<BaseNodeConfig, "checkpoint"> {
  condition: (context: WorkflowContext) => boolean | Promise<boolean>;
  then: WorkflowNode[];
  else?: WorkflowNode[];
  checkpoint?: boolean;
  retry?: RetryConfig;
  timeout?: string | number;
  skip?: (context: WorkflowContext) => boolean | Promise<boolean>;
}

export function branch(id: string, options: BranchOptions): WorkflowNode {
  if (!id || typeof id !== "string" || id.trim() === "") {
    throw new Error("Node ID must be a non-empty string");
  }

  if (!options.condition) {
    throw new Error(`Branch "${id}" must specify a condition`);
  }

  if (!options.then || options.then.length === 0) {
    throw new Error(`Branch "${id}" must have at least one 'then' node`);
  }

  const prefixThenNodes = options.then.map((node) => ({
    ...node,
    id: node.id.startsWith(`${id}/then/`) ? node.id : `${id}/then/${node.id}`,
  }));

  const prefixElseNodes = options.else?.map((node) => ({
    ...node,
    id: node.id.startsWith(`${id}/else/`) ? node.id : `${id}/else/${node.id}`,
  }));

  const config: BranchNodeConfig = {
    type: "branch",
    condition: options.condition,
    then: prefixThenNodes,
    else: prefixElseNodes,
    checkpoint: options.checkpoint ?? false,
    retry: options.retry,
    timeout: options.timeout,
    skip: options.skip,
  };

  return {
    id,
    config,
  };
}

export function when(
  id: string,
  condition: (context: WorkflowContext) => boolean | Promise<boolean>,
  nodes: WorkflowNode[],
): WorkflowNode {
  return branch(id, { condition, then: nodes });
}

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
