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

type RegistryMutation<T> =
  | { readonly type: "clear" }
  | { readonly type: "delete"; readonly id: string }
  | { readonly type: "set"; readonly id: string; readonly item: T };

interface RegistryTransactionPublication {
  publish(): void;
}

interface RegistryTransactionStage {
  prepare(): RegistryTransactionPublication;
  abort(): void;
}

interface ManagedRegistryTransactionStage<T> extends RegistryTransactionStage {
  readonly registry: Map<string, T>;
  validateRegistration(id: string, incoming: T): void;
  record(mutation: RegistryMutation<T>): void;
}

interface ProjectScopedRegistryManagerOptions<T> {
  /** Must be side-effect free; transaction preparation may invoke it again. */
  validateRegistration?(id: string, existing: T, incoming: T): void;
}

interface RegistryTransaction {
  readonly targetScopeId: string;
  readonly stages: Map<object, RegistryTransactionStage>;
  state: "active" | "committed" | "aborted";
}

const registryTransactionStorage = new AsyncLocalStorage<RegistryTransaction>();
const registryTransactionLocks = new Map<string, Promise<void>>();

async function acquireRegistryTransactionLock(scopeId: string): Promise<() => void> {
  const previous = registryTransactionLocks.get(scopeId) ?? Promise.resolve();
  const gate = Promise.withResolvers<void>();
  const current = previous.then(() => gate.promise);
  registryTransactionLocks.set(scopeId, current);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    gate.resolve();
    if (registryTransactionLocks.get(scopeId) === current) {
      registryTransactionLocks.delete(scopeId);
    }
  };
}

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
 * Transactions for the same scope are serialized. Live writes made outside
 * the transaction while discovery is in flight are journaled alongside staged
 * mutations and replayed in call order, preserving the previous immediate-
 * mutation semantics without exposing a partially discovered generation.
 * Use this for complete discovery generations, not incremental updates.
 *
 * Nested calls participate in the existing transaction. If a nested tenant
 * context changes the registry scope, the first registry access throws rather
 * than committing data into the wrong tenant.
 */
export async function runWithRegistryTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const existing = registryTransactionStorage.getStore();
  if (existing?.state === "active") return await fn();

  const targetScopeId = buildRegistryScopeId();
  const releaseLock = await acquireRegistryTransactionLock(targetScopeId);
  const transaction: RegistryTransaction = {
    targetScopeId,
    stages: new Map(),
    state: "active",
  };

  try {
    return await registryTransactionStorage.run(transaction, async () => {
      try {
        const result = await fn();

        // Prepare every manager before publishing any of them. Publication is
        // synchronous, so no request can observe a partial generation.
        const publications = Array.from(
          transaction.stages.values(),
          (stage) => stage.prepare(),
        );
        for (const publication of publications) {
          publication.publish();
        }
        transaction.state = "committed";
        transaction.stages.clear();
        return result;
      } catch (error) {
        transaction.state = "aborted";
        for (const stage of transaction.stages.values()) {
          stage.abort();
        }
        transaction.stages.clear();
        throw error;
      }
    });
  } finally {
    releaseLock();
  }
}

/**
 * Base class for project-scoped registries.
 * Provides isolation between projects while allowing
 * cross-project sharing of explicitly shared items.
 */
export class ProjectScopedRegistryManager<T> {
  private registriesByScope = new Map<string, Map<string, T>>();
  private sharedRegistry = new Map<string, T>();
  private activeStagesByScope = new Map<string, Set<ManagedRegistryTransactionStage<T>>>();

  constructor(
    private registryName: string,
    private options: ProjectScopedRegistryManagerOptions<T> = {},
  ) {}

  private validateRegistration(
    registry: Map<string, T>,
    id: string,
    incoming: T,
  ): void {
    if (!registry.has(id)) return;
    this.options.validateRegistration?.(id, registry.get(id) as T, incoming);
  }

  private applyMutation(
    registry: Map<string, T>,
    mutation: RegistryMutation<T>,
    validateRegistration = false,
  ): void {
    switch (mutation.type) {
      case "clear":
        registry.clear();
        break;
      case "delete":
        registry.delete(mutation.id);
        break;
      case "set":
        if (validateRegistration) {
          this.validateRegistration(registry, mutation.id, mutation.item);
        }
        registry.set(mutation.id, mutation.item);
        break;
    }
  }

