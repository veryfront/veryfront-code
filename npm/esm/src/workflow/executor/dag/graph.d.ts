/**
 * DAG Graph Utilities
 *
 * Graph building, validation, and traversal utilities for DAG execution.
 *
 * @module ai/workflow/executor/dag/graph
 */
import type { NodeState, WorkflowNode } from "../../types.js";
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
export declare function hasAnyDependents(nodes: WorkflowNode[], nodeId: string): boolean;
/**
 * Build dependency graph from nodes
 */
export declare function buildGraph(nodes: WorkflowNode[]): DAGGraph;
/**
 * Get nodes that are ready to execute
 */
export declare function getReadyNodes(inDegree: Map<string, number>, nodeStates: Record<string, NodeState>): string[];
/**
 * Check if DAG has cycles (using DFS)
 */
export declare function hasCycle(nodes: WorkflowNode[], adjList: Map<string, string[]>): boolean;
/**
 * Update in-degrees for already completed nodes
 * Used when resuming from checkpoints
 */
export declare function updateInDegreesForCompletedNodes(nodeStates: Record<string, NodeState>, adjList: Map<string, string[]>, inDegree: Map<string, number>): void;
//# sourceMappingURL=graph.d.ts.map