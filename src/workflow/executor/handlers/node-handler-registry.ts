/**
 * Node Handler Registry
 *
 * Manages registration and lookup of node handlers.
 * Replaces the switch statement in DAGExecutor with a registry pattern.
 */

import type { WorkflowNodeConfig, WorkflowNodeType } from "../../types.ts";
import type { INodeHandler } from "./node-handler.ts";

/**
 * Registry for node handlers.
 *
 * Usage:
 * ```ts
 * const registry = new NodeHandlerRegistry();
 * registry.register(new StepNodeHandler(stepExecutor));
 * registry.register(new ParallelNodeHandler(dagExecutor));
 *
 * const handler = registry.getHandler(nodeConfig);
 * const result = await handler.execute(node, context);
 * ```
 */
export class NodeHandlerRegistry {
  private handlers: Map<WorkflowNodeType, INodeHandler> = new Map();

  /**
   * Register a node handler.
   * Overwrites any existing handler for the same node type.
   */
  register(handler: INodeHandler): void {
    this.handlers.set(handler.nodeType, handler);
  }

  /**
   * Get the handler for a node config.
   * @throws Error if no handler is registered for the node type
   */
  getHandler(config: WorkflowNodeConfig): INodeHandler {
    const handler = this.handlers.get(config.type);

    if (!handler) {
      throw new Error(
        `No handler registered for node type "${config.type}". ` +
          `Registered types: ${[...this.handlers.keys()].join(", ") || "none"}`,
      );
    }

    return handler;
  }

  /**
   * Get the handler for a node config with type guard validation.
   * Use this when you need to ensure the handler can handle the specific config.
   * @throws Error if no handler is registered or handler cannot handle config
   */
  getValidatedHandler<T extends WorkflowNodeConfig>(
    config: T,
    validator: (config: WorkflowNodeConfig) => config is T,
  ): INodeHandler<T> {
    const handler = this.getHandler(config);

    if (!validator(config)) {
      throw new Error(
        `Handler for "${config.type}" cannot handle the provided configuration.`,
      );
    }

    return handler as INodeHandler<T>;
  }

  /**
   * Check if a handler is registered for a node type.
   */
  hasHandler(nodeType: WorkflowNodeType): boolean {
    return this.handlers.has(nodeType);
  }

  /**
   * Get all registered node types.
   */
  getRegisteredTypes(): WorkflowNodeType[] {
    return [...this.handlers.keys()];
  }

  /**
   * Remove a handler for a node type.
   */
  unregister(nodeType: WorkflowNodeType): boolean {
    return this.handlers.delete(nodeType);
  }

  /**
   * Clear all registered handlers.
   */
  clear(): void {
    this.handlers.clear();
  }
}

/**
 * Create a new node handler registry.
 */
export function createNodeHandlerRegistry(): NodeHandlerRegistry {
  return new NodeHandlerRegistry();
}
