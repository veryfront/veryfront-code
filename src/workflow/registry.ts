import type { Workflow, WorkflowDefinition, WorkflowNode } from "./types.ts";
import { zodToJsonSchema } from "#veryfront/tool/schema";
import { agentLogger as logger } from "#veryfront/utils";
import { ProjectScopedRegistryManager } from "#veryfront/ai/registry-manager.ts";

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

export interface WorkflowMetadata {
  id: string;
  description?: string;
  version?: string;
  timeout?: string | number;
  /** True when steps are defined dynamically via a function */
  dynamicSteps?: boolean;
  /** True when dynamic step introspection is disabled */
  introspectionSkipped?: boolean;
  /** Error message if introspection failed */
  introspectionError?: string;
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

function createProxy(): unknown {
  return new Proxy(
    {},
    {
      get: (_target, prop) => (typeof prop === "string" ? createProxy() : undefined),
    },
  );
}

function getWorkflowDefinition(workflow: Workflow | WorkflowDefinition): WorkflowDefinition {
  return "definition" in workflow ? workflow.definition : workflow;
}

function extractMetadata(definition: WorkflowDefinition): WorkflowMetadata {
  let workflowNodes: WorkflowNode[] = [];
  let dynamicSteps = false;
  let introspectionSkipped = false;
  let introspectionError: string | undefined;

  if (Array.isArray(definition.steps)) {
    workflowNodes = definition.steps;
  } else if (typeof definition.steps === "function") {
    dynamicSteps = true;

    if (!definition.introspect) {
      introspectionSkipped = true;
      logger.debug(
        `[WorkflowRegistry] Skipping dynamic steps introspection for "${definition.id}" (introspect=false)`,
      );
    } else {
      try {
        const dummyInput = createProxy();
        const dummyContext: Record<string, unknown> = { input: createProxy() };

        workflowNodes = definition.steps(
          {
            input: dummyInput,
            context: dummyContext,
          } as Parameters<typeof definition.steps>[0],
        );
      } catch (error) {
        introspectionError = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[WorkflowRegistry] Failed to introspect steps for "${definition.id}": ${introspectionError}`,
        );
      }
    }
  }

  const nodeTypes = new Set<string>();
  const nodeInfoList: NodeInfo[] = [];
  const agentRefs = new Set<string>();
  const toolRefs = new Set<string>();

  function extractNodeInfo(nodeList: WorkflowNode[]): string[] {
    const ids: string[] = [];

    for (const node of nodeList) {
      const type = node.config.type;
      nodeTypes.add(type);
      ids.push(node.id);

      const nodeInfo: NodeInfo = {
        id: node.id,
        type,
        dependsOn: node.dependsOn,
      };

      const config = node.config as unknown as Record<string, unknown>;

      if (type === "step") {
        const agentValue = config.agent;
        const agentRef = typeof agentValue === "string"
          ? agentValue
          : (agentValue as { id?: string } | undefined)?.id;

        if (agentRef) {
          nodeInfo.agent = agentRef;
          agentRefs.add(agentRef);
        }

        const toolValue = config.tool;
        const toolRef = typeof toolValue === "string"
          ? toolValue
          : (toolValue as { id?: string } | undefined)?.id;

        if (toolRef) {
          nodeInfo.tool = toolRef;
          toolRefs.add(toolRef);
        }
      }

      if (type === "wait" && "message" in config) {
        nodeInfo.message = config.message as string;
      }

      const children: string[] = [];

      if (Array.isArray(config.nodes)) {
        children.push(...extractNodeInfo(config.nodes as WorkflowNode[]));
      }
      if (Array.isArray(config.then)) {
        children.push(...extractNodeInfo(config.then as WorkflowNode[]));
      }
      if (Array.isArray(config.else)) {
        children.push(...extractNodeInfo(config.else as WorkflowNode[]));
      }

      if (children.length) nodeInfo.children = children;

      nodeInfoList.push(nodeInfo);
    }

    return ids;
  }

  extractNodeInfo(workflowNodes);

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
    dynamicSteps,
    introspectionSkipped,
    introspectionError,
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

const workflowMetadataManager = new ProjectScopedRegistryManager<WorkflowMetadata>("workflow");
const workflowDefinitionManager = new ProjectScopedRegistryManager<WorkflowDefinition>(
  "workflow-definition",
);

class WorkflowRegistryClass {
  register(workflow: Workflow | WorkflowDefinition): void {
    const definition = getWorkflowDefinition(workflow);
    const metadata = extractMetadata(definition);

    workflowMetadataManager.register(definition.id, metadata);
    workflowDefinitionManager.register(definition.id, definition);
  }

  registerShared(workflow: Workflow | WorkflowDefinition): void {
    const definition = getWorkflowDefinition(workflow);
    const metadata = extractMetadata(definition);

    workflowMetadataManager.registerShared(definition.id, metadata);
    workflowDefinitionManager.registerShared(definition.id, definition);
  }

  get(id: string): WorkflowMetadata | undefined {
    return workflowMetadataManager.get(id);
  }

  getDefinition(id: string): WorkflowDefinition | undefined {
    return workflowDefinitionManager.get(id);
  }

  has(id: string): boolean {
    return workflowMetadataManager.has(id);
  }

  getAllIds(): string[] {
    return workflowMetadataManager.getAllIds();
  }

  getAll(): Map<string, WorkflowMetadata> {
    return workflowMetadataManager.getAll();
  }

  getAllAsArray(): WorkflowMetadata[] {
    return Array.from(this.getAll().values());
  }

  getStats(): {
    total: number;
    byNodeType: Record<string, number>;
    withInputSchema: number;
    withOutputSchema: number;
  } {
    const byNodeType: Record<string, number> = {};
    let withInputSchema = 0;
    let withOutputSchema = 0;

    for (const metadata of this.getAll().values()) {
      for (const nodeType of metadata.nodeTypes) {
        byNodeType[nodeType] = (byNodeType[nodeType] ?? 0) + 1;
      }
      if (metadata.hasInputSchema) withInputSchema++;
      if (metadata.hasOutputSchema) withOutputSchema++;
    }

    return {
      total: this.getAll().size,
      byNodeType,
      withInputSchema,
      withOutputSchema,
    };
  }

  unregister(id: string): boolean {
    const metaDeleted = workflowMetadataManager.delete(id);
    const defDeleted = workflowDefinitionManager.delete(id);
    return metaDeleted || defDeleted;
  }

  clear(): void {
    workflowMetadataManager.clear();
    workflowDefinitionManager.clear();
  }

  clearAll(): void {
    workflowMetadataManager.clearAll();
    workflowDefinitionManager.clearAll();
  }

  getRegistryStats(): ReturnType<typeof workflowMetadataManager.getStats> {
    return workflowMetadataManager.getStats();
  }
}

export const workflowRegistry = new WorkflowRegistryClass();

export { WorkflowRegistryClass };

export function registerWorkflow(workflow: Workflow | WorkflowDefinition): void {
  workflowRegistry.register(workflow);
}

export function getWorkflow(id: string): WorkflowMetadata | undefined {
  return workflowRegistry.get(id);
}

export function getAllWorkflowIds(): string[] {
  return workflowRegistry.getAllIds();
}
