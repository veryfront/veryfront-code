import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { WorkflowNode, WorkflowNodeConfig } from "../types.ts";

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
      config: rebaseCompositeDescendants(node.config, oldId, newId),
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
    default:
      return config;
  }
}
