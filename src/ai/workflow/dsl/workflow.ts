
import type { z } from "zod";
import type {
  RetryConfig,
  StepBuilderContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";

export interface WorkflowOptions<TInput = unknown, TOutput = unknown> {
  id: string;
  description?: string;
  version?: string;
  inputSchema?: z.ZodSchema<TInput>;
  outputSchema?: z.ZodSchema<TOutput>;
  retry?: RetryConfig;
  timeout?: string | number;
  steps:
    | WorkflowNode[]
    | ((context: StepBuilderContext<TInput>) => WorkflowNode[]);
  onError?: (error: Error, context: WorkflowContext) => void | Promise<void>;
  onComplete?: (
    result: TOutput,
    context: WorkflowContext,
  ) => void | Promise<void>;
}

export interface Workflow<TInput = unknown, TOutput = unknown> {
  definition: WorkflowDefinition<TInput, TOutput>;
  id: string;
  version?: string;
}

export function workflow<TInput = unknown, TOutput = unknown>(
  options: WorkflowOptions<TInput, TOutput>,
): Workflow<TInput, TOutput> {
  if (!options.id) {
    throw new Error("Workflow must have an 'id'");
  }

  if (!options.steps) {
    throw new Error(`Workflow "${options.id}" must have 'steps'`);
  }

  const definition: WorkflowDefinition<TInput, TOutput> = {
    id: options.id,
    description: options.description,
    version: options.version,
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    retry: options.retry,
    timeout: options.timeout,
    steps: options.steps,
    onError: options.onError,
    onComplete: options.onComplete,
  };

  return {
    definition,
    id: options.id,
    version: options.version,
  };
}

export function sequence(...nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node, index) => {
    if (index === 0) {
      return node;
    }
    const prevNode = nodes[index - 1];
    return {
      ...node,
      dependsOn: prevNode ? [prevNode.id] : undefined,
    };
  });
}

export function dag(
  nodes: Record<string, WorkflowNode | { node: WorkflowNode; dependsOn: string[] }>,
): WorkflowNode[] {
  const result: WorkflowNode[] = [];
  const seenIds = new Set<string>();

  for (const [id, value] of Object.entries(nodes)) {
    let nodeId: string;
    let node: WorkflowNode;

    if ("node" in value && "dependsOn" in value) {
      nodeId = value.node.id || id;
      node = {
        ...value.node,
        id: nodeId,
        dependsOn: value.dependsOn,
      };
    } else {
      const workflowNode = value as WorkflowNode;
      nodeId = workflowNode.id || id;
      node = {
        ...workflowNode,
        id: nodeId,
      };
    }

    if (seenIds.has(nodeId)) {
      throw new Error(`Duplicate node ID detected in dag: "${nodeId}"`);
    }
    seenIds.add(nodeId);

    result.push(node);
  }

  return result;
}

export function dependsOn(
  node: WorkflowNode,
  ...dependencies: string[]
): WorkflowNode {
  return {
    ...node,
    dependsOn: [...(node.dependsOn || []), ...dependencies],
  };
}
