import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { WorkflowNode, WorkflowNodeConfig } from "../types.ts";

/** Validate that a node ID is a non-empty string */
export function validateNodeId(id: string): void {
  if (!id.trim()) {
    throw INVALID_ARGUMENT.create({ detail: "Node ID must be a non-empty string" });
  }
}

/** Namespace child IDs and every dependency reference into the same graph. */
export function namespaceWorkflowNodes(
  prefix: string,
  nodes: WorkflowNode[],
): WorkflowNode[] {
  return rebaseWorkflowNodes("", prefix, nodes);
}

function rebaseWorkflowNodes(
  oldPrefix: string,
  newPrefix: string,
  nodes: WorkflowNode[],
): WorkflowNode[] {
  const rebaseId = (id: string): string => {
    if (id.startsWith(newPrefix)) return id;
    if (id.startsWith(oldPrefix)) return `${newPrefix}${id.slice(oldPrefix.length)}`;
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
    default:
      return config;
  }
}
