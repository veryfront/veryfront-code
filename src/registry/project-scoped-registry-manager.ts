/**
 * Project-Scoped Registry Manager
 *
 * Provides multi-tenant isolation for project-scoped registries (tools,
 * prompts, workflows, agents, resources, providers). Each project gets its own
 * isolated registry namespace, preventing cross-project leakage of registered
 * resources.
 *
 * Usage:
 * ```ts
 * const toolManager = new ProjectScopedRegistryManager<Tool>("tool");
 *
 * // Register for current project (uses AsyncLocalStorage context)
 * toolManager.register("my-tool", myTool);
 *
 * // Get for current project
 * const tool = toolManager.get("my-tool");
 *
 * // Register framework-provided tools (available to all projects)
 * toolManager.registerShared("veryfront-search", searchTool);
 * ```
 *
 * @module
 */

import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";

const DEFAULT_SCOPE_ID = "__default__";

function buildRegistryScopeId(): string {
  const cacheContext = tryGetCacheKeyContext();
  if (!cacheContext) {
    return DEFAULT_SCOPE_ID;
  }

  return `${cacheContext.projectId}:${cacheContext.mode}:${cacheContext.versionId}`;
}

/**
 * Base class for project-scoped registries.
 * Provides isolation between projects while allowing
 * cross-project sharing of explicitly shared items.
 */
export class ProjectScopedRegistryManager<T> {
  private registriesByScope = new Map<string, Map<string, T>>();
  private sharedRegistry = new Map<string, T>();

  constructor(private registryName: string) {}

  /**
   * Get the current project ID from AsyncLocalStorage context.
   * Falls back to default for CLI/test scenarios.
   */
  private getCurrentScopeId(): string {
    return buildRegistryScopeId();
  }

  /**
   * Get or create registry for a specific project.
   */
  private getScopeRegistry(scopeId: string): Map<string, T> {
    const existing = this.registriesByScope.get(scopeId);
    if (existing) return existing;

    const registry = new Map<string, T>();
    this.registriesByScope.set(scopeId, registry);
    return registry;
  }

  /**
   * Register an item for the current project.
   */
  register(id: string, item: T): void {
    const scopeId = this.getCurrentScopeId();
    const registry = this.getScopeRegistry(scopeId);

    if (registry.has(id)) {
      agentLogger.debug(
        `[${this.registryName}] "${id}" already registered for scope ${scopeId}. Overwriting.`,
      );
    }

    registry.set(id, item);
    agentLogger.debug(`[${this.registryName}] Registered "${id}" for scope ${scopeId}`);
  }

  /**
   * Register a shared item available to all projects.
   * Use for framework-provided tools, not user-defined ones.
   */
  registerShared(id: string, item: T): void {
    if (this.sharedRegistry.has(id)) {
      agentLogger.debug(`[${this.registryName}] Shared "${id}" already registered. Overwriting.`);
    }

    this.sharedRegistry.set(id, item);
    agentLogger.debug(`[${this.registryName}] Registered shared "${id}"`);
  }

  /**
   * Get item for the current project.
   * Falls back to shared registry for items not found in project registry.
   */
  get(id: string): T | undefined {
    const scopeId = this.getCurrentScopeId();
    return this.registriesByScope.get(scopeId)?.get(id) ?? this.sharedRegistry.get(id);
  }

  /**
   * Get item registered in the current project's own scope, without falling
   * back to the shared registry. Use this to distinguish a project-local
   * registration (which may legitimately shadow a shared item) from a true
   * same-scope duplicate.
   */
  getOwn(id: string): T | undefined {
    const scopeId = this.getCurrentScopeId();
    return this.registriesByScope.get(scopeId)?.get(id);
  }

  /**
   * Check if item exists for the current project.
   */
  has(id: string): boolean {
    const scopeId = this.getCurrentScopeId();
    return (this.registriesByScope.get(scopeId)?.has(id) ?? false) ||
      this.sharedRegistry.has(id);
  }

  /**
   * Get all IDs for the current project (includes shared items).
   */
  getAllIds(): string[] {
    const scopeId = this.getCurrentScopeId();
    const projectIds = this.registriesByScope.get(scopeId)?.keys() ?? [];
    const sharedIds = this.sharedRegistry.keys();
    return Array.from(new Set([...projectIds, ...sharedIds]));
  }

  /**
   * Get all items for the current project (includes shared items).
   */
  getAll(): Map<string, T> {
    const scopeId = this.getCurrentScopeId();
    const projectRegistry = this.registriesByScope.get(scopeId);
    if (!projectRegistry) return new Map(this.sharedRegistry);

    const result = new Map<string, T>(this.sharedRegistry);
    for (const [id, item] of projectRegistry) result.set(id, item);
    return result;
  }

  /**
   * Delete an item from the current project's registry.
   */
  delete(id: string): boolean {
    const scopeId = this.getCurrentScopeId();
    const registry = this.registriesByScope.get(scopeId);
    if (!registry?.has(id)) return false;

    registry.delete(id);
    agentLogger.debug(`[${this.registryName}] Deleted "${id}" from scope ${scopeId}`);
    return true;
  }

  /**
   * Clear all items for the current project.
   */
  clear(): void {
    this.clearProject(this.getCurrentScopeId());
  }

  /**
   * Clear a specific project's registry.
   */
  clearProject(projectId: string): void {
    let cleared = false;
    for (const scopeId of Array.from(this.registriesByScope.keys())) {
      if (scopeId === projectId || scopeId.startsWith(`${projectId}:`)) {
        this.registriesByScope.delete(scopeId);
        cleared = true;
      }
    }

    if (cleared) {
      agentLogger.debug(`[${this.registryName}] Cleared registry for project ${projectId}`);
    }
  }

  /**
   * Clear everything (for testing).
   */
  clearAll(): void {
    this.registriesByScope.clear();
    this.sharedRegistry.clear();
    agentLogger.debug(`[${this.registryName}] Cleared all registries`);
  }

  /**
   * Get stats for monitoring.
   */
  getStats(): {
    projectCount: number;
    sharedCount: number;
    totalItems: number;
    currentProjectItems: number;
  } {
    const scopeId = this.getCurrentScopeId();
    const totalItems = this.sharedRegistry.size +
      Array.from(this.registriesByScope.values()).reduce(
        (sum, registry) => sum + registry.size,
        0,
      );

    return {
      projectCount: this.registriesByScope.size,
      sharedCount: this.sharedRegistry.size,
      totalItems,
      currentProjectItems: this.registriesByScope.get(scopeId)?.size ?? 0,
    };
  }
}
