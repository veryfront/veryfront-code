/**
 * Workflow DSL Builder
 *
 * Main factory function for creating durable workflows
 */

import type { z } from "zod";
import type {
  RetryConfig,
  StepBuilderContext,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
} from "../types.ts";

/**
 * Options for creating a workflow
 */
export interface WorkflowOptions<TInput = unknown, TOutput = unknown> {
  /** Unique workflow identifier */
  id: string;
  /** Optional description */
  description?: string;
  /** Optional version */
  version?: string;
  /** Input validation schema (Zod) */
  inputSchema?: z.ZodSchema<TInput>;
  /** Output validation schema (Zod) */
  outputSchema?: z.ZodSchema<TOutput>;
  /** Default retry configuration for all steps */
  retry?: RetryConfig;
  /** Default timeout for the entire workflow */
  timeout?: string | number;
  /**
   * Workflow steps - can be:
   * - An array of WorkflowNode
   * - A function that returns an array based on input
   */
  steps:
    | WorkflowNode[]
    | ((context: StepBuilderContext<TInput>) => WorkflowNode[]);
  /** Error handler called when workflow fails */
  onError?: (error: Error, context: WorkflowContext) => void | Promise<void>;
  /** Completion handler called when workflow succeeds */
  onComplete?: (
    result: TOutput,
    context: WorkflowContext,
  ) => void | Promise<void>;
}

/**
 * Created workflow with execution methods
 */
export interface Workflow<TInput = unknown, TOutput = unknown> {
  /** Workflow definition */
  definition: WorkflowDefinition<TInput, TOutput>;
  /** Workflow ID */
  id: string;
  /** Workflow version */
  version?: string;
}

/**
 * Create a durable workflow definition
 *
 * @example
 * ```typescript
 * import { workflow, step, parallel, branch, waitForApproval } from 'veryfront/ai/workflow';
 * import { z } from 'zod';
 *
 * export default workflow({
 *   id: 'content-pipeline',
 *   description: 'Generate and publish content with human review',
 *
 *   inputSchema: z.object({
 *     topic: z.string(),
 *     requiresApproval: z.boolean().default(true),
 *   }),
 *
 *   timeout: '2h',
 *
 *   steps: ({ input }) => [
 *     // Research phase
 *     step('research', {
 *       agent: 'researcher',
 *       input: `Research: ${input.topic}`,
 *     }),
 *
 *     // Generate content in parallel
 *     parallel('generate', [
 *       step('write-article', { agent: 'writer' }),
 *       step('create-images', { tool: 'imageGenerator' }),
 *     ]),
 *
 *     // Optional approval gate
 *     branch('approval-gate', {
 *       condition: () => input.requiresApproval,
 *       then: [
 *         waitForApproval('human-review', {
 *           timeout: '24h',
 *           message: 'Please review the content',
 *         }),
 *       ],
 *     }),
 *
 *     // Publish
 *     step('publish', { agent: 'publisher' }),
 *   ],
 *
 *   onComplete: async (result, context) => {
 *     console.log('Workflow completed:', result);
 *   },
 *
 *   onError: async (error, context) => {
 *     console.error('Workflow failed:', error);
 *   },
 * });
 * ```
 */
export function workflow<TInput = unknown, TOutput = unknown>(
  options: WorkflowOptions<TInput, TOutput>,
): Workflow<TInput, TOutput> {
  // Validate required fields
  if (!options.id) {
    throw new Error("Workflow must have an 'id'");
  }

  if (!options.steps) {
    throw new Error(`Workflow "${options.id}" must have 'steps'`);
  }

  // Create the workflow definition
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

/**
 * Helper to build linear dependencies between nodes
 *
 * Takes an array of nodes and returns them with dependsOn set
 * so each node depends on the previous one.
 */
export function sequence(...nodes: WorkflowNode[]): WorkflowNode[] {
  return nodes.map((node, index) => {
    if (index === 0) {
      return node;
    }
    return {
      ...node,
      dependsOn: [nodes[index - 1].id],
    };
  });
}

/**
 * Create a DAG-based workflow with explicit dependencies
 *
 * @example
 * ```typescript
 * import { dag, workflow } from 'veryfront/ai/workflow';
 *
 * export default workflow({
 *   id: 'data-pipeline',
 *   steps: dag({
 *     'fetch': step('fetch', { tool: 'dataFetcher' }),
 *     'validate': step('validate', { agent: 'validator' }).dependsOn('fetch'),
 *     'transform-a': step('transform-a', { tool: 'transformerA' }).dependsOn('validate'),
 *     'transform-b': step('transform-b', { tool: 'transformerB' }).dependsOn('validate'),
 *     'aggregate': step('aggregate', { agent: 'aggregator' }).dependsOn('transform-a', 'transform-b'),
 *   }),
 * });
 * ```
 */
export function dag(
  nodes: Record<string, WorkflowNode | { node: WorkflowNode; dependsOn: string[] }>,
): WorkflowNode[] {
  const result: WorkflowNode[] = [];
  const seenIds = new Set<string>();

  for (const [id, value] of Object.entries(nodes)) {
    let nodeId: string;
    let node: WorkflowNode;

    if ("node" in value && "dependsOn" in value) {
      // Object with explicit dependencies
      nodeId = value.node.id || id;
      node = {
        ...value.node,
        id: nodeId,
        dependsOn: value.dependsOn,
      };
    } else {
      // Plain WorkflowNode
      const workflowNode = value as WorkflowNode;
      nodeId = workflowNode.id || id;
      node = {
        ...workflowNode,
        id: nodeId,
      };
    }

    // Check for duplicate IDs
    if (seenIds.has(nodeId)) {
      throw new Error(`Duplicate node ID detected in dag: "${nodeId}"`);
    }
    seenIds.add(nodeId);

    result.push(node);
  }

  return result;
}

/**
 * Helper to add dependencies to a node
 */
export function dependsOn(
  node: WorkflowNode,
  ...dependencies: string[]
): WorkflowNode {
  return {
    ...node,
    dependsOn: [...(node.dependsOn || []), ...dependencies],
  };
}
