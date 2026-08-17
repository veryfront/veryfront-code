import type { ScheduleIntegrationRequirementConfig } from "#veryfront/schedule/types.ts";
import { zodToJsonSchema } from "#veryfront/tool/schema";
import { agentLogger as logger } from "#veryfront/utils";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import type { Workflow, WorkflowDefinition, WorkflowNode } from "./types.ts";
import {
  captureWorkflowDefinition,
  captureWorkflowNodes,
  captureWorkflowStaticValue,
} from "./executor/workflow-definition-snapshot.ts";

export interface NodeInfo {
  id: string;
  type: string;
  /** Agent ID if this is a step using an agent */
  agent?: string;
  /** Tool ID if this is a step using a tool */
  tool?: string;
  /** Node IDs this node depends on */
  dependsOn?: readonly string[];
  /** Child node IDs (for parallel/branch nodes) */
  children?: readonly string[];
  /** Description from wait/approval nodes */
  message?: string;
}

export interface WorkflowMetadata {
  id: string;
  description?: string;
  version?: string;
  timeout?: string | number;
  /** Explicit integration scopes and resources required by scheduled runs. */
  integrationRequirements?: readonly ScheduleIntegrationRequirementConfig[];
  /** True when steps are defined dynamically via a function */
  dynamicSteps?: boolean;
  /** True when dynamic step introspection is disabled */
  introspectionSkipped?: boolean;
  /** Error message if introspection failed */
  introspectionError?: string;
  nodeCount: number;
  nodeTypes: readonly string[];
  /** Detailed node information */
  nodes: readonly NodeInfo[];
  /** Agent IDs referenced by this workflow */
  agentRefs: readonly string[];
  /** Tool IDs referenced by this workflow */
  toolRefs: readonly string[];
  hasInputSchema: boolean;
  hasOutputSchema: boolean;
  /** JSON Schema representation of input schema (if available) */
  inputSchemaJson?: Record<string, unknown>;
  /** Conversion failure when an input schema cannot be represented as JSON Schema. */
  inputSchemaError?: string;
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
  if (
    (typeof workflow === "object" || typeof workflow === "function") &&
    workflow !== null && !isProxyWithoutHooks(workflow)
  ) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(workflow, "definition");
      if (descriptor && "value" in descriptor) {
        return descriptor.value as WorkflowDefinition;
      }
    } catch {
      // Canonical capture below produces the public validation error without
      // evaluating getters, coercion hooks, or inherited properties.
    }
  }

  return workflow as WorkflowDefinition;
}

function getCollaboratorId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null || isProxyWithoutHooks(value)) {
    return undefined;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, "id");
    return descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
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

        workflowNodes = captureWorkflowNodes(
          definition.steps(
            {
              input: dummyInput,
              context: dummyContext,
            } as Parameters<typeof definition.steps>[0],
          ),
          `Workflow "${definition.id}" introspection`,
        );
      } catch (error) {
        introspectionError = snapshotThrowableDiagnostic(error);
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
        dependsOn: node.dependsOn === undefined ? undefined : Object.freeze([...node.dependsOn]),
      };

      const config = node.config as {
        agent?: unknown;
        tool?: unknown;
        message?: unknown;
        nodes?: unknown;
        then?: unknown;
        else?: unknown;
      };

      if (type === "step") {
        const agentValue = config.agent;
        const agentRef = getCollaboratorId(agentValue);

        if (agentRef) {
          nodeInfo.agent = agentRef;
          agentRefs.add(agentRef);
        }

        const toolValue = config.tool;
        const toolRef = getCollaboratorId(toolValue);

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

      if (children.length) nodeInfo.children = Object.freeze(children);

      nodeInfoList.push(Object.freeze(nodeInfo));
    }

    return ids;
  }

  extractNodeInfo(workflowNodes);

  let inputSchemaJson: Record<string, unknown> | undefined;
  let inputSchemaError: string | undefined;
  if (definition.inputSchema) {
    try {
      inputSchemaJson = captureWorkflowStaticValue(
        zodToJsonSchema(definition.inputSchema) as Record<string, unknown>,
        `Workflow "${definition.id}" input schema metadata`,
      );
    } catch (error) {
      inputSchemaError = snapshotThrowableDiagnostic(error);
      logger.warn(
        `[WorkflowRegistry] Failed to convert input schema for "${definition.id}": ${inputSchemaError}`,
      );
    }
  }

  return Object.freeze({
    id: definition.id,
    description: definition.description,
    version: definition.version,
    timeout: definition.timeout,
    integrationRequirements: definition.integrationRequirements,
    dynamicSteps,
    introspectionSkipped,
    introspectionError,
    nodeCount: workflowNodes.length,
    nodeTypes: Object.freeze(Array.from(nodeTypes)),
    nodes: Object.freeze(nodeInfoList),
    agentRefs: Object.freeze(Array.from(agentRefs)),
    toolRefs: Object.freeze(Array.from(toolRefs)),
    hasInputSchema: !!definition.inputSchema,
    hasOutputSchema: !!definition.outputSchema,
    inputSchemaJson,
    inputSchemaError,
    registeredAt: new Date().toISOString(),
  });
}

