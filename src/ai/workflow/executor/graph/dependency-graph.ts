
import type { NodeState, WorkflowNode } from "../../types.ts";

export interface GraphStructure {
  adjList: Map<string, string[]>;
  inDegree: Map<string, number>;
  nodeMap: Map<string, WorkflowNode>;
}

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

  getNode(nodeId: string): WorkflowNode | undefined {
    return this.nodeMap.get(nodeId);
  }

  getDependents(nodeId: string): string[] {
    return this.adjList.get(nodeId) || [];
  }

  markNodeCompleted(nodeId: string): void {
    for (const dependent of this.getDependents(nodeId)) {
      const currentDegree = this.inDegree.get(dependent) ?? 0;
      this.inDegree.set(dependent, Math.max(0, currentDegree - 1));
    }
  }

  getReadyNodes(nodeStates: Record<string, NodeState>): string[] {
    const ready: string[] = [];

    for (const [nodeId, degree] of this.inDegree) {
      const state = nodeStates[nodeId];
      const isReady = degree === 0 && (!state || state.status === "pending");

      if (isReady) {
        ready.push(nodeId);
      }
    }

    return ready;
  }

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

  getStructure(): GraphStructure {
    return {
      adjList: this.adjList,
      inDegree: this.inDegree,
      nodeMap: this.nodeMap,
    };
  }

  private buildGraph(nodes: WorkflowNode[]): GraphStructure {
    const adjList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const nodeMap = new Map<string, WorkflowNode>();

    for (const node of nodes) {
      adjList.set(node.id, []);
      inDegree.set(node.id, 0);
      nodeMap.set(node.id, node);
    }

    for (const node of nodes) {
      for (const dep of node.dependsOn || []) {
        if (!adjList.has(dep)) {
          throw new Error(`Node "${node.id}" depends on unknown node "${dep}"`);
        }
        adjList.get(dep)!.push(node.id);
        inDegree.set(node.id, inDegree.get(node.id)! + 1);
      }
    }

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

  private hasAnyDependents(nodes: WorkflowNode[], nodeId: string): boolean {
    return nodes.some((n) => n.dependsOn?.includes(nodeId));
  }
}

export function createDependencyGraph(nodes: WorkflowNode[]): DependencyGraph {
  return new DependencyGraph(nodes);
}
