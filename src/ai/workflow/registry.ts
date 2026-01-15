/**
 * Workflow Registry
 *
 * Global registry for workflow DEFINITIONS (not executions).
 * Used for discovery and visibility in dev tools.
 *
 * Note: This registry stores workflow metadata/definitions only.
 * Workflow RUNS are managed by WorkflowClient with backend-specific storage.
 */

import type { WorkflowDefinition, WorkflowNode } from "./types.ts";
import type { Workflow } from "./dsl/workflow.ts";
import { zodToJsonSchema } from "../utils/zod-json-schema.ts";

/**
 * Serializable node information for the registry
 */
export interface NodeInfo {
  id: string;
  type: string;
  /** Agent ID if this is a step using an agent */
  agent?: string;
  /** Tool ID if this is a step using a tool */
  tool?: string;
  /** Node IDs this node depends on */
  dependsOn?: string[];
  /** Child node IDs (for parallel/branch nodes) */
  children?: string[];
  /** Description from wait/approval nodes */
  message?: string;
}

/**
 * Workflow metadata for the registry (serializable)
 */
export interface WorkflowMetadata {
  id: string;
  description?: string;
  version?: string;
  timeout?: string | number;
  nodeCount: number;
  nodeTypes: string[];
  /** Detailed node information */
  nodes: NodeInfo[];
  /** Agent IDs referenced by this workflow */
  agentRefs: string[];
  /** Tool IDs referenced by this workflow */
  toolRefs: string[];
  hasInputSchema: boolean;
  hasOutputSchema: boolean;
  /** JSON Schema representation of input schema (if available) */
  inputSchemaJson?: Record<string, unknown>;
  registeredAt: string;
}

/**
 * Extract metadata from a workflow definition
 */
function extractMetadata(definition: WorkflowDefinition): WorkflowMetadata {
  // Get nodes - handle both static array and function form
  let workflowNodes: WorkflowNode[] = [];
  if (Array.isArray(definition.steps)) {
    workflowNodes = definition.steps;
  } else if (typeof definition.steps === "function") {
    // Try calling with dummy input to extract static structure
    // This works for workflows that only use input for data values, not control flow
    try {
      // Create a proxy that returns placeholder values for any property access
      const dummyInput = new Proxy({}, {
        get: (_target, prop) => {
          if (typeof prop === "string") {
            return `__placeholder_${prop}__`;
          }
          return undefined;
        },
      });
      workflowNodes = definition.steps({ input: dummyInput });
    } catch {
      // If it fails (e.g., requires specific input structure), treat as dynamic
      workflowNodes = [];
    }
  }

  // Collect node types, node info, and references
  const nodeTypes = new Set<string>();
  const nodeInfoList: NodeInfo[] = [];
  const agentRefs = new Set<string>();
  const toolRefs = new Set<string>();

  function extractNodeInfo(nodeList: WorkflowNode[]): string[] {
    const ids: string[] = [];
    for (const node of nodeList) {
      nodeTypes.add(node.config.type);
      ids.push(node.id);

      const nodeInfo: NodeInfo = {
        id: node.id,
        type: node.config.type,
        dependsOn: node.dependsOn,
      };

      // Extract agent/tool references from step nodes
      const config = node.config as unknown as Record<string, unknown>;
      if (node.config.type === "step") {
        if ("agent" in config) {
          const agentRef = typeof config.agent === "string"
            ? config.agent
            : (config.agent as { id?: string })?.id;
          if (agentRef) {
            nodeInfo.agent = agentRef;
            agentRefs.add(agentRef);
          }
        }
        if ("tool" in config) {
          const toolRef = typeof config.tool === "string"
            ? config.tool
            : (config.tool as { id?: string })?.id;
          if (toolRef) {
            nodeInfo.tool = toolRef;
            toolRefs.add(toolRef);
          }
        }
      }

      // Extract message from wait nodes
      if (node.config.type === "wait" && "message" in config) {
        nodeInfo.message = config.message as string;
      }

      // Recurse into parallel/branch children
      if ("nodes" in config && Array.isArray(config.nodes)) {
        nodeInfo.children = extractNodeInfo(config.nodes as WorkflowNode[]);
      }
      if ("then" in config && Array.isArray(config.then)) {
        nodeInfo.children = extractNodeInfo(config.then as WorkflowNode[]);
      }
      if ("else" in config && Array.isArray(config.else)) {
        const elseIds = extractNodeInfo(config.else as WorkflowNode[]);
        nodeInfo.children = [...(nodeInfo.children || []), ...elseIds];
      }

      nodeInfoList.push(nodeInfo);
    }
    return ids;
  }

  extractNodeInfo(workflowNodes);

  // Convert input schema to JSON Schema if available
  let inputSchemaJson: Record<string, unknown> | undefined;
  if (definition.inputSchema) {
    try {
      inputSchemaJson = zodToJsonSchema(definition.inputSchema) as Record<string, unknown>;
    } catch {
      // Ignore conversion errors
    }
  }

  return {
    id: definition.id,
    description: definition.description,
    version: definition.version,
    timeout: definition.timeout,
    nodeCount: workflowNodes.length,
    nodeTypes: Array.from(nodeTypes),
    nodes: nodeInfoList,
    agentRefs: Array.from(agentRefs),
    toolRefs: Array.from(toolRefs),
    hasInputSchema: !!definition.inputSchema,
    hasOutputSchema: !!definition.outputSchema,
    inputSchemaJson,
    registeredAt: new Date().toISOString(),
  };
}

