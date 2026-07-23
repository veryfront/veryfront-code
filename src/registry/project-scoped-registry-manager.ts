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
  registryScopeMatchesProject,
  tryGetRegistryScopeId,
} from "#veryfront/cache/cache-key-builder.ts";
import { INVALID_ARGUMENT, SERVICE_OVERLOADED } from "#veryfront/errors";
import { agentLogger } from "#veryfront/utils/logger/index.ts";
import { AsyncLocalStorage } from "node:async_hooks";

const DEFAULT_SCOPE_ID = "__default__";
const MAX_REGISTRY_NAME_LENGTH = 128;
const MAX_REGISTRY_IDENTIFIER_LENGTH = 4096;
const MAX_REGISTRY_SCOPE_ID_LENGTH = 16_384;
const DEFAULT_MAX_SCOPES = 1024;
const DEFAULT_MAX_ITEMS_PER_SCOPE = 2048;
const DEFAULT_MAX_TOTAL_ITEMS = 50_000;
const DEFAULT_MAX_SHARED_ITEMS = 2048;
const DEFAULT_MAX_MUTATIONS_PER_TRANSACTION = 10_000;
const MAX_CONFIGURED_CAPACITY = 100_000;
const MAX_TRANSACTION_LOCK_SCOPES = 1024;
const MAX_TRANSACTIONS_PER_SCOPE = 256;

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
  checkpoint(): number;
  rollback(checkpoint: number, savepoint: RegistrySavepoint): void;
}

interface ManagedRegistryTransactionStage<T> extends RegistryTransactionStage {
  readonly registry: Map<string, T>;
  assertCanRecord(mutation: RegistryMutation<T>): void;
  validateRegistration(id: string, incoming: T): void;
  record(mutation: RegistryMutation<T>): void;
}

/** Capacity and collision policy for a project-scoped registry manager. */
export interface ProjectScopedRegistryManagerOptions<T> {
  /**
   * Validate project or shared replacements. Must be side-effect free because
   * transaction preparation can invoke it again.
   */
  validateRegistration?(id: string, existing: T, incoming: T): void;
  /** Maximum number of non-empty project scopes retained by this manager. */
  maxScopes?: number;
  /** Maximum number of items retained in one project scope. */
  maxItemsPerScope?: number;
  /** Maximum number of shared and project items retained by this manager. */
  maxTotalItems?: number;
  /** Maximum number of process-wide shared items retained by this manager. */
  maxSharedItems?: number;
  /** Maximum ordered mutations retained while one transaction is staged. */
  maxMutationsPerTransaction?: number;
}

interface NormalizedProjectScopedRegistryManagerOptions<T> {
  readonly validateRegistration?: (id: string, existing: T, incoming: T) => void;
  readonly maxScopes: number;
  readonly maxItemsPerScope: number;
  readonly maxTotalItems: number;
  readonly maxSharedItems: number;
  readonly maxMutationsPerTransaction: number;
}

interface RegistryTransaction {
  readonly targetScopeId: string;
  readonly stages: Map<object, RegistryTransactionStage>;
  state: "active" | "committed" | "aborted";
}

interface RegistrySavepoint {
  state: "active" | "closed";
}

interface RecordedRegistryMutation<T> {
  readonly mutation: RegistryMutation<T>;
  readonly savepoints: readonly RegistrySavepoint[];
}

const registryTransactionStorage = new AsyncLocalStorage<RegistryTransaction>();
interface SharedRegistryMutationRestriction {
  readonly disabled: true;
}
const sharedRegistryMutationStorage = new AsyncLocalStorage<SharedRegistryMutationRestriction>();
const registrySavepointStorage = new AsyncLocalStorage<readonly RegistrySavepoint[]>();
interface RegistryTransactionLockQueue {
  depth: number;
  tail: Promise<void>;
}

const registryTransactionLocks = new Map<string, RegistryTransactionLockQueue>();

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function capacityExceeded(message: string): never {
  throw SERVICE_OVERLOADED.create({ message });
}

function assertSharedRegistryMutationAllowed(): void {
  if (sharedRegistryMutationStorage.getStore()) {
    invalidArgument("Project modules cannot mutate shared registries");
  }
}

function assertProcessWideRegistryAdministrationAllowed(): void {
  if (sharedRegistryMutationStorage.getStore()) {
    invalidArgument("Project modules cannot administer process-wide registries");
  }
}

