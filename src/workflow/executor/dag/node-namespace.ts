import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { WorkflowDefinition, WorkflowNode } from "../../types.ts";
import { createMapChildNodes, isWorkflowDefinition } from "./map-node-strategy.ts";

const MAX_RECURSIVE_NODE_DEPTH = 64;
const MAX_RECURSIVE_NODE_COUNT = 10_000;
const FRAMEWORK_CONTEXT_KEYS = new Set(["input", "env", "_tenant", "_loop"]);

export const ROOT_NODE_SCOPE = "workflow";

interface TraversalState {
  count: number;
  activeArrays: WeakSet<object>;
  activeConfigs: WeakSet<object>;
}

function invalid(detail: string): never {
  throw INVALID_ARGUMENT.create({ detail });
}

export function childNodeScope(scope: string, kind: string, nodeId: string): string {
  return `${scope}/${kind}(${JSON.stringify(nodeId)})`;
}

/**
 * Guards the flat public workflow context and node-state namespaces.
 *
 * Composite nodes intentionally persist their children under public node IDs.
 * Reusing an ID in another execution scope would therefore make resume behavior
 * depend on execution order. This registry rejects that ambiguity before the
 * affected child graph starts.
 */
export class WorkflowNodeNamespace {
  private readonly claims = new Map<string, string>();
  private readonly internalKeys = new Map<string, string>();

  constructor(private readonly definitionAncestors: ReadonlySet<object> = new Set()) {}

  forkForDefinition(definition: WorkflowDefinition): WorkflowNodeNamespace {
    if (this.definitionAncestors.has(definition)) {
      invalid(`Workflow definition cycle detected at "${definition.id}"`);
    }
    if (this.definitionAncestors.size >= MAX_RECURSIVE_NODE_DEPTH) {
      invalid(
        `Sub-workflow nesting exceeds the maximum depth of ${MAX_RECURSIVE_NODE_DEPTH}`,
      );
    }

    const ancestors = new Set(this.definitionAncestors);
    ancestors.add(definition);
    return new WorkflowNodeNamespace(ancestors);
  }

  preclaimStatic(nodes: WorkflowNode[], scope = ROOT_NODE_SCOPE): void {
    this.preclaimGraph(nodes, scope, 0, {
      count: 0,
      activeArrays: new WeakSet<object>(),
      activeConfigs: new WeakSet<object>(),
    });
  }

  private preclaimGraph(
    nodes: WorkflowNode[],
    scope: string,
    depth: number,
    traversal: TraversalState,
  ): void {
    if (depth > MAX_RECURSIVE_NODE_DEPTH) {
      invalid(
        `Workflow node nesting exceeds the maximum depth of ${MAX_RECURSIVE_NODE_DEPTH}`,
      );
    }
    if (!Array.isArray(nodes)) {
      invalid(`Workflow nodes in scope ${scope} must be an array`);
    }
    if (traversal.activeArrays.has(nodes)) {
      invalid(`Cyclic composite node definition detected in scope ${scope}`);
    }

    traversal.count += nodes.length;
    if (traversal.count > MAX_RECURSIVE_NODE_COUNT) {
      invalid(
        `Workflow definition exceeds the maximum recursive node count of ${MAX_RECURSIVE_NODE_COUNT}`,
      );
    }

    const localIds = new Set<string>();
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (!node || typeof node !== "object") {
        invalid(`Workflow node at index ${index} in scope ${scope} is invalid`);
      }
      if (typeof node.id !== "string" || !node.id.trim()) {
        invalid(`Workflow node at index ${index} in scope ${scope} has an invalid ID`);
      }
      if (localIds.has(node.id)) {
        invalid(`Duplicate workflow node ID: "${node.id}"`);
      }
      localIds.add(node.id);
      this.claim(node.id, scope);
    }