/**
 * Workflow Registry class
 */
class WorkflowRegistryClass {
  private workflows = new Map<string, WorkflowMetadata>();
  private definitions = new Map<string, WorkflowDefinition>();

  /**
   * Register a workflow definition
   */
  register(workflow: Workflow | WorkflowDefinition): void {
    const definition = "definition" in workflow ? workflow.definition : workflow;
    const metadata = extractMetadata(definition);

    this.workflows.set(definition.id, metadata);
    this.definitions.set(definition.id, definition);
  }

  /**
   * Get workflow metadata by ID
   */
  get(id: string): WorkflowMetadata | undefined {
    return this.workflows.get(id);
  }

  /**
   * Get workflow definition by ID
   */
  getDefinition(id: string): WorkflowDefinition | undefined {
    return this.definitions.get(id);
  }

  /**
   * Check if a workflow is registered
   */
  has(id: string): boolean {
    return this.workflows.has(id);
  }

  /**
   * Get all workflow IDs
   */
  getAllIds(): string[] {
    return Array.from(this.workflows.keys());
  }

  /**
   * Get all workflow metadata
   */
  getAll(): Map<string, WorkflowMetadata> {
    return new Map(this.workflows);
  }

  /**
   * Get all as array (for API responses)
   */
  getAllAsArray(): WorkflowMetadata[] {
    return Array.from(this.workflows.values());
  }

  /**
   * Get registry stats
   */
  getStats(): {
    total: number;
    byNodeType: Record<string, number>;
    withInputSchema: number;
    withOutputSchema: number;
  } {
    const byNodeType: Record<string, number> = {};
    let withInputSchema = 0;
    let withOutputSchema = 0;

    for (const metadata of this.workflows.values()) {
      for (const nodeType of metadata.nodeTypes) {
        byNodeType[nodeType] = (byNodeType[nodeType] || 0) + 1;
      }
      if (metadata.hasInputSchema) withInputSchema++;
      if (metadata.hasOutputSchema) withOutputSchema++;
    }

    return {
      total: this.workflows.size,
      byNodeType,
      withInputSchema,
      withOutputSchema,
    };
  }

  /**
   * Remove a workflow
   */
  unregister(id: string): boolean {
    this.definitions.delete(id);
    return this.workflows.delete(id);
  }

  /**
   * Clear all workflows (for testing)
   */
  clear(): void {
    this.workflows.clear();
    this.definitions.clear();
  }
}

// Singleton using globalThis pattern
const WORKFLOW_REGISTRY_KEY = "__veryfront_workflow_registry__";
// deno-lint-ignore no-explicit-any
const _globalWorkflow = globalThis as any;
export const workflowRegistry: WorkflowRegistryClass = _globalWorkflow[WORKFLOW_REGISTRY_KEY] ||=
  new WorkflowRegistryClass();

// Export class for type usage
export { WorkflowRegistryClass };

/**
 * Register a workflow definition globally
 */
export function registerWorkflow(workflow: Workflow | WorkflowDefinition): void {
  workflowRegistry.register(workflow);
}

/**
 * Get a workflow by ID
 */
export function getWorkflow(id: string): WorkflowMetadata | undefined {
  return workflowRegistry.get(id);
}

/**
 * Get all registered workflow IDs
 */
export function getAllWorkflowIds(): string[] {
  return workflowRegistry.getAllIds();
}
