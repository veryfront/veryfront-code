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

import {
  isRegistryScopeForProject,
  tryGetRegistryScopeContext,
  tryGetRegistryScopeId,
  tryGetRegistryScopeOwner,
} from "#veryfront/cache/cache-key-builder.ts";
import { agentLogger } from "#veryfront/utils";
import { AsyncLocalStorage } from "node:async_hooks";

const apply = Reflect.apply;
const mapForEach = Map.prototype.forEach;
const mapSet = Map.prototype.set;
const NativeMap = Map;

function copyNativeMapEntries<K, V>(
  source: ReadonlyMap<K, V>,
  target: Map<K, V>,
): void {
  apply(mapForEach, source, [(value: V, key: K) => {
    apply(mapSet, target, [key, value]);
  }]);
}

function cloneNativeMap<K, V>(source?: ReadonlyMap<K, V>): Map<K, V> {
  const clone = new NativeMap<K, V>();
  if (source) copyNativeMapEntries(source, clone);
  return clone;
}

const DEFAULT_SCOPE_ID = "__default__";

type RegistryMutation<T> =
  | { readonly type: "clear" }
  | { readonly type: "delete"; readonly id: string }
  | {
    readonly type: "set";
    readonly id: string;
    readonly item: T;
    readonly ownerToken: object | null;
  };

interface RegistryTransactionPublication {
  publish(): void;
}

interface RegistryTransactionStage {
  prepare(): RegistryTransactionPublication;
  abort(): void;
}

interface ManagedRegistryTransactionStage<T> extends RegistryTransactionStage {
  readonly registry: Map<string, T>;
  readonly ownerTokens: Map<string, object>;
  validateRegistration(id: string, incoming: T): void;
  record(mutation: RegistryMutation<T>): void;
}

interface ProjectScopedRegistryManagerOptions<T> {
  /** Must be side-effect free; transaction preparation may invoke it again. */
  validateRegistration?(id: string, existing: T, incoming: T): void;
  /**
   * Validate one candidate against the current effective registry.
   *
   * This is the incremental form of `validateRegistry`; provide it when the
   * same invariant can be checked without rescanning every existing pair.
   * Must be side-effect free.
   */
  validateRegistryCandidate?(
    registry: ReadonlyMap<string, T>,
    id: string,
    incoming: T,
  ): void;
  /**
   * Validate invariants involving multiple entries.
   *
   * Called before a registration is published and again against the combined
   * effective shared-plus-scoped transaction state after concurrent live
   * mutations have been replayed. Shared candidates are checked against every
   * live project scope. Must be side-effect free.
   */
  validateRegistry?(registry: ReadonlyMap<string, T>): void;
}

interface RegistryTransaction {
  readonly targetScopeId: string;
  readonly stages: Map<object, RegistryTransactionStage>;
  state: "active" | "committed" | "aborted";
  invalidated: boolean;
}

const registryTransactionStorage = new AsyncLocalStorage<RegistryTransaction>();
interface RegistryTransactionQueue {
  /** Serial tail for one scope; removed once the final waiter releases it. */
  tail: Promise<void>;
  /** Advances when authoritative cleanup retires work already in this queue. */
  invalidationEpoch: number;
}

interface RegistryTransactionLock {
  invalidatedWhileWaiting(): boolean;
  release(): void;
}

const registryTransactionQueues = new Map<string, RegistryTransactionQueue>();
const activeRegistryTransactions = new Map<string, RegistryTransaction>();
const registryManagerReferences = new Set<
  WeakRef<ProjectScopedRegistryManager<unknown>>
>();
const registryManagerFinalizer = new FinalizationRegistry<
  WeakRef<ProjectScopedRegistryManager<unknown>>
>((reference) => registryManagerReferences.delete(reference));
const registryScopeEvictionListeners = new Set<(scopeId: string) => void>();

interface RegistryScopeAccess {
  readonly scopeId: string;
  readonly owner: object | null;
}

interface RequestScopeBinding<T> {
  registry: Map<string, T> | undefined;
}

