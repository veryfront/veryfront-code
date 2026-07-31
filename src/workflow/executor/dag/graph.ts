import type { NodeState, WorkflowNode } from "../../types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { getOwnRecordValue } from "./context-patch.ts";

interface DAGGraph {
  adjList: Map<string, string[]>;
  inDegree: Map<string, number>;
  nodeMap: Map<string, WorkflowNode>;
}

function hasPath(
  adjList: ReadonlyMap<string, readonly string[]>,
  start: string,
  target: string,
): boolean {
  const pending = [start];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const nodeId = pending.pop()!;
    if (nodeId === target) return true;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    for (const dependent of adjList.get(nodeId) ?? []) pending.push(dependent);
  }

  return false;
}

export function buildGraph(nodes: WorkflowNode[]): DAGGraph {
  const adjList = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  const nodeMap = new Map<string, WorkflowNode>();

  for (const node of nodes) {
    if (nodeMap.has(node.id)) {
      throw INVALID_ARGUMENT.create({
        detail: `Workflow DAG contains duplicate node ID "${node.id}"`,
      });
    }

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
    // An omitted dependency list means declaration-order sequencing. Explicit
    // dependencies may intentionally reverse that order, however, so only add
    // the implicit edge when it cannot close a path back to the previous node.
    // This preserves mixed graphs without silently parallelizing ordinary
    // sequential nodes or manufacturing a cycle for a valid reversed edge.
    if (!hasPath(adjList, node.id, prevNodeId)) {
      adjList.get(prevNodeId)?.push(node.id);
      inDegree.set(node.id, currentInDegree + 1);
    }
    prevNodeId = node.id;
  }

  return { adjList, inDegree, nodeMap };
}

export function getReadyNodes(
  inDegree: Map<string, number>,
  nodeStates: Record<string, NodeState>,
  reentrantRunningNodes: ReadonlySet<string> = new Set(),
): string[] {
  const ready: string[] = [];

  for (const [nodeId, degree] of inDegree) {
    const state = getOwnRecordValue(nodeStates, nodeId);
    if (
      degree === 0 &&
      (
        !state || state.status === "pending" || state.status === "failed" ||
        (state.status === "running" && reentrantRunningNodes.has(nodeId))
      )
    ) {
      ready.push(nodeId);
    }
  }

  return ready;
}

export function hasCycle(
  nodes: WorkflowNode[],
  adjList: Map<string, string[]>,
): boolean {
  const inDegree = new Map<string, number>();
  for (const node of nodes) inDegree.set(node.id, 0);
  for (const dependents of adjList.values()) {
    for (const dependent of dependents) {
      inDegree.set(dependent, (inDegree.get(dependent) ?? 0) + 1);
    }
  }

  const ready: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) ready.push(nodeId);
  }

  let visited = 0;
  for (let index = 0; index < ready.length; index++) {
    const nodeId = ready[index]!;
    visited++;
    for (const dependent of adjList.get(nodeId) ?? []) {
      const degree = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, degree);
      if (degree === 0) ready.push(dependent);
    }
  }

  return visited !== nodes.length;
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
