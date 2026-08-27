import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { WorkflowDefinition, WorkflowNode, WorkflowNodeConfig } from "../types.ts";

const numberIsSafeInteger = Number.isSafeInteger;
const reflectApply = Reflect.apply;
const stringTrim = String.prototype.trim;

export function isCanonicalNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    reflectApply(stringTrim, value, []) === value;
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return numberIsSafeInteger(value) && (value as number) > 0;
}

/** Validate that a node ID is a canonical non-empty string. */
export function validateNodeId(id: string): void {
  if (!isCanonicalNonEmptyString(id)) {
    throw INVALID_ARGUMENT.create({ detail: "Node ID must be a canonical non-empty string" });
  }
}

/** Reject identifiers that WHATWG URLs normalize as path navigation. */
export function validateWorkflowPathSegment(id: string, label: string): void {
  if (id === "." || id === "..") {
    throw INVALID_ARGUMENT.create({ detail: `${label} must not be a dot-only URL path segment` });
  }
}

/** Namespace child IDs and every dependency reference into the same graph. */
export function namespaceWorkflowNodes(
  prefix: string,
  nodes: WorkflowNode[],
): WorkflowNode[] {
  return rebaseWorkflowNodes("", prefix, nodes);
}

/** Restore child IDs from one known namespace for an in-flight legacy graph. */
export function removeWorkflowNodeNamespace(
  prefix: string,
  nodes: WorkflowNode[],
): WorkflowNode[] {
  return rebaseWorkflowNodes(prefix, "", nodes);
}

/** Collect statically visible node IDs from a graph and its composite descendants. */
export function collectWorkflowNodeIds(nodes: WorkflowNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (node: WorkflowNode): void => {
    ids.add(node.id);
    switch (node.config.type) {
      case "parallel":
        node.config.nodes.forEach(visit);
        break;
      case "branch":
        node.config.then.forEach(visit);
        node.config.else?.forEach(visit);
        break;
      case "loop":
        if (Array.isArray(node.config.steps)) node.config.steps.forEach(visit);
        break;
      case "subWorkflow":
        if (
          typeof node.config.workflow !== "string" &&
          Array.isArray(node.config.workflow.steps)
        ) {
          node.config.workflow.steps.forEach(visit);
        }
        break;
    }
  };
  nodes.forEach(visit);
  return ids;
}

function rebaseWorkflowNodes(
  oldPrefix: string,
  newPrefix: string,
  nodes: WorkflowNode[],
): WorkflowNode[] {
  const rebaseId = (id: string): string => {
    if (newPrefix && id.startsWith(newPrefix)) return id;
    if (oldPrefix && id.startsWith(oldPrefix)) {
      return `${newPrefix}${id.slice(oldPrefix.length)}`;
    }
    return `${newPrefix}${id}`;
  };

  return nodes.map((node) => {
    const oldId = node.id;
    const newId = rebaseId(oldId);

    return {
      ...node,
      id: newId,
      config: rebaseCompositeDescendants(node.config, oldId, newId, oldPrefix, newPrefix),
      ...(node.dependsOn === undefined
        ? {}
        : { dependsOn: node.dependsOn.map((dependency) => rebaseId(dependency)) }),
    };
  });
}

export function rebaseCompositeDescendants(
  config: WorkflowNodeConfig,
  oldId: string,
  newId: string,
  oldPrefix = `${oldId}/`,
  newPrefix = `${newId}/`,
): WorkflowNodeConfig {
  switch (config.type) {
    case "parallel":
      return {
        ...config,
        nodes: rebaseWorkflowNodes(`${oldId}/`, `${newId}/`, config.nodes),
      };
    case "branch":
      return {
        ...config,
        then: rebaseWorkflowNodes(
          `${oldId}/then/`,
          `${newId}/then/`,
          config.then,
        ),
        else: config.else === undefined ? undefined : rebaseWorkflowNodes(
          `${oldId}/else/`,
          `${newId}/else/`,
          config.else,
        ),
      };
    case "loop":
      return Array.isArray(config.steps)
        ? {
          ...config,
          steps: rebaseWorkflowNodes(`${oldId}/`, `${newId}/`, config.steps),
        }
        : config;
    case "subWorkflow":
      return typeof config.workflow === "string" ? config : {
        ...config,
        workflow: rebaseWorkflowDefinition(oldPrefix, newPrefix, config.workflow),
      };
    default:
      return config;
  }
}

export function namespaceWorkflowDefinition(
  prefix: string,
  definition: WorkflowDefinition,
): WorkflowDefinition {
  return rebaseWorkflowDefinition("", prefix, definition);
}

function rebaseWorkflowDefinition(
  oldPrefix: string,
  newPrefix: string,
  definition: WorkflowDefinition,
): WorkflowDefinition {
  const steps = definition.steps;
  return {
    ...definition,
    steps: Array.isArray(steps)
      ? rebaseWorkflowNodes(oldPrefix, newPrefix, steps)
      : (context) => rebaseWorkflowNodes(oldPrefix, newPrefix, steps(context)),
  };
}