function assertRegistryInitializationContextOpen(): void {
  if (registrySavepointStorage.getStore()?.some((savepoint) => savepoint.state !== "active")) {
    invalidArgument("Project module registry initialization context is closed");
  }
}

function hasUnsafeCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const trailing = value.charCodeAt(index + 1);
      if (trailing < 0xdc00 || trailing > 0xdfff) return true;
      index++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
    if (
      code <= 31 || (code >= 127 && code <= 159) || code === 0x061c ||
      code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function assertBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== "string" || value.length === 0 || value.length > maxLength ||
    hasUnsafeCharacters(value)
  ) {
    invalidArgument(
      `${label} must be a non-empty string within the supported length and without unsafe characters`,
    );
  }
}

function readOption(
  options: object,
  key: keyof ProjectScopedRegistryManagerOptions<unknown>,
): unknown {
  try {
    return Reflect.get(options, key);
  } catch {
    invalidArgument("Registry manager options must be readable");
  }
}

function isArrayOption(value: object, errorMessage: string): boolean {
  try {
    return Array.isArray(value);
  } catch {
    invalidArgument(errorMessage);
  }
}

function normalizeCapacityOption(
  value: unknown,
  defaultValue: number,
  label: string,
): number {
  if (value === undefined) return defaultValue;
  if (
    typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 ||
    value > MAX_CONFIGURED_CAPACITY
  ) {
    invalidArgument(`${label} must be a positive safe integer within the supported range`);
  }
  return value;
}

function normalizeManagerOptions<T>(
  value: ProjectScopedRegistryManagerOptions<T>,
): NormalizedProjectScopedRegistryManagerOptions<T> {
  if (
    typeof value !== "object" || value === null ||
    isArrayOption(value, "Registry manager options must be readable")
  ) {
    invalidArgument("Registry manager options must be an object");
  }

  const options = value as object;
  const validateRegistration = readOption(options, "validateRegistration");
  if (validateRegistration !== undefined && typeof validateRegistration !== "function") {
    invalidArgument("Registry registration validator must be a function");
  }

  return Object.freeze({
    validateRegistration: validateRegistration as
      | ((id: string, existing: T, incoming: T) => void)
      | undefined,
    maxScopes: normalizeCapacityOption(
      readOption(options, "maxScopes"),
      DEFAULT_MAX_SCOPES,
      "Registry scope capacity",
    ),
    maxItemsPerScope: normalizeCapacityOption(
      readOption(options, "maxItemsPerScope"),
      DEFAULT_MAX_ITEMS_PER_SCOPE,
      "Registry per-scope item capacity",
    ),
    maxTotalItems: normalizeCapacityOption(
      readOption(options, "maxTotalItems"),
      DEFAULT_MAX_TOTAL_ITEMS,
      "Registry total item capacity",
    ),
    maxSharedItems: normalizeCapacityOption(
      readOption(options, "maxSharedItems"),
      DEFAULT_MAX_SHARED_ITEMS,
      "Registry shared item capacity",
    ),
    maxMutationsPerTransaction: normalizeCapacityOption(
      readOption(options, "maxMutationsPerTransaction"),
      DEFAULT_MAX_MUTATIONS_PER_TRANSACTION,
      "Registry transaction mutation capacity",
    ),
  });
}

