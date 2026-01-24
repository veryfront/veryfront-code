/**************************
 * Workflow DSL Builder
 *
 * Main factory function for creating durable workflows
 **************************/

import type { z } from "zod";
import type {
  RetryConfig,
  StepBuilderContext,
  Workflow,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";
import { workflowRegistry } from "../registry.ts";

export type { Workflow } from "../types.ts";

export interface WorkflowOptions<TInput = unknown, TOutput = unknown> {
  id: string;
  description?: string;
  version?: string;
  inputSchema?: z.ZodSchema<TInput>;
  outputSchema?: z.ZodSchema<TOutput>;
  retry?: RetryConfig;
  timeout?: string | number;
  introspect?: boolean;
  steps:
    | WorkflowNode[]
    | ((context: StepBuilderContext<TInput>) => WorkflowNode[]);
  onError?: (error: Error, context: WorkflowContext) => void | Promise<void>;
  onComplete?: (
    result: TOutput,
    context: WorkflowContext,
  ) => void | Promise<void>;
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
    introspect: options.introspect,
    steps: options.steps,
    onError: options.onError,
    onComplete: options.onComplete,
  };

  const wf: Workflow<TInput, TOutput> = {
    definition,
    id: options.id,
    version: options.version,
  };

  // Auto-register for discovery in dev tools
  // Use type assertion since registry only stores metadata, not the full generic type
  workflowRegistry.register(wf as unknown as Workflow);

  return wf;
}

export function sequence(...nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node, index) => {
    if (index === 0) return node;

    return {
      ...node,
      dependsOn: [nodes[index - 1]!.id],
    };
  });
}

export function dag(
  nodes: Record<string, WorkflowNode | { node: WorkflowNode; dependsOn: string[] }>,
): WorkflowNode[] {
  const result: WorkflowNode[] = [];
  const seenIds = new Set<string>();

  for (const [id, value] of Object.entries(nodes)) {
    const isWithDeps = "node" in value && "dependsOn" in value;

    const baseNode = isWithDeps ? value.node : (value as WorkflowNode);
    const nodeId = baseNode.id || id;

    const node: WorkflowNode = isWithDeps
      ? { ...baseNode, id: nodeId, dependsOn: value.dependsOn }
      : { ...baseNode, id: nodeId };

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
    dependsOn: [...(node.dependsOn ?? []), ...dependencies],
  };
}