function trackRegistryManager<T>(manager: ProjectScopedRegistryManager<T>): void {
  const reference = new WeakRef(
    manager as ProjectScopedRegistryManager<unknown>,
  );
  registryManagerReferences.add(reference);
  registryManagerFinalizer.register(manager, reference, reference);
}

function getLiveRegistryManagers(): ProjectScopedRegistryManager<unknown>[] {
  const managers: ProjectScopedRegistryManager<unknown>[] = [];
  for (const reference of registryManagerReferences) {
    const manager = reference.deref();
    if (manager) managers.push(manager);
    else registryManagerReferences.delete(reference);
  }
  return managers;
}

function invalidateRegistryTransaction(scopeId: string): void {
  const queue = registryTransactionQueues.get(scopeId);
  if (queue) queue.invalidationEpoch++;

  const transaction = activeRegistryTransactions.get(scopeId);
  if (transaction?.state === "active") transaction.invalidated = true;
}

function invalidateProjectRegistryTransactions(projectId: string): void {
  for (const [scopeId, queue] of registryTransactionQueues) {
    if (isRegistryScopeForProject(scopeId, projectId)) {
      queue.invalidationEpoch++;
    }
  }
  for (const [scopeId, transaction] of activeRegistryTransactions) {
    if (
      transaction.state === "active" &&
      isRegistryScopeForProject(scopeId, projectId)
    ) {
      transaction.invalidated = true;
    }
  }
}

function throwLifecycleErrors(errors: unknown[], message: string): void {
  if (errors.length === 0) return;
  if (errors.length === 1) throw errors[0];
  throw new AggregateError(errors, message);
}

/**
 * Subscribe to exact registry-scope eviction.
 *
 * Lifecycle owners use this to discard derived generation records whenever the
 * underlying registries are retired. The returned disposer is idempotent.
 */
export function registerRegistryScopeEvictionListener(
  listener: (scopeId: string) => void,
): () => void {
  registryScopeEvictionListeners.add(listener);
  return () => {
    registryScopeEvictionListeners.delete(listener);
  };
}

/**
 * Retire one canonical scope from every registry manager.
 *
 * Active hosted requests retain the generation they already captured; new
 * requests see an empty scope and must rebuild it through their normal owner
 * lifecycle. An in-flight replacement transaction is invalidated so work based
 * on a retired source snapshot cannot publish afterward.
 */
export function clearRegistryScope(scopeId: string): void {
  invalidateRegistryTransaction(scopeId);
  const errors: unknown[] = [];

  for (const manager of getLiveRegistryManagers()) {
    try {
      manager.clearScopeForLifecycle(scopeId);
    } catch (error) {
      errors.push(error);
    }
  }
  for (const listener of registryScopeEvictionListeners) {
    try {
      listener(scopeId);
    } catch (error) {
      errors.push(error);
    }
  }

  throwLifecycleErrors(errors, `Failed to clear registry scope "${scopeId}"`);
}

/**
 * Retire every canonical source scope currently owned by a project.
 */
export function clearProjectRegistryScopes(projectId: string): void {
  invalidateProjectRegistryTransactions(projectId);
  const scopeIds = new Set<string>();

  for (const scopeId of activeRegistryTransactions.keys()) {
    if (isRegistryScopeForProject(scopeId, projectId)) scopeIds.add(scopeId);
  }
  for (const scopeId of registryTransactionQueues.keys()) {
    if (isRegistryScopeForProject(scopeId, projectId)) scopeIds.add(scopeId);
  }
  for (const manager of getLiveRegistryManagers()) {
    for (const scopeId of manager.getScopeIdsForLifecycle()) {
      if (isRegistryScopeForProject(scopeId, projectId)) scopeIds.add(scopeId);
    }
  }

  const errors: unknown[] = [];
  for (const scopeId of scopeIds) {
    try {
      clearRegistryScope(scopeId);
    } catch (error) {
      errors.push(error);
    }
  }
  throwLifecycleErrors(
    errors,
    `Failed to clear registry scopes for project "${projectId}"`,
  );
}

