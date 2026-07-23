import { ProjectScopedRegistryManager } from "./project-scoped-registry-manager.ts";

/** Public delegation surface for a project-scoped registry manager. */
export class ScopedRegistryFacade<T> {
  /** Bind the facade to one manager. */
  constructor(protected readonly manager: ProjectScopedRegistryManager<T>) {}

  /** Register an item in the current project scope. */
  register(id: string, item: T): void {
    this.manager.register(id, item);
  }

  /**
   * Register a framework-provided item available to all projects.
   */
  registerShared(id: string, item: T): void {
    this.manager.registerShared(id, item);
  }

  /** Get an item from the shared registry only. */
  getShared(id: string): T | undefined {
    return this.manager.getShared(id);
  }

  /** Check whether the shared registry contains an item. */
  hasShared(id: string): boolean {
    return this.manager.hasShared(id);
  }

  /** Delete an item from the shared registry. */
  deleteShared(id: string): boolean {
    return this.manager.deleteShared(id);
  }

  /** Resolve an item from the current scope, with shared fallback. */
  get(id: string): T | undefined {
    return this.manager.get(id);
  }

  /** Get item from the current scope only, without shared-registry fallback. */
  getOwn(id: string): T | undefined {
    return this.manager.getOwn(id);
  }

  /** Check whether the current scope contains an item without shared fallback. */
  hasOwn(id: string): boolean {
    return this.manager.hasOwn(id);
  }

  /** Return whether the current scope or shared registry contains an item. */
  has(id: string): boolean {
    return this.manager.has(id);
  }

  /** List identifiers visible to the current scope. */
  getAllIds(): string[] {
    return this.manager.getAllIds();
  }

  /** Return a membership snapshot of every item visible to the current scope. */
  getAll(): Map<string, T> {
    return this.manager.getAll();
  }

  /** Delete an item from the current project scope. */
  delete(id: string): boolean {
    return this.manager.delete(id);
  }

  /** Clear the current project scope without changing shared items. */
  clear(): void {
    this.manager.clear();
  }

  /**
   * Clear every project scope and shared item outside restricted project code.
   */
  clearAll(): void {
    this.manager.clearAll();
  }

  /** Return aggregate live-storage statistics and current-scope item count. */
  getStats(): ReturnType<ProjectScopedRegistryManager<T>["getStats"]> {
    return this.manager.getStats();
  }
}
