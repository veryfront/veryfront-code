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

import { tryGetRegistryScopeId } from "#veryfront/cache/cache-key-builder.ts";
import { agentLogger } from "#veryfront/utils/logger/logger.ts";
import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_SCOPE_ID = "__default__";

interface RegistryTransactionStage {
  commit(): void;
}

interface RegistryTransaction {
  readonly targetScopeId: string;
  readonly stages: Map<object, RegistryTransactionStage>;
  state: "active" | "committed" | "aborted";
}

const registryTransactionStorage = new AsyncLocalStorage<RegistryTransaction>();

function buildRegistryScopeId(): string {
  // tryGetRegistryScopeId() returns a project-isolated key even when
  // tryGetCacheKeyContext() would return null (e.g. control-plane runs for an
  // environment source without a pinned releaseId). Without this, all such
  // runs collapse to "__default__", so concurrent projects can overwrite one
  // another's registered primitives.
  return tryGetRegistryScopeId() ?? DEFAULT_SCOPE_ID;
}

/**
 * Stage project-scoped registry mutations and publish them as one synchronous
 * commit after the callback succeeds. Reads inside the callback see staged
 * state; concurrent requests keep seeing the previous live state.
 * The commit is an authoritative replacement, so it linearizes after and may
 * supersede live writes made to the same scope while staging is in progress.
 * Use this for complete discovery generations, not incremental updates.
 *
 * Nested calls participate in the existing transaction. If a nested tenant
 * context changes the registry scope, the first registry access throws rather
 * than committing data into the wrong tenant.
 */
export async function runWithRegistryTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const existing = registryTransactionStorage.getStore();
  if (existing?.state === "active") return await fn();

  const transaction: RegistryTransaction = {
    targetScopeId: buildRegistryScopeId(),
    stages: new Map(),
    state: "active",
  };

  return await registryTransactionStorage.run(transaction, async () => {
    try {
      const result = await fn();

      // Map replacement is synchronous. No other request can observe a partial
      // commit between managers in this JavaScript turn.
      for (const stage of transaction.stages.values()) {
        stage.commit();
      }
      transaction.state = "committed";
      transaction.stages.clear();
      return result;
    } catch (error) {
      transaction.state = "aborted";
      transaction.stages.clear();
      throw error;
    }
  });
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

  /** Return a transaction-local copy of the target registry when staging. */
  private getTransactionRegistry(scopeId: string): Map<string, T> | undefined {
    const transaction = registryTransactionStorage.getStore();
    if (!transaction) return undefined;
    if (transaction.state === "committed") return undefined;
    if (transaction.state === "aborted") {
      throw new Error(
        `[${this.registryName}] Registry transaction already aborted for scope ` +
          `"${transaction.targetScopeId}"`,
      );
    }

    if (scopeId !== transaction.targetScopeId) {
      throw new Error(
        `[${this.registryName}] Registry scope changed during transaction: ` +
          `expected "${transaction.targetScopeId}", got "${scopeId}"`,
      );
    }

    const existing = transaction.stages.get(this) as
      | (RegistryTransactionStage & { registry: Map<string, T> })
      | undefined;
    if (existing) return existing.registry;

    const registry = new Map(this.registriesByScope.get(scopeId));
    const stage: RegistryTransactionStage & { registry: Map<string, T> } = {
      registry,
      commit: () => {
        if (registry.size === 0) {
          this.registriesByScope.delete(scopeId);
        } else {
          this.registriesByScope.set(scopeId, registry);
        }
      },
    };
    transaction.stages.set(this, stage);
    return registry;
  }

  /** Read the active registry, routing transaction access to its staged copy. */
  private getActiveScopeRegistry(scopeId: string): Map<string, T> | undefined {
    return this.getTransactionRegistry(scopeId) ?? this.registriesByScope.get(scopeId);
  }

  /**
   * Get or create registry for a specific project.
   */
  private getScopeRegistry(scopeId: string): Map<string, T> {
    const staged = this.getTransactionRegistry(scopeId);
    if (staged) return staged;

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
    // Shared framework infrastructure is intentionally process-wide and is
    // published immediately even inside a project transaction. Project
    // discovery must never use this method for tenant-owned definitions.
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
    return this.getActiveScopeRegistry(scopeId)?.get(id) ?? this.sharedRegistry.get(id);
  }

  /**
   * Get item registered in the current project's own scope, without falling
   * back to the shared registry. Use this to distinguish a project-local
   * registration (which may legitimately shadow a shared item) from a true
   * same-scope duplicate.
   */
  getOwn(id: string): T | undefined {
    const scopeId = this.getCurrentScopeId();
    return this.getActiveScopeRegistry(scopeId)?.get(id);
  }

  /**
   * Check if item exists for the current project.
   */
  has(id: string): boolean {
    const scopeId = this.getCurrentScopeId();
    return (this.getActiveScopeRegistry(scopeId)?.has(id) ?? false) ||
      this.sharedRegistry.has(id);
  }

  /**
   * Get all IDs for the current project (includes shared items).
   */
  getAllIds(): string[] {
    const scopeId = this.getCurrentScopeId();
    const projectIds = this.getActiveScopeRegistry(scopeId)?.keys() ?? [];
    const sharedIds = this.sharedRegistry.keys();
    return Array.from(new Set([...projectIds, ...sharedIds]));
  }

  /**
   * Get all items for the current project (includes shared items).
   */
  getAll(): Map<string, T> {
    const scopeId = this.getCurrentScopeId();
    const projectRegistry = this.getActiveScopeRegistry(scopeId);
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
    const registry = this.getActiveScopeRegistry(scopeId);
    if (!registry?.has(id)) return false;

    registry.delete(id);
    agentLogger.debug(`[${this.registryName}] Deleted "${id}" from scope ${scopeId}`);
    return true;
  }

  /**
   * Clear all items for the current project.
   */
  clear(): void {
    const staged = this.getTransactionRegistry(this.getCurrentScopeId());
    if (staged) {
      staged.clear();
      return;
    }
    this.clearProject(this.getCurrentScopeId());
  }

  /**
   * Clear a specific project's registry.
   */
  clearProject(projectId: string): void {
    const transaction = registryTransactionStorage.getStore();
    if (transaction && transaction.state !== "committed") {
      throw new Error(
        `[${this.registryName}] clearProject() is not supported during a registry transaction`,
      );
    }

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
    const transaction = registryTransactionStorage.getStore();
    if (transaction && transaction.state !== "committed") {
      throw new Error(
        `[${this.registryName}] clearAll() is not supported during a registry transaction`,
      );
    }

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
      currentProjectItems: this.getActiveScopeRegistry(scopeId)?.size ?? 0,
    };
  }
}