async function acquireRegistryTransactionLock(
  scopeId: string,
): Promise<RegistryTransactionLock> {
  let queue = registryTransactionQueues.get(scopeId);
  if (!queue) {
    queue = {
      tail: Promise.resolve(),
      invalidationEpoch: 0,
    };
    registryTransactionQueues.set(scopeId, queue);
  }

  const enqueuedEpoch = queue.invalidationEpoch;
  const previous = queue.tail;
  const gate = Promise.withResolvers<void>();
  const current = previous.then(() => gate.promise);
  queue.tail = current;
  await previous;

  let released = false;
  return {
    invalidatedWhileWaiting: () => queue.invalidationEpoch !== enqueuedEpoch,
    release: () => {
      if (released) return;
      released = true;
      gate.resolve();
      if (
        registryTransactionQueues.get(scopeId) === queue &&
        queue.tail === current
      ) {
        registryTransactionQueues.delete(scopeId);
      }
    },
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

function getCurrentRegistryScopeAccess(): RegistryScopeAccess {
  return {
    scopeId: tryGetRegistryScopeContext()?.scopeId ?? DEFAULT_SCOPE_ID,
    owner: tryGetRegistryScopeOwner(),
  };
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
  const lock = await acquireRegistryTransactionLock(targetScopeId);
  if (lock.invalidatedWhileWaiting()) {
    lock.release();
    throw new Error(
      `Registry transaction for scope "${targetScopeId}" was invalidated while waiting`,
    );
  }
  const transaction: RegistryTransaction = {
    targetScopeId,
    stages: new Map(),
    state: "active",
    invalidated: false,
  };
  activeRegistryTransactions.set(targetScopeId, transaction);

  try {
    return await registryTransactionStorage.run(transaction, async () => {
      try {
        const result = await fn();
        if (transaction.invalidated) {
          throw new Error(
            `Registry transaction for scope "${targetScopeId}" was invalidated`,
          );
        }

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
    if (activeRegistryTransactions.get(targetScopeId) === transaction) {
      activeRegistryTransactions.delete(targetScopeId);
    }
    lock.release();
  }
}

/**
 * Base class for project-scoped registries.
 * Provides isolation between projects while allowing
 * cross-project sharing of explicitly shared items.
 */
export class ProjectScopedRegistryManager<T> {
  private registriesByScope = new Map<string, Map<string, T>>();
  private ownerTokensByScope = new Map<string, Map<string, object>>();
  private sharedRegistry = new Map<string, T>();
  private activeStagesByScope = new Map<string, Set<ManagedRegistryTransactionStage<T>>>();
  private requestBindings = new WeakMap<
    object,
    Map<string, RequestScopeBinding<T>>
  >();

  constructor(
    private registryName: string,
    private options: ProjectScopedRegistryManagerOptions<T> = {},
  ) {
    trackRegistryManager(this);
  }

  private validateRegistration(
    registry: Map<string, T>,
    id: string,
    incoming: T,
  ): void {
    if (!registry.has(id)) return;
    this.options.validateRegistration?.(id, registry.get(id) as T, incoming);
  }

  private buildEffectiveRegistry(
    registry: ReadonlyMap<string, T>,
    sharedRegistry: ReadonlyMap<string, T> = this.sharedRegistry,
  ): Map<string, T> {
    const effective = cloneNativeMap(sharedRegistry);
    copyNativeMapEntries(registry, effective);
    return effective;
  }

  private validateEffectiveRegistry(
    registry: ReadonlyMap<string, T>,
    sharedRegistry: ReadonlyMap<string, T> = this.sharedRegistry,
  ): void {
    if (!this.options.validateRegistry) return;
    this.options.validateRegistry(
      this.buildEffectiveRegistry(registry, sharedRegistry),
    );
  }

  private validateCandidateAgainstRegistry(
    registry: ReadonlyMap<string, T>,
    id: string,
    incoming: T,
  ): void {
    if (this.options.validateRegistryCandidate) {
      this.options.validateRegistryCandidate(registry, id, incoming);
      return;
    }
    if (!this.options.validateRegistry) return;

    const candidate = cloneNativeMap(registry);
    apply(mapSet, candidate, [id, incoming]);
    this.options.validateRegistry(candidate);
  }

  private validateScopedCandidateRegistration(
    registry: Map<string, T>,
    id: string,
    incoming: T,
  ): void {
    this.validateRegistration(registry, id, incoming);
    this.validateCandidateAgainstRegistry(
      this.buildEffectiveRegistry(registry),
      id,
      incoming,
    );
  }

  private validateSharedCandidateRegistration(id: string, incoming: T): void {
    this.validateRegistration(this.sharedRegistry, id, incoming);
    this.validateCandidateAgainstRegistry(this.sharedRegistry, id, incoming);
    apply(mapForEach, this.registriesByScope, [(registry: Map<string, T>) => {
      this.validateCandidateAgainstRegistry(
        this.buildEffectiveRegistry(registry),
        id,
        incoming,
      );
    }]);
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

  private applyOwnerMutation(
    ownerTokens: Map<string, object>,
    mutation: RegistryMutation<T>,
  ): void {
    switch (mutation.type) {
      case "clear":
        ownerTokens.clear();
        break;
      case "delete":
        ownerTokens.delete(mutation.id);
        break;
      case "set":
        if (mutation.ownerToken) ownerTokens.set(mutation.id, mutation.ownerToken);
        else ownerTokens.delete(mutation.id);
        break;
    }
  }

  /**
   * Get the current project ID from AsyncLocalStorage context.
   * Falls back to default for CLI/test scenarios.
   */
  private getCurrentScopeAccess(): RegistryScopeAccess {
    return getCurrentRegistryScopeAccess();
  }

  private getRequestBinding(
    access: RegistryScopeAccess,
  ): RequestScopeBinding<T> | undefined {
    if (!access.owner) return undefined;

    let bindings = this.requestBindings.get(access.owner);
    if (!bindings) {
      bindings = new Map();
      this.requestBindings.set(access.owner, bindings);
    }

    let binding = bindings.get(access.scopeId);
    if (!binding) {
      binding = { registry: this.registriesByScope.get(access.scopeId) };
      bindings.set(access.scopeId, binding);
    }
    return binding;
  }

  private getBoundScopeRegistry(
    access: RegistryScopeAccess,
  ): Map<string, T> | undefined {
    const binding = this.getRequestBinding(access);
    return binding ? binding.registry : this.registriesByScope.get(access.scopeId);
  }

  private updateRequestBinding(
    access: RegistryScopeAccess,
    registry: Map<string, T> | undefined,
  ): void {
    const binding = this.getRequestBinding(access);
    if (binding) binding.registry = registry;
  }

  private isCurrentGeneration(
    scopeId: string,
    registry: Map<string, T> | undefined,
  ): boolean {
    return this.registriesByScope.get(scopeId) === registry;
  }

  /** Return the transaction-local stage for this manager and scope. */
  private getTransactionStage(
    access: RegistryScopeAccess,
  ): ManagedRegistryTransactionStage<T> | undefined {
    const { scopeId } = access;
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

    const baseRegistry = cloneNativeMap(this.registriesByScope.get(scopeId));
    const baseOwnerTokens = cloneNativeMap(this.ownerTokensByScope.get(scopeId));
    const registry = cloneNativeMap(baseRegistry);
    const ownerTokens = cloneNativeMap(baseOwnerTokens);
    const validationRegistry = cloneNativeMap(baseRegistry);
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
      ownerTokens,
      validateRegistration: (id, incoming) => {
        this.validateScopedCandidateRegistration(validationRegistry, id, incoming);
      },
      record: (mutation) => {
        mutations.push(mutation);
        this.applyMutation(validationRegistry, mutation);
        this.applyOwnerMutation(ownerTokens, mutation);
      },
      prepare: () => {
        const replacement = cloneNativeMap(baseRegistry);
        const replacementOwnerTokens = cloneNativeMap(baseOwnerTokens);
        for (const mutation of mutations) {
          this.applyMutation(replacement, mutation, true);
          this.applyOwnerMutation(replacementOwnerTokens, mutation);
        }
        this.validateEffectiveRegistry(replacement);

        return {
          publish: () => {
            close();
            if (replacement.size === 0) {
              this.registriesByScope.delete(scopeId);
              this.ownerTokensByScope.delete(scopeId);
              this.updateRequestBinding(access, undefined);
            } else {
              this.registriesByScope.set(scopeId, replacement);
              if (replacementOwnerTokens.size === 0) {
                this.ownerTokensByScope.delete(scopeId);
              } else {
                this.ownerTokensByScope.set(scopeId, replacementOwnerTokens);
              }
              this.updateRequestBinding(access, replacement);
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
  private getActiveScopeRegistry(access: RegistryScopeAccess): Map<string, T> | undefined {
    return this.getTransactionStage(access)?.registry ?? this.getBoundScopeRegistry(access);
  }

  /**
   * Get or create registry for a specific project.
   */
  private getScopeRegistry(access: RegistryScopeAccess): Map<string, T> {
    const existing = this.getBoundScopeRegistry(access);
    if (existing) return existing;

    const registry = new Map<string, T>();
    if (this.isCurrentGeneration(access.scopeId, existing)) {
      this.registriesByScope.set(access.scopeId, registry);
    }
    this.updateRequestBinding(access, registry);
    return registry;
  }

  /**
   * Register an item for the current project.
   */
  register(id: string, item: T): void {
    this.registerScoped(id, item, null);
  }

  private registerScoped(
    id: string,
    item: T,
    ownerToken: object | null,
  ): RegistryScopeAccess {
    const access = this.getCurrentScopeAccess();
    const stage = this.getTransactionStage(access);
    const registry = stage?.registry ?? this.getScopeRegistry(access);

    if (stage) stage.validateRegistration(id, item);
    else this.validateScopedCandidateRegistration(registry, id, item);
    if (registry.has(id)) {
      agentLogger.debug(
        `[${this.registryName}] "${id}" already registered for scope ${access.scopeId}. Overwriting.`,
      );
    }

    registry.set(id, item);
    const mutation: RegistryMutation<T> = { type: "set", id, item, ownerToken };
    if (stage) stage.record(mutation);
    else if (this.isCurrentGeneration(access.scopeId, registry)) {
      let ownerTokens = this.ownerTokensByScope.get(access.scopeId);
      if (ownerToken) {
        if (!ownerTokens) {
          ownerTokens = new Map();
          this.ownerTokensByScope.set(access.scopeId, ownerTokens);
        }
        ownerTokens.set(id, ownerToken);
      } else {
        ownerTokens?.delete(id);
        if (ownerTokens?.size === 0) this.ownerTokensByScope.delete(access.scopeId);
      }
      this.recordLiveMutation(access.scopeId, mutation);
    }
    agentLogger.debug(`[${this.registryName}] Registered "${id}" for scope ${access.scopeId}`);
    return access;
  }

  /**
   * Register an item and return an idempotent disposer bound to this exact
   * registration generation.
   *
   * The disposer captures the canonical scope at registration time, so
   * lifecycle teardown does not depend on whichever request context happens to
   * be active later. It removes the entry only while the registered value is
   * still current; a subsequent replacement therefore remains owned by its
   * own lifecycle.
   */
  registerOwned(id: string, item: T): () => void {
    const ownerToken = {};
    const access = this.registerScoped(id, item, ownerToken);
    let disposed = false;

    return () => {
      if (disposed) return;

      const transaction = registryTransactionStorage.getStore();
      if (
        transaction?.state === "active" &&
        transaction.targetScopeId === access.scopeId
      ) {
        const stage = this.getTransactionStage(access);
        if (stage?.ownerTokens.get(id) !== ownerToken) return;
        stage.registry.delete(id);
        stage.record({ type: "delete", id });
        return;
      }

      const registry = this.registriesByScope.get(access.scopeId);
      const ownerTokens = this.ownerTokensByScope.get(access.scopeId);
      if (!registry || ownerTokens?.get(id) !== ownerToken) {
        disposed = true;
        return;
      }

      registry.delete(id);
      ownerTokens.delete(id);
      if (ownerTokens.size === 0) this.ownerTokensByScope.delete(access.scopeId);
      disposed = true;
      this.recordLiveMutation(access.scopeId, { type: "delete", id });
      if (registry.size === 0 && this.isCurrentGeneration(access.scopeId, registry)) {
        this.registriesByScope.delete(access.scopeId);
        this.ownerTokensByScope.delete(access.scopeId);
        this.updateRequestBinding(access, undefined);
      }
      agentLogger.debug(
        `[${this.registryName}] Disposed owned registration "${id}" from scope ${access.scopeId}`,
      );
    };
  }

  /**
   * Register a shared item available to all projects.
   * Use for framework-provided tools, not user-defined ones.
   */
  registerShared(id: string, item: T): void {
    // Shared framework infrastructure is intentionally process-wide and is
    // published immediately even inside a project transaction. Project
    // discovery must never use this method for tenant-owned definitions.
    this.validateSharedCandidateRegistration(id, item);
    if (this.sharedRegistry.has(id)) {
      agentLogger.debug(`[${this.registryName}] Shared "${id}" already registered. Overwriting.`);
    }

    this.sharedRegistry.set(id, item);
    agentLogger.debug(`[${this.registryName}] Registered shared "${id}"`);
  }

  /**
   * Get item for the current project.
   * Falls back to the shared registry only when the project registry does not
   * contain the id. A project registration whose value is `null` or
   * `undefined` still shadows a shared item with the same id.
   */
  get(id: string): T | undefined {
    const projectRegistry = this.getActiveScopeRegistry(
      this.getCurrentScopeAccess(),
    );
    if (projectRegistry?.has(id)) return projectRegistry.get(id);
    return this.sharedRegistry.get(id);
  }

  /**
   * Get item registered in the current project's own scope, without falling
   * back to the shared registry. Use this to distinguish a project-local
   * registration (which may legitimately shadow a shared item) from a true
   * same-scope duplicate.
   */
  getOwn(id: string): T | undefined {
    return this.getActiveScopeRegistry(this.getCurrentScopeAccess())?.get(id);
  }

  /**
   * Check if item exists for the current project.
   */
  has(id: string): boolean {
    return (this.getActiveScopeRegistry(this.getCurrentScopeAccess())?.has(id) ?? false) ||
      this.sharedRegistry.has(id);
  }

  /**
   * Test effective items without materializing the merged registry.
   *
   * Project items shadow shared items with the same id, matching `getAll()`.
   * Iteration stops after the first match.
   */
  some(predicate: (item: T, id: string) => boolean): boolean {
    const projectRegistry = this.getActiveScopeRegistry(
      this.getCurrentScopeAccess(),
    );

    for (const [id, sharedItem] of this.sharedRegistry) {
      const item = projectRegistry?.has(id) ? projectRegistry.get(id) as T : sharedItem;
      if (predicate(item, id)) return true;
    }

    if (!projectRegistry) return false;
    for (const [id, item] of projectRegistry) {
      if (this.sharedRegistry.has(id)) continue;
      if (predicate(item, id)) return true;
    }
    return false;
  }

  /**
   * Get all IDs for the current project (includes shared items).
   */
  getAllIds(): string[] {
    const projectIds = this.getActiveScopeRegistry(
      this.getCurrentScopeAccess(),
    )?.keys() ?? [];
    const sharedIds = this.sharedRegistry.keys();
    return Array.from(new Set([...projectIds, ...sharedIds]));
  }

  /**
   * Get all items for the current project (includes shared items).
   */
  getAll(): Map<string, T> {
    const projectRegistry = this.getActiveScopeRegistry(
      this.getCurrentScopeAccess(),
    );
    if (!projectRegistry) return cloneNativeMap(this.sharedRegistry);

    const result = cloneNativeMap(this.sharedRegistry);
    copyNativeMapEntries(projectRegistry, result);
    return result;
  }

  /**
   * Delete an item from the current project's registry.
   */
  delete(id: string): boolean {
    const access = this.getCurrentScopeAccess();
    const stage = this.getTransactionStage(access);
    const registry = stage?.registry ?? this.getBoundScopeRegistry(access);
    const isCurrentGeneration = !stage &&
      this.isCurrentGeneration(access.scopeId, registry);
    const existed = registry?.has(id) ?? false;
    if (
      !existed &&
      !stage &&
      !(isCurrentGeneration && this.activeStagesByScope.has(access.scopeId))
    ) {
      return false;
    }

    registry?.delete(id);
    const mutation: RegistryMutation<T> = { type: "delete", id };
    if (stage) stage.record(mutation);
    else if (isCurrentGeneration) {
      const ownerTokens = this.ownerTokensByScope.get(access.scopeId);
      ownerTokens?.delete(id);
      if (ownerTokens?.size === 0) this.ownerTokensByScope.delete(access.scopeId);
      this.recordLiveMutation(access.scopeId, mutation);
    }
    agentLogger.debug(
      `[${this.registryName}] Deleted "${id}" from scope ${access.scopeId}`,
    );
    return existed;
  }

  /**
   * Clear all items for the current project.
   */
  clear(): void {
    const access = this.getCurrentScopeAccess();
    const stage = this.getTransactionStage(access);
    if (stage) {
      stage.registry.clear();
      stage.record({ type: "clear" });
      return;
    }

    const registry = this.getBoundScopeRegistry(access);
    const isCurrentGeneration = this.isCurrentGeneration(access.scopeId, registry);
    registry?.clear();
    if (!isCurrentGeneration) return;

    const cleared = this.registriesByScope.delete(access.scopeId);
    this.ownerTokensByScope.delete(access.scopeId);
    this.updateRequestBinding(access, undefined);
    if (!cleared && !this.activeStagesByScope.has(access.scopeId)) return;

    this.recordLiveMutation(access.scopeId, { type: "clear" });
    if (cleared) {
      agentLogger.debug(
        `[${this.registryName}] Cleared registry for scope ${access.scopeId}`,
      );
    }
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

    invalidateProjectRegistryTransactions(projectId);
    let cleared = false;
    const scopeIds = new Set([
      ...this.registriesByScope.keys(),
      ...this.activeStagesByScope.keys(),
    ]);
    for (const scopeId of scopeIds) {
      if (isRegistryScopeForProject(scopeId, projectId)) {
        cleared = this.clearScopeForLifecycle(scopeId) || cleared;
      }
    }

    if (cleared) {
      agentLogger.debug(`[${this.registryName}] Cleared registry for project ${projectId}`);
    }
  }

  /**
   * Internal lifecycle hook used by canonical adapter/discovery ownership.
   *
   * The current map is detached rather than mutated so in-flight request
   * snapshots remain coherent until their request owner is released.
   */
  clearScopeForLifecycle(scopeId: string): boolean {
    const cleared = this.registriesByScope.delete(scopeId);
    this.ownerTokensByScope.delete(scopeId);
    if (!cleared && !this.activeStagesByScope.has(scopeId)) return false;
    this.recordLiveMutation(scopeId, { type: "clear" });
    return cleared;
  }

  /** Internal lifecycle inspection; returns a detached scope-id snapshot. */
  getScopeIdsForLifecycle(): string[] {
    return Array.from(
      new Set([
        ...this.registriesByScope.keys(),
        ...this.activeStagesByScope.keys(),
      ]),
    );
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
      invalidateRegistryTransaction(scopeId);
      this.recordLiveMutation(scopeId, { type: "clear" });
    }
    this.registriesByScope.clear();
    this.ownerTokensByScope.clear();
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
    const access = this.getCurrentScopeAccess();
    const totalItems = this.sharedRegistry.size +
      Array.from(this.registriesByScope.values()).reduce(
        (sum, registry) => sum + registry.size,
        0,
      );

    return {
      projectCount: this.registriesByScope.size,
      sharedCount: this.sharedRegistry.size,
      totalItems,
      currentProjectItems: this.getActiveScopeRegistry(access)?.size ?? 0,
    };
  }
}