const workflowMetadataManager = new ProjectScopedRegistryManager<WorkflowMetadata>("workflow");
const workflowDefinitionManager = new ProjectScopedRegistryManager<WorkflowDefinition>(
  "workflow-definition",
);

const workflowMetadataRegistry = new ScopedRegistryFacade(workflowMetadataManager);
const workflowDefinitionRegistry = new ScopedRegistryFacade(workflowDefinitionManager);

class WorkflowRegistryInternal {
  private storeWorkflow(workflow: Workflow | WorkflowDefinition, shared: boolean): void {
    const definition = captureWorkflowDefinition(getWorkflowDefinition(workflow), {
      allowEmptySteps: true,
    });
    const metadata = extractMetadata(definition);

    if (shared) {
      workflowMetadataRegistry.registerShared(definition.id, metadata);
      workflowDefinitionRegistry.registerShared(definition.id, definition);
      return;
    }

    workflowMetadataRegistry.register(definition.id, metadata);
    workflowDefinitionRegistry.register(definition.id, definition);
  }

  register(workflow: Workflow | WorkflowDefinition): void {
    this.storeWorkflow(workflow, false);
  }

  registerShared(workflow: Workflow | WorkflowDefinition): void {
    this.storeWorkflow(workflow, true);
  }

  get(id: string): WorkflowMetadata | undefined {
    return workflowMetadataRegistry.get(id);
  }

  getDefinition(id: string): WorkflowDefinition | undefined {
    return workflowDefinitionRegistry.get(id);
  }

  has(id: string): boolean {
    return workflowMetadataRegistry.has(id);
  }

  getAllIds(): string[] {
    return workflowMetadataRegistry.getAllIds();
  }

  getAll(): Map<string, WorkflowMetadata> {
    return workflowMetadataRegistry.getAll();
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
    const metaDeleted = workflowMetadataRegistry.delete(id);
    const defDeleted = workflowDefinitionRegistry.delete(id);
    return metaDeleted || defDeleted;
  }

  clear(): void {
    workflowMetadataRegistry.clear();
    workflowDefinitionRegistry.clear();
  }

  clearAll(): void {
    workflowMetadataRegistry.clearAll();
    workflowDefinitionRegistry.clearAll();
  }

  getRegistryStats(): ReturnType<typeof workflowMetadataRegistry.getStats> {
    return workflowMetadataRegistry.getStats();
  }
}

/** Framework-only workflow registry with process-wide maintenance capabilities. */
export const workflowRegistryInternal = new WorkflowRegistryInternal();

/** Project-scoped workflow registry API safe for application code. */
export class WorkflowRegistryClass {
  readonly #registry: WorkflowRegistryInternal;

  constructor(registry: WorkflowRegistryInternal = workflowRegistryInternal) {
    this.#registry = registry;
  }

  register(workflow: Workflow | WorkflowDefinition): void {
    this.#registry.register(workflow);
  }

  get(id: string): WorkflowMetadata | undefined {
    return this.#registry.get(id);
  }

  getDefinition(id: string): WorkflowDefinition | undefined {
    return this.#registry.getDefinition(id);
  }

  has(id: string): boolean {
    return this.#registry.has(id);
  }

  getAllIds(): string[] {
    return this.#registry.getAllIds();
  }

  getAll(): Map<string, WorkflowMetadata> {
    return this.#registry.getAll();
  }

  getAllAsArray(): WorkflowMetadata[] {
    return this.#registry.getAllAsArray();
  }

  getStats(): ReturnType<WorkflowRegistryInternal["getStats"]> {
    return this.#registry.getStats();
  }

  unregister(id: string): boolean {
    return this.#registry.unregister(id);
  }

  clear(): void {
    this.#registry.clear();
  }
}

export const workflowRegistry = new WorkflowRegistryClass();

export function registerWorkflow(workflow: Workflow | WorkflowDefinition): void {
  workflowRegistry.register(workflow);
}

export function getWorkflow(id: string): WorkflowMetadata | undefined {
  return workflowRegistry.get(id);
}

export function getAllWorkflowIds(): string[] {
  return workflowRegistry.getAllIds();
}
