import { INVALID_ARGUMENT } from "#veryfront/errors";
import type {
  MapNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeConfig,
} from "../../types.ts";

interface IdentityState {
  ids: Set<string>;
}

function isWorkflowDefinition(processor: unknown): processor is WorkflowDefinition {
  return typeof processor === "object" && processor !== null && "steps" in processor;
}

/** Canonicalize every statically available node identity and reject flattened collisions. */
export function canonicalizeWorkflowNodes(
  nodes: WorkflowNode[],
  prefix = "",
): WorkflowNode[] {
  return rebaseWorkflowNodes("", prefix, nodes, { ids: new Set() });
}

/** Build map item roots while rebasing the complete processor subtree to each persistent ID. */
export function createMapChildNodes(
  node: WorkflowNode,
  config: MapNodeConfig,
  items: unknown[],
): WorkflowNode[] {
  return items.map((item, index) => {
    const childId = `${node.id}_${index}`;

    if (isWorkflowDefinition(config.processor)) {
      return {
        id: childId,
        config: {
          type: "subWorkflow",
          workflow: config.processor,
          input: item,
          retry: config.retry,
          checkpoint: false,
        },
      };
    }

    const rebasedProcessor = rebaseWorkflowNode(config.processor, childId);
    const processorConfig: WorkflowNodeConfig = { ...rebasedProcessor.config };

    if (processorConfig.type === "step") {
      processorConfig.input = item as Record<string, unknown>;
    }

    return { id: childId, config: processorConfig };
  });
}

function rebaseWorkflowNode(node: WorkflowNode, newId: string): WorkflowNode {
  return {
    id: newId,
    config: rebaseCompositeDescendants(node.config, node.id, newId),
  };
}

function rebaseWorkflowNodes(
  oldPrefix: string,
  newPrefix: string,
  nodes: WorkflowNode[],
  state?: IdentityState,
): WorkflowNode[] {
  const rebaseId = (id: string): string => {
    if (id.startsWith(newPrefix)) return id;
    if (id.startsWith(oldPrefix)) return `${newPrefix}${id.slice(oldPrefix.length)}`;
    return `${newPrefix}${id}`;
  };

  return nodes.map((node) => {
    const oldId = node.id;
    const newId = rebaseId(oldId);
    registerIdentity(newId, state);

    return {
      ...node,
      id: newId,
      config: rebaseCompositeDescendants(node.config, oldId, newId, state),
      ...(node.dependsOn === undefined
        ? {}
        : { dependsOn: node.dependsOn.map((dependency) => rebaseId(dependency)) }),
    };
  });
}

function rebaseCompositeDescendants(
  config: WorkflowNodeConfig,
  oldId: string,
  newId: string,
  state?: IdentityState,
): WorkflowNodeConfig {
  switch (config.type) {
    case "parallel":
      return {
        ...config,
        nodes: rebaseWorkflowNodes(`${oldId}/`, `${newId}/`, config.nodes, state),
      };
    case "branch":
      return {
        ...config,
        then: rebaseWorkflowNodes(
          `${oldId}/then/`,
          `${newId}/then/`,
          config.then,
          state,
        ),
        else: config.else === undefined ? undefined : rebaseWorkflowNodes(
          `${oldId}/else/`,
          `${newId}/else/`,
          config.else,
          state,
        ),
      };
    case "loop":
      return {
        ...config,
        steps: typeof config.steps === "function"
          ? config.steps
          : rebaseWorkflowNodes(`${oldId}/`, `${newId}/`, config.steps, state),
      };
    case "subWorkflow":
      return {
        ...config,
        workflow: typeof config.workflow === "string" || typeof config.workflow.steps === "function"
          ? config.workflow
          : {
            ...config.workflow,
            steps: rebaseWorkflowNodes(
              `${oldId}/`,
              `${newId}/`,
              config.workflow.steps,
              state,
            ),
          },
      };
    case "map": {
      const processor = isWorkflowDefinition(config.processor)
        ? config.processor
        : rebaseWorkflowNode(config.processor, config.processor.id);
      const rebasedConfig: MapNodeConfig = { ...config, processor };

      if (state && Array.isArray(rebasedConfig.items)) {
        const itemNodes = createMapChildNodes(
          { id: newId, config: rebasedConfig },
          rebasedConfig,
          rebasedConfig.items,
        );
        rebaseWorkflowNodes("", "", itemNodes, state);
      }

      return rebasedConfig;
    }
    default:
      return config;
  }
}

function registerIdentity(id: string, state: IdentityState | undefined): void {
  if (!state) return;
  if (state.ids.has(id)) {
    throw INVALID_ARGUMENT.create({
      detail: `Workflow DAG contains duplicate node ID "${id}" in its flattened identity tree`,
    });
  }
  state.ids.add(id);
}
