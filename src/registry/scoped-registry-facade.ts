import { ProjectScopedRegistryManager } from "./project-scoped-registry-manager.ts";

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

  /** Get item from the current scope only, without shared-registry fallback. */
  getOwn(id: string): T | undefined {
    return this.manager.getOwn(id);
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

/**
 * Project-scoped registry view used by application code. Maintenance methods
 * remain available for public API compatibility; framework composition roots
 * should prefer the explicitly named internal registry exports when exercising
 * process-wide behavior.
 */
export class ScopedRegistryView<T> {
  readonly #registry: ScopedRegistryFacade<T>;

  constructor(registry: ScopedRegistryFacade<T>) {
    this.#registry = registry;
  }

  register(id: string, item: T): void {
    this.#registry.register(id, item);
  }

  get(id: string): T | undefined {
    return this.#registry.get(id);
  }

  getOwn(id: string): T | undefined {
    return this.#registry.getOwn(id);
  }

  has(id: string): boolean {
    return this.#registry.has(id);
  }

  getAllIds(): string[] {
    return this.#registry.getAllIds();
  }

  getAll(): Map<string, T> {
    return this.#registry.getAll();
  }

  delete(id: string): boolean {
    return this.#registry.delete(id);
  }

  clear(): void {
    this.#registry.clear();
  }

  /** Register a framework-provided item available to all projects. */
  registerShared(id: string, item: T): void {
    this.#registry.registerShared(id, item);
  }

  /** Clear project and shared registry state. */
  clearAll(): void {
    this.#registry.clearAll();
  }

  /** Return aggregate project and shared registry counts. */
  getStats(): ReturnType<ProjectScopedRegistryManager<T>["getStats"]> {
    return this.#registry.getStats();
  }
}
