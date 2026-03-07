import type { NodeState, WorkflowNode } from "../../types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";

interface DAGGraph {
  adjList: Map<string, string[]>;
  inDegree: Map<string, number>;
  nodeMap: Map<string, WorkflowNode>;
}

function hasAnyDependents(nodes: WorkflowNode[], nodeId: string): boolean {
  return nodes.some((n) => n.dependsOn?.includes(nodeId));
}

export function buildGraph(nodes: WorkflowNode[]): DAGGraph {
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const nodeMap = new Map<string, WorkflowNode>();

  for (const node of nodes) {
    adjList.set(node.id, []);
    inDegree.set(node.id, 0);
    nodeMap.set(node.id, node);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn ?? []) {
      const dependents = adjList.get(dep);
      if (!dependents) {
        throw INVALID_ARGUMENT.create({
          detail: `Node "${node.id}" depends on unknown node "${dep}"`,
        });
      }
      dependents.push(node.id);
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
    }
  }

  // Also handle implicit sequential dependencies (nodes without explicit deps)
  // If no dependencies specified (undefined), assume sequential order
  // If dependsOn is explicitly set (even to []), respect that choice
  let prevNodeId: string | null = null;

  for (const node of nodes) {
    if (!prevNodeId) {
      prevNodeId = node.id;
      continue;
    }

    if (node.dependsOn !== undefined) {
      prevNodeId = node.id;
      continue;
    }

    const currentInDegree = inDegree.get(node.id) ?? 0;
    if (currentInDegree !== 0 || hasAnyDependents(nodes, node.id)) {
      prevNodeId = node.id;
      continue;
    }

    adjList.get(prevNodeId)?.push(node.id);
    inDegree.set(node.id, currentInDegree + 1);
    prevNodeId = node.id;
  }

  return { adjList, inDegree, nodeMap };
}

export function getReadyNodes(
  inDegree: Map<string, number>,
  nodeStates: Record<string, NodeState>,
): string[] {
  const ready: string[] = [];

  for (const [nodeId, degree] of inDegree) {
    const state = nodeStates[nodeId];
    if (degree === 0 && (!state || state.status === "pending")) {
      ready.push(nodeId);
    }
  }

  return ready;
}

export function hasCycle(
  nodes: WorkflowNode[],
  adjList: Map<string, string[]>,
): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    for (const neighbor of adjList.get(nodeId) ?? []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
        continue;
      }
      if (recursionStack.has(neighbor)) return true;
    }

    recursionStack.delete(nodeId);
    return false;
  }

  for (const node of nodes) {
    if (!visited.has(node.id) && dfs(node.id)) return true;
  }

  return false;
}

export function updateInDegreesForCompletedNodes(
  nodeStates: Record<string, NodeState>,
  adjList: Map<string, string[]>,
  inDegree: Map<string, number>,
): void {
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    if (state.status !== "completed" && state.status !== "skipped") continue;

    for (const dependent of adjList.get(nodeId) ?? []) {
      const currentDegree = inDegree.get(dependent) ?? 0;
      if (currentDegree > 0) inDegree.set(dependent, currentDegree - 1);
    }
  }
}
