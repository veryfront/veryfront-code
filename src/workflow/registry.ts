import type { ScheduleIntegrationRequirementConfig } from "#veryfront/schedule/types.ts";
import { zodToJsonSchema } from "#veryfront/tool/schema";
import { agentLogger as logger } from "#veryfront/utils";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { ScopedRegistryFacade } from "#veryfront/registry/scoped-registry-facade.ts";
import { ProjectScopedRegistryManager } from "#veryfront/registry/project-scoped-registry-manager.ts";
import type { StepBuilderContext, Workflow, WorkflowDefinition, WorkflowNode } from "./types.ts";
import {
  captureWorkflowDefinition,
  captureWorkflowNodes,
  captureWorkflowStaticValue,
} from "./executor/workflow-definition-snapshot.ts";

const arrayIsArray = Array.isArray;
const dateToISOString = Date.prototype.toISOString;
const mapForEach = Map.prototype.forEach;
const NativeDate = Date;
const NativeProxy = Proxy;
const NativeSet = Set;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const reflectApply = Reflect.apply;
const setAdd = Set.prototype.add;
const setForEach = Set.prototype.forEach;

function setOwnDataProperty(
  target: NodeInfo | Record<string, number> | unknown[],
  key: PropertyKey,
  value: unknown,
): void {
  objectDefineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function appendArrayValue<T>(values: T[], value: T): void {
  setOwnDataProperty(values, values.length, value);
}

function appendArrayValues<T>(target: T[], values: readonly T[]): void {
  for (let index = 0; index < values.length; index++) {
    appendArrayValue(target, values[index]);
  }
}

function copyArray<T>(values: readonly T[]): T[] {
  const copy: T[] = [];
  appendArrayValues(copy, values);
  return copy;
}

function getOwnDataProperty<T>(value: unknown, key: PropertyKey): T | undefined {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) return undefined;
  const descriptor = objectGetOwnPropertyDescriptor(value, key);
  return descriptor && objectHasOwn(descriptor, "value") ? descriptor.value as T : undefined;
}

function setToArray<T>(values: ReadonlySet<T>): T[] {
  const entries: T[] = [];
  reflectApply(setForEach, values, [(value: T) => appendArrayValue(entries, value)]);
  return entries;
}

/** Metadata for one node in a registered workflow graph. */
export interface NodeInfo {
  id: string;
  type: string;
  /** Agent ID if this is a step using an agent */
  agent?: string;
  /** Tool ID if this is a step using a tool */
  tool?: string;
  /** Node IDs this node depends on */
  dependsOn?: readonly string[];
  /** Child node IDs for composite nodes such as parallel, branch, and static loop nodes. */
  children?: readonly string[];
  /** Description from wait/approval nodes */
  message?: string;
  /** Human-readable purpose declared on the node config. */
  description?: string;
}

