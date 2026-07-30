import { INVALID_ARGUMENT } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS,
  MAX_WORKFLOW_DEFINITION_NODES,
} from "../../limits.ts";
import type {
  MapNodeConfig,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeConfig,
} from "../../types.ts";

interface IdentityState {
  ids: Set<string>;
  reservations: IdentityReservation[];
}

interface IdentityReservation {
  readonly ownerId: string;
  readonly description: string;
  matches(id: string): boolean;
}

function isWorkflowDefinition(processor: unknown): processor is WorkflowDefinition {
  if (typeof processor !== "object" || processor === null || isProxyWithoutHooks(processor)) {
    return false;
  }
  return Object.getOwnPropertyDescriptor(processor, "steps") !== undefined;
}

/** Canonicalize every statically available node identity and reject flattened collisions. */
export function canonicalizeWorkflowNodes(
  nodes: WorkflowNode[],
  prefix = "",
): WorkflowNode[] {
  return rebaseWorkflowNodes("", prefix, nodes, { ids: new Set(), reservations: [] });
}

/** Build map item roots while rebasing the complete processor subtree to each persistent ID. */
export function createMapChildNodes(
  node: WorkflowNode,
  config: MapNodeConfig,
  items: unknown[],
): WorkflowNode[] {
  if (items.length > MAX_WORKFLOW_DEFINITION_NODES) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Map node "${node.id}" cannot expand more than ${MAX_WORKFLOW_DEFINITION_NODES} persistent node identities`,
    });
  }
  return items.map((item, index) => {
    const childId = `${node.id}_${index}`;
    assertIdentity(childId);

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
    const rebased = id.startsWith(newPrefix)
      ? id
      : id.startsWith(oldPrefix)
      ? `${newPrefix}${id.slice(oldPrefix.length)}`
      : `${newPrefix}${id}`;
    assertIdentity(rebased);
    return rebased;
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
      if (typeof config.steps === "function") {
        reserveSlashNamespace(newId, state, "dynamic loop descendants");
      }
      return {
        ...config,
        steps: typeof config.steps === "function"
          ? config.steps
          : rebaseWorkflowNodes(`${oldId}/`, `${newId}/`, config.steps, state),
      };
    case "subWorkflow":
      if (
        typeof config.workflow !== "string" &&
        typeof config.workflow.steps === "function"
      ) {
        reserveSlashNamespace(newId, state, "dynamic sub-workflow descendants");
      }
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
      } else if (state) {
        reserveMapNamespace(newId, state);
      }

      return rebasedConfig;
    }
    default:
      return config;
  }
}

function registerIdentity(id: string, state: IdentityState | undefined): void {
  assertIdentity(id);
  if (!state) return;
  for (const reservation of state.reservations) {
    if (reservation.matches(id)) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Workflow DAG node ID "${id}" collides with ${reservation.description} reserved by "${reservation.ownerId}"`,
      });
    }
  }
  if (state.ids.has(id)) {
    throw INVALID_ARGUMENT.create({
      detail: `Workflow DAG contains duplicate node ID "${id}" in its flattened identity tree`,
    });
  }
  state.ids.add(id);
  if (state.ids.size > MAX_WORKFLOW_DEFINITION_NODES) {
    throw INVALID_ARGUMENT.create({
      detail:
        `Workflow DAG cannot expand beyond ${MAX_WORKFLOW_DEFINITION_NODES} persistent node identities`,
    });
  }
}

function assertIdentity(id: string): void {
  if (id.length <= MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS) return;
  throw INVALID_ARGUMENT.create({
    detail:
      `Derived workflow node ID cannot exceed ${MAX_WORKFLOW_DEFINITION_ID_CODE_UNITS} code units`,
  });
}

function addReservation(
  reservation: IdentityReservation,
  state: IdentityState | undefined,
): void {
  if (!state) return;
  for (const id of state.ids) {
    if (reservation.matches(id)) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Workflow DAG node ID "${id}" collides with ${reservation.description} reserved by "${reservation.ownerId}"`,
      });
    }
  }
  state.reservations.push(reservation);
}

function reserveSlashNamespace(
  ownerId: string,
  state: IdentityState | undefined,
  description: string,
): void {
  const prefix = `${ownerId}/`;
  addReservation({
    ownerId,
    description,
    matches: (id) => id.startsWith(prefix),
  }, state);
}

function reserveMapNamespace(ownerId: string, state: IdentityState | undefined): void {
  const prefix = `${ownerId}_`;
  addReservation({
    ownerId,
    description: "dynamic map item identities",
    matches: (id) => {
      if (!id.startsWith(prefix)) return false;
      const suffix = id.slice(prefix.length);
      const separator = suffix.indexOf("/");
      const index = separator === -1 ? suffix : suffix.slice(0, separator);
      if (index === "0") return true;
      if (index.length === 0 || index.charCodeAt(0) === 48) return false;
      for (let offset = 0; offset < index.length; offset++) {
        const code = index.charCodeAt(offset);
        if (code < 48 || code > 57) return false;
      }
      return true;
    },
  }, state);
}
