/**
 * Dependency Graph
 *
 * Manages workflow node dependencies and topological ordering.
 * Extracted from DAGExecutor to separate graph concerns from execution.
 */

import type { NodeState, WorkflowNode } from "../../types.ts";

/**
 * Graph structure for workflow dependencies
 */
export interface GraphStructure {
  /** Adjacency list: node -> nodes that depend on it */
  adjList: Map<string, string[]>;
  /** In-degree count for topological ordering */
  inDegree: Map<string, number>;
  /** Node lookup map */
  nodeMap: Map<string, WorkflowNode>;
}

/**
 * Dependency Graph class
 *
 * Builds and manages the dependency graph for workflow nodes.
 * Supports:
 * - Topological ordering
 * - Cycle detection
 * - Finding ready-to-execute nodes
 */
export class DependencyGraph {
  private adjList: Map<string, string[]>;
  private inDegree: Map<string, number>;
  private nodeMap: Map<string, WorkflowNode>;

  constructor(nodes: WorkflowNode[]) {
    const structure = this.buildGraph(nodes);
    this.adjList = structure.adjList;
    this.inDegree = structure.inDegree;
    this.nodeMap = structure.nodeMap;
  }

  /**
   * Get node by ID
   */
  getNode(nodeId: string): WorkflowNode | undefined {
    return this.nodeMap.get(nodeId);
  }

  /**
   * Get all dependents of a node (nodes that depend on this node)
   */
  getDependents(nodeId: string): string[] {
    return this.adjList.get(nodeId) || [];
  }

  /**
   * Decrement in-degree for dependents of a completed node
   */
  markNodeCompleted(nodeId: string): void {
    for (const dependent of this.getDependents(nodeId)) {
      const currentDegree = this.inDegree.get(dependent) ?? 0;
      this.inDegree.set(dependent, Math.max(0, currentDegree - 1));
    }
  }

  /**
   * Get nodes that are ready to execute.
   *
   * A node is ready if:
   * 1. All dependencies are satisfied (in-degree = 0)
   * 2. Not already completed/running/failed
   */
  getReadyNodes(nodeStates: Record<string, NodeState>): string[] {
    return [...this.inDegree.entries()]
      .filter(([nodeId, degree]) => {
        const state = nodeStates[nodeId];
        return degree === 0 && (!state || state.status === "pending");
      })
      .map(([nodeId]) => nodeId);
  }

  /**
   * Check if the graph contains cycles (using DFS).
   */
  hasCycle(): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      for (const neighbor of this.adjList.get(nodeId) || []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodeMap.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return true;
      }
    }

    return false;
  }

  /**
   * Get the underlying graph structure.
   */
  getStructure(): GraphStructure {
    return {
      adjList: this.adjList,
      inDegree: this.inDegree,
      nodeMap: this.nodeMap,
    };
  }

  /**
   * Build dependency graph from nodes.
   */
  private buildGraph(nodes: WorkflowNode[]): GraphStructure {
    const adjList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const nodeMap = new Map<string, WorkflowNode>();

    // Initialize nodes
    for (const node of nodes) {
      adjList.set(node.id, []);
      inDegree.set(node.id, 0);
      nodeMap.set(node.id, node);
    }

    // Build edges from explicit dependencies
    for (const node of nodes) {
      for (const dep of node.dependsOn || []) {
        if (!adjList.has(dep)) {
          throw new Error(`Node "${node.id}" depends on unknown node "${dep}"`);
        }
        adjList.get(dep)!.push(node.id);
        inDegree.set(node.id, inDegree.get(node.id)! + 1);
      }
    }

    // Handle implicit sequential dependencies
    // Nodes without explicit deps follow sequential order
    let prevNodeId: string | null = null;
    for (const node of nodes) {
      if (!node.dependsOn || node.dependsOn.length === 0) {
        if (prevNodeId && !this.hasAnyDependents(nodes, node.id)) {
          adjList.get(prevNodeId)!.push(node.id);
          inDegree.set(node.id, inDegree.get(node.id)! + 1);
        }
      }
      prevNodeId = node.id;
    }

    return { adjList, inDegree, nodeMap };
  }

  /**
   * Check if a node has any dependents.
   */
  private hasAnyDependents(nodes: WorkflowNode[], nodeId: string): boolean {
    return nodes.some((n) => n.dependsOn?.includes(nodeId));
  }
}

/**
 * Create a new dependency graph.
 */
export function createDependencyGraph(nodes: WorkflowNode[]): DependencyGraph {
  return new DependencyGraph(nodes);
}