/** Public metadata captured for a registered workflow. */
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
  return new NativeProxy(
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
      const descriptor = objectGetOwnPropertyDescriptor(workflow, "definition");
      if (descriptor && objectHasOwn(descriptor, "value")) {
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
    const descriptor = objectGetOwnPropertyDescriptor(value, "id");
    return descriptor && objectHasOwn(descriptor, "value") &&
        typeof descriptor.value === "string"
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
  const id = getOwnDataProperty<string>(definition, "id") as string;
  const steps = getOwnDataProperty<WorkflowDefinition["steps"]>(definition, "steps");

  if (arrayIsArray(steps)) {
    workflowNodes = steps;
  } else if (typeof steps === "function") {
    dynamicSteps = true;

    if (!getOwnDataProperty<boolean>(definition, "introspect")) {
      introspectionSkipped = true;
      logger.debug(
        `[WorkflowRegistry] Skipping dynamic steps introspection for "${id}" (introspect=false)`,
      );
    } else {
      try {
        const dummyInput = createProxy();
        const dummyContext: Record<string, unknown> = { input: createProxy() };

        workflowNodes = captureWorkflowNodes(
          reflectApply(steps, definition, [
            {
              input: dummyInput,
              context: dummyContext,
            } as StepBuilderContext,
          ]),
          `Workflow "${id}" introspection`,
        );
      } catch (error) {
        introspectionError = snapshotThrowableDiagnostic(error);
        logger.warn(
          `[WorkflowRegistry] Failed to introspect steps for "${id}": ${introspectionError}`,
        );
      }
    }
  }

  const nodeTypes = new NativeSet<string>();
  const nodeInfoList: NodeInfo[] = [];
  const agentRefs = new NativeSet<string>();
  const toolRefs = new NativeSet<string>();

  function extractNodeInfo(nodeList: WorkflowNode[]): string[] {
    const ids: string[] = [];

    for (let index = 0; index < nodeList.length; index++) {
      const node = nodeList[index]!;
      const config = getOwnDataProperty<WorkflowNode["config"]>(node, "config") as {
        type: string;
        agent?: unknown;
        tool?: unknown;
        message?: unknown;
        description?: unknown;
        nodes?: unknown;
        then?: unknown;
        else?: unknown;
        steps?: unknown;
      };
      const type = getOwnDataProperty<string>(config, "type") as string;
      const nodeId = getOwnDataProperty<string>(node, "id") as string;
      reflectApply(setAdd, nodeTypes, [type]);
      appendArrayValue(ids, nodeId);

      const dependencies = getOwnDataProperty<readonly string[]>(node, "dependsOn");

      const nodeInfo: NodeInfo = {
        id: nodeId,
        type,
        dependsOn: dependencies === undefined ? undefined : objectFreeze(copyArray(dependencies)),
      };

      const description = getOwnDataProperty<unknown>(config, "description");
      if (typeof description === "string") {
        setOwnDataProperty(nodeInfo, "description", description);
      }

      if (type === "step") {
        const agentValue = getOwnDataProperty<unknown>(config, "agent");
        const agentRef = getCollaboratorId(agentValue);

        if (agentRef) {
          setOwnDataProperty(nodeInfo, "agent", agentRef);
          reflectApply(setAdd, agentRefs, [agentRef]);
        }

        const toolValue = getOwnDataProperty<unknown>(config, "tool");
        const toolRef = getCollaboratorId(toolValue);

        if (toolRef) {
          setOwnDataProperty(nodeInfo, "tool", toolRef);
          reflectApply(setAdd, toolRefs, [toolRef]);
        }
      }

      if (type === "wait" && objectHasOwn(config, "message")) {
        setOwnDataProperty(nodeInfo, "message", getOwnDataProperty(config, "message"));
      }

      const children: string[] = [];

      const nodes = getOwnDataProperty<unknown>(config, "nodes");
      if (arrayIsArray(nodes)) {
        appendArrayValues(children, extractNodeInfo(nodes as WorkflowNode[]));
      }
      const thenNodes = getOwnDataProperty<unknown>(config, "then");
      if (arrayIsArray(thenNodes)) {
        appendArrayValues(children, extractNodeInfo(thenNodes as WorkflowNode[]));
      }
      const elseNodes = getOwnDataProperty<unknown>(config, "else");
      if (arrayIsArray(elseNodes)) {
        appendArrayValues(children, extractNodeInfo(elseNodes as WorkflowNode[]));
      }
      const loopSteps = getOwnDataProperty<unknown>(config, "steps");
      if (arrayIsArray(loopSteps)) {
        appendArrayValues(children, extractNodeInfo(loopSteps as WorkflowNode[]));
      }

      if (children.length) {
        setOwnDataProperty(nodeInfo, "children", objectFreeze(children));
      }

      appendArrayValue(nodeInfoList, objectFreeze(nodeInfo));
    }

    return ids;
  }

  extractNodeInfo(workflowNodes);

  let inputSchemaJson: Record<string, unknown> | undefined;
  let inputSchemaError: string | undefined;
  const inputSchema = getOwnDataProperty<WorkflowDefinition["inputSchema"]>(
    definition,
    "inputSchema",
  );
  const outputSchema = getOwnDataProperty<WorkflowDefinition["outputSchema"]>(
    definition,
    "outputSchema",
  );
  if (inputSchema) {
    try {
      inputSchemaJson = captureWorkflowStaticValue(
        zodToJsonSchema(inputSchema) as Record<string, unknown>,
        `Workflow "${id}" input schema metadata`,
      );
    } catch (error) {
      inputSchemaError = snapshotThrowableDiagnostic(error);
      logger.warn(
        `[WorkflowRegistry] Failed to convert input schema for "${id}": ${inputSchemaError}`,
      );
    }
  }

  return objectFreeze({
    id,
    description: getOwnDataProperty<WorkflowMetadata["description"]>(definition, "description"),
    version: getOwnDataProperty<WorkflowMetadata["version"]>(definition, "version"),
    timeout: getOwnDataProperty<WorkflowMetadata["timeout"]>(definition, "timeout"),
    integrationRequirements: getOwnDataProperty<WorkflowMetadata["integrationRequirements"]>(
      definition,
      "integrationRequirements",
    ),
    dynamicSteps,
    introspectionSkipped,
    introspectionError,
    nodeCount: workflowNodes.length,
    nodeTypes: objectFreeze(setToArray(nodeTypes)),
    nodes: objectFreeze(nodeInfoList),
    agentRefs: objectFreeze(setToArray(agentRefs)),
    toolRefs: objectFreeze(setToArray(toolRefs)),
    hasInputSchema: !!inputSchema,
    hasOutputSchema: !!outputSchema,
    inputSchemaJson,
    inputSchemaError,
    registeredAt: reflectApply(dateToISOString, new NativeDate(), []),
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
    const metadata: WorkflowMetadata[] = [];
    reflectApply(mapForEach, this.getAll(), [
      (value: WorkflowMetadata) => appendArrayValue(metadata, value),
    ]);
    return metadata;
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

    const all = this.getAllAsArray();
    for (let index = 0; index < all.length; index++) {
      const metadata = all[index]!;
      for (let nodeIndex = 0; nodeIndex < metadata.nodeTypes.length; nodeIndex++) {
        const nodeType = metadata.nodeTypes[nodeIndex]!;
        const existing = getOwnDataProperty<number>(byNodeType, nodeType) ?? 0;
        setOwnDataProperty(byNodeType, nodeType, existing + 1);
      }
      if (metadata.hasInputSchema) withInputSchema++;
      if (metadata.hasOutputSchema) withOutputSchema++;
    }

    return {
      total: all.length,
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

/** Project-scoped registry for workflow metadata and definitions. */
export const workflowRegistry = new WorkflowRegistryClass();

/** Register a workflow definition in the current project scope. */
export function registerWorkflow(workflow: Workflow | WorkflowDefinition): void {
  workflowRegistry.register(workflow);
}

/** Get metadata for a registered workflow by ID. */
export function getWorkflow(id: string): WorkflowMetadata | undefined {
  return workflowRegistry.get(id);
}

/** List registered workflow IDs for the current project scope. */
export function getAllWorkflowIds(): string[] {
  return workflowRegistry.getAllIds();
}
