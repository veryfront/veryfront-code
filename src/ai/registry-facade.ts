import { ProjectScopedRegistryManager } from "./registry-manager.ts";

export class ScopedRegistryFacade<T> {
  constructor(protected readonly manager: ProjectScopedRegistryManager<T>) {}

  register(id: string, item: T): void {
    this.manager.register(id, item);
  }

  /**
   * Register a framework-provided item available to all projects.
   */
  registerShared(id: string, item: T): void {
    this.manager.registerShared(id, item);
  }

  get(id: string): T | undefined {
    return this.manager.get(id);
  }

  has(id: string): boolean {
    return this.manager.has(id);
  }

  getAllIds(): string[] {
    return this.manager.getAllIds();
  }

  getAll(): Map<string, T> {
    return this.manager.getAll();
  }

  delete(id: string): boolean {
    return this.manager.delete(id);
  }

  clear(): void {
    this.manager.clear();
  }

  /**
   * Clear everything (for testing).
   */
  clearAll(): void {
    this.manager.clearAll();
  }

  getStats(): ReturnType<ProjectScopedRegistryManager<T>["getStats"]> {
    return this.manager.getStats();
  }
}
