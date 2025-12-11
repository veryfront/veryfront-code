
import type { WorkflowNodeConfig, WorkflowNodeType } from "../../types.ts";
import type { INodeHandler } from "./node-handler.ts";

export class NodeHandlerRegistry {
  private handlers: Map<WorkflowNodeType, INodeHandler> = new Map();

  register(handler: INodeHandler): void {
    this.handlers.set(handler.nodeType, handler);
  }

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

  hasHandler(nodeType: WorkflowNodeType): boolean {
    return this.handlers.has(nodeType);
  }

  getRegisteredTypes(): WorkflowNodeType[] {
    return [...this.handlers.keys()];
  }

  unregister(nodeType: WorkflowNodeType): boolean {
    return this.handlers.delete(nodeType);
  }

  clear(): void {
    this.handlers.clear();
  }
}

export function createNodeHandlerRegistry(): NodeHandlerRegistry {
  return new NodeHandlerRegistry();
}