    traversal.activeArrays.add(nodes);
    try {
      for (const node of nodes) {
        const config = node.config;
        if (!config || typeof config !== "object") {
          invalid(`Workflow node "${node.id}" has an invalid config`);
        }
        if (traversal.activeConfigs.has(config)) {
          invalid(`Cyclic composite config detected at workflow node "${node.id}"`);
        }

        traversal.activeConfigs.add(config);
        try {
          switch (config.type) {
            case "parallel":
              this.preclaimGraph(
                config.nodes,
                childNodeScope(scope, "parallel", node.id),
                depth + 1,
                traversal,
              );
              break;
            case "branch":
              this.preclaimGraph(
                config.then,
                childNodeScope(scope, "branch-then", node.id),
                depth + 1,
                traversal,
              );
              if (config.else) {
                this.preclaimGraph(
                  config.else,
                  childNodeScope(scope, "branch-else", node.id),
                  depth + 1,
                  traversal,
                );
              }
              break;
            case "map":
              if (Array.isArray(config.items)) {
                this.preclaimGraph(
                  createMapChildNodes(node, config, config.items),
                  childNodeScope(scope, "map", node.id),
                  depth + 1,
                  traversal,
                );
              }
              break;
            case "loop":
              this.reserveInternalKey(
                `${node.id}_loop_state`,
                childNodeScope(scope, "loop-state", node.id),
              );
              if (Array.isArray(config.steps)) {
                this.preclaimGraph(
                  config.steps,
                  childNodeScope(scope, "loop", node.id),
                  depth + 1,
                  traversal,
                );
              }
              break;
            case "subWorkflow":
              if (isWorkflowDefinition(config.workflow)) {
                this.preclaimDefinition(config.workflow, depth + 1, traversal);
              }
              break;
          }
        } finally {
          traversal.activeConfigs.delete(config);
        }
      }
    } finally {
      traversal.activeArrays.delete(nodes);
    }
  }

  private preclaimDefinition(
    definition: WorkflowDefinition,
    depth: number,
    traversal: TraversalState,
  ): void {
    const definitionNamespace = this.forkForDefinition(definition);
    if (!Array.isArray(definition.steps)) return;
    definitionNamespace.preclaimGraph(
      definition.steps,
      `${ROOT_NODE_SCOPE}:${JSON.stringify(definition.id)}`,
      depth,
      traversal,
    );
  }

  private claim(nodeId: string, scope: string): void {
    if (FRAMEWORK_CONTEXT_KEYS.has(nodeId)) {
      invalid(
        `Workflow node ID "${nodeId}" aliases a framework-owned workflow context key`,
      );
    }
    const internalOwner = this.internalKeys.get(nodeId);
    if (internalOwner !== undefined) {
      invalid(
        `Workflow node ID "${nodeId}" is reserved for internal workflow state ` +
          `owned by ${internalOwner}`,
      );
    }
    const existingScope = this.claims.get(nodeId);
    if (existingScope === scope) return;
    if (existingScope !== undefined) {
      invalid(
        `Workflow node ID "${nodeId}" is reused across execution scopes ` +
          `(${existingScope} and ${scope})`,
      );
    }
    if (this.claims.size >= MAX_RECURSIVE_NODE_COUNT) {
      invalid(
        `Workflow execution exceeds the maximum node namespace size of ${MAX_RECURSIVE_NODE_COUNT}`,
      );
    }
    this.claims.set(nodeId, scope);
  }

  private reserveInternalKey(key: string, owner: string): void {
    const claimedScope = this.claims.get(key);
    if (claimedScope !== undefined) {
      invalid(
        `Workflow node ID "${key}" is reserved for internal workflow state owned by ${owner}`,
      );
    }
    const existingOwner = this.internalKeys.get(key);
    if (existingOwner !== undefined && existingOwner !== owner) {
      invalid(`Internal workflow state key "${key}" is reused by ${existingOwner} and ${owner}`);
    }
    this.internalKeys.set(key, owner);
  }
}