async function acquireRegistryTransactionLock(scopeId: string): Promise<() => void> {
  let queue = registryTransactionLocks.get(scopeId);
  if (!queue) {
    if (registryTransactionLocks.size >= MAX_TRANSACTION_LOCK_SCOPES) {
      capacityExceeded("Registry transaction scope capacity exceeded");
    }
    queue = { depth: 0, tail: Promise.resolve() };
    registryTransactionLocks.set(scopeId, queue);
  }
  if (queue.depth >= MAX_TRANSACTIONS_PER_SCOPE) {
    capacityExceeded("Registry transaction queue capacity exceeded");
  }

  const previous = queue.tail;
  let resolveGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  queue.depth++;
  queue.tail = previous.then(() => gate);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    resolveGate();
    queue.depth--;
    if (queue.depth === 0 && registryTransactionLocks.get(scopeId) === queue) {
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
  const scopeId = tryGetRegistryScopeId() ?? DEFAULT_SCOPE_ID;
  assertBoundedString(scopeId, "Registry scope ID", MAX_REGISTRY_SCOPE_ID_LENGTH);
  return scopeId;
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
  if (typeof fn !== "function") {
    invalidArgument("Registry transaction callback must be a function");
  }
  assertRegistryInitializationContextOpen();
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
 * Isolate registry mutations made by a project-module initializer while
 * preserving the surrounding discovery transaction and live writes. Failed
 * callbacks always roll back. Successful callbacks can also be treated as a
 * sandbox when `rollbackOnSuccess` is enabled.
 */
export async function runWithRegistryTransactionSavepoint<T>(
  fn: () => Promise<T>,
  options: { rollbackOnSuccess?: boolean } = {},
): Promise<T> {
  if (typeof fn !== "function") {
    invalidArgument("Registry savepoint callback must be a function");
  }
  if (
    typeof options !== "object" || options === null ||
    isArrayOption(options, "Registry savepoint options must be readable")
  ) {
    invalidArgument("Registry savepoint options must be a valid object");
  }
  let rollbackOnSuccess: unknown;
  try {
    rollbackOnSuccess = Reflect.get(options, "rollbackOnSuccess");
  } catch {
    invalidArgument("Registry savepoint options must be readable");
  }
  if (rollbackOnSuccess !== undefined && typeof rollbackOnSuccess !== "boolean") {
    invalidArgument("Registry savepoint options must be a valid object");
  }
  assertRegistryInitializationContextOpen();
  const transaction = registryTransactionStorage.getStore();
  if (!transaction || transaction.state !== "active") {
    invalidArgument("Registry savepoints require an active transaction");
  }

  const parentAncestry = registrySavepointStorage.getStore() ?? [];
  const savepoint: RegistrySavepoint = {
    state: "active",
  };
  const ancestry = [...parentAncestry, savepoint];
  const checkpoints = new Map<object, number>();
  for (const [manager, stage] of transaction.stages) {
    checkpoints.set(manager, stage.checkpoint());
  }

  const rollback = () => {
    for (const [manager, stage] of transaction.stages) {
      stage.rollback(checkpoints.get(manager) ?? 0, savepoint);
    }
  };

  try {
    const result = await registrySavepointStorage.run(ancestry, fn);
    if (rollbackOnSuccess) rollback();
    return result;
  } catch (error) {
    rollback();
    throw error;
  } finally {
    savepoint.state = "closed";
  }
}

/**
 * Run project-authored module initialization without process-wide registry
 * administration privileges. The context propagates through asynchronous work
 * created by the module.
 */
export function runWithSharedRegistryMutationsDisabled<T>(fn: () => T): T {
  if (typeof fn !== "function") {
    invalidArgument("Shared registry mutation policy callback must be a function");
  }
  if (sharedRegistryMutationStorage.getStore()) return fn();
  return sharedRegistryMutationStorage.run({ disabled: true }, fn);
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
  private readonly options: NormalizedProjectScopedRegistryManagerOptions<T>;

  /** Create a manager with a stable logical name and bounded storage policy. */
  constructor(
    registryName: string,
    options: ProjectScopedRegistryManagerOptions<T> = {},
  ) {
    assertBoundedString(registryName, "Registry name", MAX_REGISTRY_NAME_LENGTH);
    this.options = normalizeManagerOptions(options);
  }

  /** Validate a registry item identifier at every public lookup and mutation boundary. */
  private assertItemId(id: unknown): asserts id is string {
    assertBoundedString(id, "Registry item ID", MAX_REGISTRY_IDENTIFIER_LENGTH);
  }

  /** Count shared and project-scoped items retained in live storage. */
  private getRetainedItemCount(): number {
    let count = this.sharedRegistry.size;
    for (const registry of this.registriesByScope.values()) count += registry.size;
    return count;
  }

  /** Reject creation of a project scope beyond the configured scope capacity. */
  private assertCanCreateScope(scopeId: string): void {
    if (
      !this.registriesByScope.has(scopeId) &&
      this.registriesByScope.size >= this.options.maxScopes
    ) {
      capacityExceeded("Registry scope capacity exceeded");
    }
  }

  /** Reject a new live item that would exceed per-scope or total capacity. */
  private assertCanAddLiveItem(registry: Map<string, T>, id: string): void {
    if (registry.has(id)) return;
    if (registry.size >= this.options.maxItemsPerScope) {
      capacityExceeded("Registry per-scope item capacity exceeded");
    }
    if (this.getRetainedItemCount() >= this.options.maxTotalItems) {
      capacityExceeded("Registry total item capacity exceeded");
    }
  }

  /** Reject a staged replacement that cannot fit in live storage. */
  private assertCanPublishScope(scopeId: string, replacementSize: number): void {
    if (replacementSize === 0) return;
    this.assertCanCreateScope(scopeId);
    if (replacementSize > this.options.maxItemsPerScope) {
      capacityExceeded("Registry per-scope item capacity exceeded");
    }

    const liveSize = this.registriesByScope.get(scopeId)?.size ?? 0;
    const projectedTotal = this.getRetainedItemCount() - liveSize + replacementSize;
    if (projectedTotal > this.options.maxTotalItems) {
      capacityExceeded("Registry total item capacity exceeded");
    }
  }

  /** Calculate the scope size after one ordered mutation. */
  private projectedReplacementSize(
    registry: Map<string, T>,
    mutation: RegistryMutation<T>,
  ): number {
    switch (mutation.type) {
      case "clear":
        return 0;
      case "delete":
        return registry.size - (registry.has(mutation.id) ? 1 : 0);
      case "set":
        return registry.size + (registry.has(mutation.id) ? 0 : 1);
    }
  }

  /** Apply the configured collision policy when an identifier already exists. */
  private validateRegistration(
    registry: Map<string, T>,
    id: string,
    incoming: T,
  ): void {
    if (!registry.has(id)) return;
    this.options.validateRegistration?.(id, registry.get(id) as T, incoming);
  }

  /** Apply one mutation to a registry map. */
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
    assertRegistryInitializationContextOpen();
    if (transaction.state === "committed") return undefined;
    if (transaction.state === "aborted") {
      invalidArgument("Registry transaction is already aborted");
    }

    if (scopeId !== transaction.targetScopeId) {
      invalidArgument("Registry scope changed during transaction");
    }

    const existing = transaction.stages.get(this) as
      | ManagedRegistryTransactionStage<T>
      | undefined;
    if (existing) return existing;

    const baseRegistry = new Map(this.registriesByScope.get(scopeId));
    const registry = new Map(baseRegistry);
    const validationRegistry = new Map(baseRegistry);
    const mutations: RecordedRegistryMutation<T>[] = [];
    let closed = false;

    const assertCanRecord = (mutation: RegistryMutation<T>) => {
      if (mutations.length >= this.options.maxMutationsPerTransaction) {
        capacityExceeded("Registry transaction mutation capacity exceeded");
      }
      const projectedSize = this.projectedReplacementSize(validationRegistry, mutation);
      this.assertCanPublishScope(scopeId, projectedSize);
    };

    const close = () => {
      if (closed) return;
      closed = true;
      const activeStages = this.activeStagesByScope.get(scopeId);
      activeStages?.delete(stage);
      if (activeStages?.size === 0) this.activeStagesByScope.delete(scopeId);
    };

    const stage: ManagedRegistryTransactionStage<T> = {
      registry,
      assertCanRecord,
      validateRegistration: (id, incoming) => {
        this.validateRegistration(validationRegistry, id, incoming);
      },
      record: (mutation) => {
        assertCanRecord(mutation);
        mutations.push({
          mutation,
          savepoints: [...(registrySavepointStorage.getStore() ?? [])],
        });
        this.applyMutation(validationRegistry, mutation);
        this.applyMutation(registry, mutation);
      },
      prepare: () => {
        const replacement = new Map(baseRegistry);
        for (const recorded of mutations) {
          this.applyMutation(replacement, recorded.mutation, true);
        }
        this.assertCanPublishScope(scopeId, replacement.size);

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
      checkpoint: () => mutations.length,
      rollback: (checkpoint, savepoint) => {
        const retained = mutations.filter((recorded, index) =>
          index < checkpoint || !recorded.savepoints.includes(savepoint)
        );
        mutations.length = 0;
        mutations.push(...retained);

        registry.clear();
        validationRegistry.clear();
        for (const [id, item] of baseRegistry) {
          registry.set(id, item);
          validationRegistry.set(id, item);
        }
        for (const recorded of mutations) {
          this.applyMutation(registry, recorded.mutation);
          this.applyMutation(validationRegistry, recorded.mutation);
        }
      },
      abort: close,
    };
    transaction.stages.set(this, stage);
    const activeStages = this.activeStagesByScope.get(scopeId) ?? new Set();
    activeStages.add(stage);
    this.activeStagesByScope.set(scopeId, activeStages);
    return stage;
  }

  /**
   * Preflight a live mutation against every in-flight transaction journal.
   * Calling the returned function cannot fail, so callers can publish the
   * journal entry and live mutation as one synchronous operation.
   */
  private prepareLiveMutation(
    scopeId: string,
    mutation: RegistryMutation<T>,
  ): () => void {
    const stages = Array.from(this.activeStagesByScope.get(scopeId) ?? []);
    for (const stage of stages) stage.assertCanRecord(mutation);
    return () => {
      for (const stage of stages) stage.record(mutation);
    };
  }

  /** Read the active registry, routing transaction access to its staged copy. */
  private getActiveScopeRegistry(scopeId: string): Map<string, T> | undefined {
    return this.getTransactionStage(scopeId)?.registry ?? this.registriesByScope.get(scopeId);
  }

  /**
   * Register an item for the current project.
   */
  register(id: string, item: T): void {
    this.assertItemId(id);
    const scopeId = this.getCurrentScopeId();
    const stage = this.getTransactionStage(scopeId);
    const mutation: RegistryMutation<T> = { type: "set", id, item };

    if (stage) {
      stage.validateRegistration(id, item);
      const replaced = stage.registry.has(id);
      stage.record(mutation);
      agentLogger.debug(replaced ? "Registry item replaced" : "Registry item registered", {
        scope_item_count: stage.registry.size,
      });
      return;
    }

    const existingRegistry = this.registriesByScope.get(scopeId);
    const registry = existingRegistry ?? new Map<string, T>();
    this.assertCanCreateScope(scopeId);
    this.assertCanAddLiveItem(registry, id);
    this.validateRegistration(registry, id, item);
    const replaced = registry.has(id);
    const publishJournal = this.prepareLiveMutation(scopeId, mutation);
    publishJournal();
    if (!existingRegistry) this.registriesByScope.set(scopeId, registry);
    registry.set(id, item);
    agentLogger.debug(replaced ? "Registry item replaced" : "Registry item registered", {
      scope_item_count: registry.size,
    });
  }

  /**
   * Register a shared item available to all projects.
   * Use for framework-provided tools, not user-defined ones.
   */
  registerShared(id: string, item: T): void {
    this.assertItemId(id);
    assertSharedRegistryMutationAllowed();
    // Shared framework infrastructure is intentionally process-wide and is
    // published immediately even inside a project transaction. Project
    // discovery must never use this method for tenant-owned definitions.
    const replaced = this.sharedRegistry.has(id);
    this.validateRegistration(this.sharedRegistry, id, item);
    if (!replaced) {
      if (this.sharedRegistry.size >= this.options.maxSharedItems) {
        capacityExceeded("Registry shared item capacity exceeded");
      }
      if (this.getRetainedItemCount() >= this.options.maxTotalItems) {
        capacityExceeded("Registry total item capacity exceeded");
      }
    }

    this.sharedRegistry.set(id, item);
    agentLogger.debug(
      replaced ? "Shared registry item replaced" : "Shared registry item registered",
      { shared_item_count: this.sharedRegistry.size },
    );
  }

  /** Get a process-wide shared item without project-scope fallback. */
  getShared(id: string): T | undefined {
    this.assertItemId(id);
    return this.sharedRegistry.get(id);
  }

  /** Check whether a process-wide shared item exists. */
  hasShared(id: string): boolean {
    this.assertItemId(id);
    return this.sharedRegistry.has(id);
  }

  /** Delete a process-wide shared item outside restricted project code. */
  deleteShared(id: string): boolean {
    this.assertItemId(id);
    assertSharedRegistryMutationAllowed();
    return this.sharedRegistry.delete(id);
  }

  /**
   * Get item for the current project.
   * Falls back to shared registry for items not found in project registry.
   */
  get(id: string): T | undefined {
    this.assertItemId(id);
    const scopeId = this.getCurrentScopeId();
    const projectRegistry = this.getActiveScopeRegistry(scopeId);
    return projectRegistry?.has(id) ? projectRegistry.get(id) : this.sharedRegistry.get(id);
  }

  /**
   * Get item registered in the current project's own scope, without falling
   * back to the shared registry. Pair this with `hasOwn()` when `undefined` is
   * a valid registered value and membership must be distinguished from absence.
   */
  getOwn(id: string): T | undefined {
    this.assertItemId(id);
    const scopeId = this.getCurrentScopeId();
    return this.getActiveScopeRegistry(scopeId)?.get(id);
  }

  /** Check whether the current project's own scope contains an item. */
  hasOwn(id: string): boolean {
    this.assertItemId(id);
    const scopeId = this.getCurrentScopeId();
    return this.getActiveScopeRegistry(scopeId)?.has(id) ?? false;
  }

  /**
   * Check if item exists for the current project.
   */
  has(id: string): boolean {
    this.assertItemId(id);
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
    this.assertItemId(id);
    const scopeId = this.getCurrentScopeId();
    const stage = this.getTransactionStage(scopeId);
    const registry = stage?.registry ?? this.registriesByScope.get(scopeId);
    const existed = registry?.has(id) ?? false;
    if (!existed && !stage && !this.activeStagesByScope.has(scopeId)) return false;

    const mutation: RegistryMutation<T> = { type: "delete", id };
    if (stage) {
      stage.record(mutation);
    } else {
      const publishJournal = this.prepareLiveMutation(scopeId, mutation);
      publishJournal();
      registry?.delete(id);
      if (registry?.size === 0) this.registriesByScope.delete(scopeId);
    }
    agentLogger.debug("Registry item deletion processed", { item_existed: existed });
    return existed;
  }

  /** Clear live and staged scopes selected by an exact structured-scope predicate. */
  private clearMatchingScopes(matches: (scopeId: string) => boolean): void {
    const scopeIds = new Set([
      ...this.registriesByScope.keys(),
      ...this.activeStagesByScope.keys(),
    ]);
    const pendingClears: Array<{ scopeId: string; publishJournal: () => void }> = [];
    for (const scopeId of scopeIds) {
      if (matches(scopeId)) {
        pendingClears.push({
          scopeId,
          publishJournal: this.prepareLiveMutation(scopeId, { type: "clear" }),
        });
      }
    }

    for (const pending of pendingClears) pending.publishJournal();
    let clearedScopeCount = 0;
    for (const pending of pendingClears) {
      if (this.registriesByScope.delete(pending.scopeId)) clearedScopeCount++;
    }
    if (pendingClears.length > 0) {
      agentLogger.debug("Project registry scopes cleared", {
        cleared_scope_count: clearedScopeCount,
      });
    }
  }

  /**
   * Clear all items for the current project.
   */
  clear(): void {
    const scopeId = this.getCurrentScopeId();
    const stage = this.getTransactionStage(scopeId);
    if (stage) {
      stage.record({ type: "clear" });
      return;
    }
    this.clearMatchingScopes((candidateScopeId) => candidateScopeId === scopeId);
  }

  /**
   * Clear every structured scope owned by one exact project ID.
   */
  clearProject(projectId: string): void {
    assertBoundedString(projectId, "Project registry ID", MAX_REGISTRY_IDENTIFIER_LENGTH);
    assertProcessWideRegistryAdministrationAllowed();
    const transaction = registryTransactionStorage.getStore();
    if (transaction && transaction.state !== "committed") {
      invalidArgument("clearProject() is not supported during a registry transaction");
    }

    this.clearMatchingScopes((scopeId) => registryScopeMatchesProject(scopeId, projectId));
  }

  /**
   * Clear every project scope and shared item outside restricted project code.
   */
  clearAll(): void {
    assertProcessWideRegistryAdministrationAllowed();
    const transaction = registryTransactionStorage.getStore();
    if (transaction && transaction.state !== "committed") {
      invalidArgument("clearAll() is not supported during a registry transaction");
    }

    const scopeIds = new Set([
      ...this.registriesByScope.keys(),
      ...this.activeStagesByScope.keys(),
    ]);
    const publishJournals = Array.from(
      scopeIds,
      (scopeId) => this.prepareLiveMutation(scopeId, { type: "clear" }),
    );
    for (const publishJournal of publishJournals) publishJournal();
    const clearedScopeCount = this.registriesByScope.size;
    const clearedSharedCount = this.sharedRegistry.size;
    this.registriesByScope.clear();
    this.sharedRegistry.clear();
    agentLogger.debug("All registry items cleared", {
      cleared_scope_count: clearedScopeCount,
      cleared_shared_count: clearedSharedCount,
    });
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
    const liveRegistry = this.registriesByScope.get(scopeId);
    const activeRegistry = this.getActiveScopeRegistry(scopeId);
    const liveItemCount = liveRegistry?.size ?? 0;
    const activeItemCount = activeRegistry?.size ?? 0;
    const totalItems = this.getRetainedItemCount() - liveItemCount + activeItemCount;
    let projectCount = this.registriesByScope.size;
    if (!liveRegistry && activeItemCount > 0) projectCount++;
    if (liveRegistry && activeItemCount === 0) projectCount--;

    return {
      projectCount,
      sharedCount: this.sharedRegistry.size,
      totalItems,
      currentProjectItems: activeItemCount,
    };
  }
}