  /**
   * Get the current project ID from AsyncLocalStorage context.
   * Falls back to default for CLI/test scenarios.
   */
  private getCurrentScopeId(): string {
    return buildRegistryScopeId();
  }

  /** Return the transaction-local stage for this manager and scope. */
  private getTransactionStage(
    scopeId: string,
  ): ManagedRegistryTransactionStage<T> | undefined {
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
      | ManagedRegistryTransactionStage<T>
      | undefined;
    if (existing) return existing;

    const baseRegistry = new Map(this.registriesByScope.get(scopeId));
    const registry = new Map(baseRegistry);
    const validationRegistry = new Map(baseRegistry);
    const mutations: RegistryMutation<T>[] = [];
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      const activeStages = this.activeStagesByScope.get(scopeId);
      activeStages?.delete(stage);
      if (activeStages?.size === 0) this.activeStagesByScope.delete(scopeId);
    };

    const stage: ManagedRegistryTransactionStage<T> = {
      registry,
      validateRegistration: (id, incoming) => {
        this.validateRegistration(validationRegistry, id, incoming);
      },
      record: (mutation) => {
        mutations.push(mutation);
        this.applyMutation(validationRegistry, mutation);
      },
      prepare: () => {
        const replacement = new Map(baseRegistry);
        for (const mutation of mutations) {
          this.applyMutation(replacement, mutation, true);
        }

        return {
          publish: () => {
            close();
            if (replacement.size === 0) {
              this.registriesByScope.delete(scopeId);
            } else {
              this.registriesByScope.set(scopeId, replacement);
            }
          },
        };
      },
      abort: close,
    };
    transaction.stages.set(this, stage);
    const activeStages = this.activeStagesByScope.get(scopeId) ?? new Set();
    activeStages.add(stage);
    this.activeStagesByScope.set(scopeId, activeStages);
    return stage;
  }

  /** Record a live mutation in any in-flight transaction for this scope. */
  private recordLiveMutation(scopeId: string, mutation: RegistryMutation<T>): void {
    for (const stage of this.activeStagesByScope.get(scopeId) ?? []) {
      stage.record(mutation);
    }
  }

  /** Read the active registry, routing transaction access to its staged copy. */
  private getActiveScopeRegistry(scopeId: string): Map<string, T> | undefined {
    return this.getTransactionStage(scopeId)?.registry ?? this.registriesByScope.get(scopeId);
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
    const stage = this.getTransactionStage(scopeId);
    const registry = stage?.registry ?? this.getScopeRegistry(scopeId);

    if (stage) stage.validateRegistration(id, item);
    else this.validateRegistration(registry, id, item);
    if (registry.has(id)) {
      agentLogger.debug(
        `[${this.registryName}] "${id}" already registered for scope ${scopeId}. Overwriting.`,
      );
    }

    registry.set(id, item);
    const mutation: RegistryMutation<T> = { type: "set", id, item };
    if (stage) stage.record(mutation);
    else this.recordLiveMutation(scopeId, mutation);
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
    const stage = this.getTransactionStage(scopeId);
    const registry = stage?.registry ?? this.registriesByScope.get(scopeId);
    const existed = registry?.has(id) ?? false;
    if (!existed && !stage && !this.activeStagesByScope.has(scopeId)) return false;

    registry?.delete(id);
    const mutation: RegistryMutation<T> = { type: "delete", id };
    if (stage) stage.record(mutation);
    else this.recordLiveMutation(scopeId, mutation);
    agentLogger.debug(`[${this.registryName}] Deleted "${id}" from scope ${scopeId}`);
    return existed;
  }

  /**
   * Clear all items for the current project.
   */
  clear(): void {
    const scopeId = this.getCurrentScopeId();
    const stage = this.getTransactionStage(scopeId);
    if (stage) {
      stage.registry.clear();
      stage.record({ type: "clear" });
      return;
    }
    this.clearProject(scopeId);
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
    const scopeIds = new Set([
      ...this.registriesByScope.keys(),
      ...this.activeStagesByScope.keys(),
    ]);
    for (const scopeId of scopeIds) {
      if (scopeId === projectId || scopeId.startsWith(`${projectId}:`)) {
        cleared = this.registriesByScope.delete(scopeId) || cleared;
        this.recordLiveMutation(scopeId, { type: "clear" });
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

    const scopeIds = new Set([
      ...this.registriesByScope.keys(),
      ...this.activeStagesByScope.keys(),
    ]);
    for (const scopeId of scopeIds) {
      this.recordLiveMutation(scopeId, { type: "clear" });
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
