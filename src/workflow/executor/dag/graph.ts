/**
 * DAG Graph Utilities
 *
 * Graph building, validation, and traversal utilities for DAG execution.
 *
 * @module ai/workflow/executor/dag/graph
 */

import type { NodeState, WorkflowNode } from "../../types.ts";

/**
 * Graph representation for DAG execution
 */
export interface DAGGraph {
  /** Adjacency list (node -> dependents) */
  adjList: Map<string, string[]>;
  /** In-degree for each node (number of dependencies) */
  inDegree: Map<string, number>;
  /** Map from node ID to node object */
  nodeMap: Map<string, WorkflowNode>;
}

/**
 * Check if any node explicitly depends on the given node
 */
export function hasAnyDependents(nodes: WorkflowNode[], nodeId: string): boolean {
  return nodes.some((n) => n.dependsOn?.includes(nodeId));
}

/**
 * Build dependency graph from nodes
 */
export function buildGraph(nodes: WorkflowNode[]): DAGGraph {
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const nodeMap = new Map<string, WorkflowNode>();

  // Initialize
  for (const node of nodes) {
    adjList.set(node.id, []);
    inDegree.set(node.id, 0);
    nodeMap.set(node.id, node);
  }

  // Build edges from dependencies
  for (const node of nodes) {
    for (const dep of node.dependsOn || []) {
      if (!adjList.has(dep)) {
        throw new Error(
          `Node "${node.id}" depends on unknown node "${dep}"`,
        );
      }
      adjList.get(dep)!.push(node.id);
      inDegree.set(node.id, inDegree.get(node.id)! + 1);
    }
  }

  // Also handle implicit sequential dependencies (nodes without explicit deps)
  // If no dependencies specified (undefined), assume sequential order
  // If dependsOn is explicitly set (even to []), respect that choice
  let prevNodeId: string | null = null;
  for (const node of nodes) {
    // Only add implicit deps if:
    // 1. dependsOn is undefined (not explicitly set)
    // 2. No other node explicitly depends on this node
    // 3. This node has no incoming edges yet
    if (node.dependsOn === undefined && prevNodeId) {
      const isDependent = hasAnyDependents(nodes, node.id);
      const currentInDegree = inDegree.get(node.id) ?? 0;

      if (!isDependent && currentInDegree === 0) {
        // This node is "floating" - no explicit deps and nothing depends on it
        // Create implicit dependency on previous node
        adjList.get(prevNodeId)!.push(node.id);
        inDegree.set(node.id, inDegree.get(node.id)! + 1);
      }
    }
    prevNodeId = node.id;
  }

  return { adjList, inDegree, nodeMap };
}

/**
 * Get nodes that are ready to execute
 */
export function getReadyNodes(
  inDegree: Map<string, number>,
  nodeStates: Record<string, NodeState>,
): string[] {
  const ready: string[] = [];

  for (const [nodeId, degree] of inDegree) {
    // Node is ready if:
    // 1. No remaining dependencies (in-degree = 0)
    // 2. Not already completed/running/failed
    const state = nodeStates[nodeId];
    const isReady = degree === 0 &&
      (!state || state.status === "pending");

    if (isReady) {
      ready.push(nodeId);
    }
  }

  return ready;
}

/**
 * Check if DAG has cycles (using DFS)
 */
export function hasCycle(
  nodes: WorkflowNode[],
  adjList: Map<string, string[]>,
): boolean {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const dfs = (nodeId: string): boolean => {
    visited.add(nodeId);
    recursionStack.add(nodeId);

    for (const neighbor of adjList.get(nodeId) || []) {
      if (!visited.has(neighbor)) {
        if (dfs(neighbor)) return true;
      } else if (recursionStack.has(neighbor)) {
        return true;
      }
    }

    recursionStack.delete(nodeId);
    return false;
  };

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) return true;
    }
  }

  return false;
}

/**
 * Update in-degrees for already completed nodes
 * Used when resuming from checkpoints
 */
export function updateInDegreesForCompletedNodes(
  nodeStates: Record<string, NodeState>,
  adjList: Map<string, string[]>,
  inDegree: Map<string, number>,
): void {
  for (const [nodeId, state] of Object.entries(nodeStates)) {
    if (state.status === "completed" || state.status === "skipped") {
      // Decrement in-degree for all dependents of this completed node
      for (const dependent of adjList.get(nodeId) || []) {
        const currentDegree = inDegree.get(dependent) ?? 0;
        if (currentDegree > 0) {
          inDegree.set(dependent, currentDegree - 1);
        }
      }
    }
  }
}
