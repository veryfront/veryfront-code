/**
 * Extension loader — topological sort, lifecycle management, preset flattening.
 *
 * @module extensions/loader
 */

import {
  CIRCULAR_DEPENDENCY_ERROR,
  EXTENSION_CONFLICT_ERROR,
  EXTENSION_SETUP_TIMEOUT_ERROR,
  EXTENSION_VALIDATION_ERROR,
} from "./errors.ts";
import { register, reset, resolve as resolveContract, tryResolve } from "./contracts.ts";
import { auditCapabilities } from "./capabilities.ts";
import {
  detectConflicts,
  selectContractProviders,
  SOURCE_PRIORITY,
  validateExtension,
} from "./validation.ts";
import type { Extension, ExtensionContext, ExtensionLogger, ResolvedExtension } from "./types.ts";

const DEFAULT_SETUP_TIMEOUT_MS = 30_000;
// JavaScript runtimes clamp larger delays to an implementation-specific short
// delay (Node uses 1 ms), which would turn an oversized safety timeout into an
// immediate failure.
const MAX_SETUP_TIMEOUT_MS = 2_147_483_647;

interface ContextAuthority {
  active: boolean;
  readonly controller: AbortController;
  readonly extensionName: string;
}

interface SetupRecord {
  readonly resolved: ResolvedExtension;
  authority?: ContextAuthority;
  setupState?: "pending" | "settled";
  setupSettled?: Promise<void>;
}

interface LoadPlan {
  readonly loadOrder: ResolvedExtension[];
  readonly contractWinner: Map<string, ResolvedExtension>;
}

class ExtensionSetupTimeoutFailure extends Error {
  constructor(
    readonly resolved: ResolvedExtension,
    readonly timeoutMs: number,
  ) {
    super(`Extension setup timed out after ${timeoutMs}ms`);
    this.name = "ExtensionSetupTimeoutFailure";
  }
}

/** Options for {@link ExtensionLoader.setupAll}. */
export interface SetupAllOptions {
  /**
   * Per-extension setup() timeout in milliseconds.
   * Defaults to 30 000 ms. Pass `0` to disable.
   */
  setupTimeoutMs?: number;
  /**
   * @internal Runs after the candidate plan is fully preflighted but before
   * any current generation is torn down or candidate side effects begin.
   * Reserved for the process-wide orchestration coordinator.
   */
  beforeActivate?: () => void | Promise<void>;
}

/**
 * Implement extension loader.
 *
 * Direct loader instances share the process-global contract registry and must
 * not run overlapping generations. Production callers should use
 * `orchestrateExtensions()`, which coordinates generation ownership.
 */
export class ExtensionLoader {
  private readonly logger: ExtensionLogger;
  private setupOrder: SetupRecord[] = [];
  private primed: Record<string, unknown> = {};
  private ownsContracts = false;
  private lifecycleTail: Promise<void> = Promise.resolve();
  private readonly lateSetups = new Set<Promise<void>>();
  private quarantineFailure: unknown;

  constructor(logger: ExtensionLogger) {
    this.logger = logger;
  }

  /**
   * Register contracts that will be re-applied after each `setupAll()`
   * teardown pass. Used by `orchestrateExtensions()` to seed infrastructure
   * (e.g. `LLMProviderRegistry`) before per-extension `setup()` runs.
   */
  primeContracts(contracts: Record<string, unknown>): void {
    this.primed = { ...this.primed, ...contracts };
  }

  /**
   * Flatten presets: extensions with `extends` are replaced by their children.
   * Recurses through nested presets; throws on cyclic `extends` graphs rather
   * than stack-overflowing.
   */
  flattenPresets(extensions: ResolvedExtension[]): ResolvedExtension[] {
    return this.flattenPresetsInner(extensions, new Set());
  }

  private flattenPresetsInner(
    extensions: ResolvedExtension[],
    path: Set<Extension>,
  ): ResolvedExtension[] {
    const result: ResolvedExtension[] = [];

    for (const resolved of extensions) {
      const candidate = resolved.extension as unknown;
      this.assertValidExtension(candidate);
      const ext = candidate;

      if (ext.extends && ext.extends.length > 0) {
        if (path.has(ext)) {
          throw EXTENSION_VALIDATION_ERROR.create({
            message: `Circular preset extends chain detected via "${ext.name}"`,
          });
        }
        path.add(ext);
        const children = ext.extends.map((child) => ({
          extension: child,
          source: resolved.source,
          origin: resolved.origin,
        }));
        result.push(...this.flattenPresetsInner(children, path));
        path.delete(ext);
      } else {
        result.push(resolved);
      }
    }

    return result;
  }

  /**
   * Topological sort: priority-winning providers load before consumers.
   * Throws on duplicate names at equal priority and circular dependencies.
   */
  topologicalSort(extensions: ResolvedExtension[]): ResolvedExtension[] {
    for (const resolved of extensions) {
      this.assertValidExtension(resolved.extension as unknown);
    }
    const normalized = this.normalizeExtensionNames(extensions);
    const contractWinner = selectContractProviders(normalized);
    return this.topologicalSortWithProviders(normalized, contractWinner);
  }

  private topologicalSortWithProviders(
    extensions: ResolvedExtension[],
    contractWinner: Map<string, ResolvedExtension>,
  ): ResolvedExtension[] {
    const providerOf = new Map<string, string>();
    const extByName = new Map<string, ResolvedExtension>();
    const consumesContracts = new Map<string, string[]>();

    for (const [contract, provider] of contractWinner) {
      providerOf.set(contract, provider.extension.name);
    }

    for (const resolved of extensions) {
      const ext = resolved.extension;
      extByName.set(ext.name, resolved);
      const contracts = requiredContractNames(ext);
      if (contracts.length > 0) {
        consumesContracts.set(ext.name, contracts);
      }
    }

    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const resolved of extensions) {
      const name = resolved.extension.name;
      graph.set(name, new Set());
      inDegree.set(name, 0);
    }

    for (const [consumer, contracts] of consumesContracts) {
      for (const contract of contracts) {
        const provider = providerOf.get(contract);
        if (provider && provider !== consumer) {
          const edges = graph.get(provider)!;
          if (!edges.has(consumer)) {
            edges.add(consumer);
            inDegree.set(consumer, (inDegree.get(consumer) ?? 0) + 1);
          }
        }
      }
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: ResolvedExtension[] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      sorted.push(extByName.get(name)!);

      for (const dependent of graph.get(name) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }

    if (sorted.length !== extensions.length) {
      const sortedNames = new Set(sorted.map((resolved) => resolved.extension.name));
      const unsorted = extensions
        .filter((resolved) => !sortedNames.has(resolved.extension.name))
        .map((resolved) => resolved.extension.name);
      throw CIRCULAR_DEPENDENCY_ERROR.create({
        message: `Circular extension dependency detected among: ${unsorted.join(", ")}`,
      });
    }

    return sorted;
  }

  private normalizeExtensionNames(extensions: ResolvedExtension[]): ResolvedExtension[] {
    const winnerByName = new Map<string, ResolvedExtension>();

    for (const resolved of extensions) {
      const name = resolved.extension.name;
      const current = winnerByName.get(name);
      if (!current) {
        winnerByName.set(name, resolved);
        continue;
      }

      const currentPriority = SOURCE_PRIORITY[current.source];
      const candidatePriority = SOURCE_PRIORITY[resolved.source];
      if (candidatePriority < currentPriority) {
        winnerByName.set(name, resolved);
      } else if (
        candidatePriority === currentPriority &&
        current.extension !== resolved.extension
      ) {
        throw EXTENSION_CONFLICT_ERROR.create({
          message: `Duplicate extension name "${name}" from source "${resolved.source}"`,
        });
      }
    }

    const emitted = new Set<string>();
    return extensions.filter((resolved) => {
      const name = resolved.extension.name;
      if (emitted.has(name) || winnerByName.get(name) !== resolved) return false;
      emitted.add(name);
      return true;
    });
  }

  /**
   * Run the full setup lifecycle for all extensions.
   * Calls on the same loader are serialized; a valid replacement tears down
   * the previous generation before activation.
   */
  setupAll(
    extensions: ResolvedExtension[],
    projectConfig: Record<string, unknown>,
    options?: SetupAllOptions,
  ): Promise<void> {
    const requestedExtensions = [...extensions];
    const requestedOptions = options ? { ...options } : undefined;
    return this.enqueueLifecycle(() =>
      this.setupAllInternal(requestedExtensions, projectConfig, requestedOptions)
    );
  }

  private async setupAllInternal(
    extensions: ResolvedExtension[],
    projectConfig: Record<string, unknown>,
    options?: SetupAllOptions,
  ): Promise<void> {
    const timeoutMs = this.normalizeSetupTimeout(options?.setupTimeoutMs);
    const { loadOrder, contractWinner } = this.prepareLoadPlan(extensions);

    // A timed-out setup can keep running after Promise.race settles. Do not
    // activate a replacement until that work settles and receives a final
    // cleanup pass, or it could mutate resources owned by the new generation.
    await this.waitForLateSetups();
    await options?.beforeActivate?.();
    await this.teardownAllInternal();

    try {
      for (const [name, impl] of Object.entries(this.primed)) {
        this.registerOwned(name, impl);
      }

      for (const resolved of loadOrder) {
        const ext = resolved.extension;
        auditCapabilities(ext.name, ext.capabilities, this.logger);

        // Track the extension before any registration or setup side effect so
        // the first extension receives the same rollback guarantees as later
        // extensions.
        const record: SetupRecord = { resolved };
        this.setupOrder.push(record);

        if (ext.provides) {
          for (const [contract, impl] of Object.entries(ext.provides)) {
            if (contractWinner.get(contract) === resolved) {
              this.registerOwned(contract, impl);
            }
          }
        }

        if (ext.setup) {
          const authority: ContextAuthority = {
            active: true,
            controller: new AbortController(),
            extensionName: ext.name,
          };
          record.authority = authority;
          const context = this.createExtensionContext(
            resolved,
            authority,
            projectConfig,
            contractWinner,
          );
          await this.runExtensionSetup(record, context, timeoutMs);
        }

        this.assertWinningContractsWereProvided(resolved, contractWinner);

        this.logger.info(`Extension "${ext.name}" v${ext.version} loaded from ${resolved.source}`);
      }
    } catch (error) {
      const rollback = this.teardownAllInternal();

      if (error instanceof ExtensionSetupTimeoutFailure) {
        // Reject on the setup deadline even when a teardown hook hangs. The
        // rollback and any late second-pass cleanup remain one quarantine
        // barrier that every later generation must await.
        this.trackTimedOutCleanup(rollback);
        throw EXTENSION_SETUP_TIMEOUT_ERROR.create({
          message:
            `Extension "${error.resolved.extension.name}" setup() timed out after ${error.timeoutMs}ms`,
          detail:
            `Extension "${error.resolved.extension.name}" setup() did not complete within ${error.timeoutMs}ms`,
        });
      }

      try {
        await rollback;
      } catch (rollbackError) {
        throw combineLifecycleFailures(error, rollbackError);
      }
      throw error;
    }
  }

  private prepareLoadPlan(extensions: ResolvedExtension[]): LoadPlan {
    const flattened = this.flattenPresets(extensions);
    const normalized = this.normalizeExtensionNames(flattened);
    const conflicts = detectConflicts(normalized);
    if (conflicts.length > 0) {
      const details = conflicts
        .map((conflict) =>
          `"${conflict.contract}" provided by: ${
            conflict.providers.map((provider) => provider.name).join(", ")
          }`
        )
        .join("; ");
      throw EXTENSION_CONFLICT_ERROR.create({
        message: `Extension conflicts detected: ${details}`,
      });
    }

    const contractWinner = selectContractProviders(normalized);
    this.assertRequiredContractsAvailable(normalized, contractWinner);
    return {
      loadOrder: this.topologicalSortWithProviders(normalized, contractWinner),
      contractWinner,
    };
  }

  private assertRequiredContractsAvailable(
    extensions: ResolvedExtension[],
    contractWinner: Map<string, ResolvedExtension>,
  ): void {
    const missing: Array<{ extension: string; contract: string }> = [];
    for (const { extension } of extensions) {
      for (const contract of requiredContractNames(extension)) {
        if (
          contractWinner.has(contract) ||
          Object.prototype.hasOwnProperty.call(this.primed, contract)
        ) continue;
        missing.push({ extension: extension.name, contract });
      }
    }
    if (missing.length === 0) return;

    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Required extension contracts are unavailable: ${
        missing.map(({ extension, contract }) => `"${extension}" requires "${contract}"`).join(
          ", ",
        )
      }`,
    });
  }

  private assertWinningContractsWereProvided(
    resolved: ResolvedExtension,
    contractWinner: Map<string, ResolvedExtension>,
  ): void {
    const missing = (resolved.extension.contracts?.provides ?? []).filter((contract) =>
      contractWinner.get(contract) === resolved && tryResolve(contract) === undefined
    );
    if (missing.length === 0) return;

    throw EXTENSION_VALIDATION_ERROR.create({
      message:
        `Extension "${resolved.extension.name}" completed setup without providing declared contract${
          missing.length === 1 ? "" : "s"
        }: ${missing.map((contract) => `"${contract}"`).join(", ")}`,
    });
  }

  private normalizeSetupTimeout(value: number | undefined): number {
    if (value === undefined) return DEFAULT_SETUP_TIMEOUT_MS;
    if (
      typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 ||
      value > MAX_SETUP_TIMEOUT_MS
    ) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message:
          `setupTimeoutMs must be an integer between 0 and ${MAX_SETUP_TIMEOUT_MS} milliseconds`,
      });
    }
    return value;
  }

  private createExtensionContext(
    resolved: ResolvedExtension,
    authority: ContextAuthority,
    projectConfig: Record<string, unknown>,
    contractWinner: Map<string, ResolvedExtension>,
  ): ExtensionContext {
    return {
      get: <T>(contract: string): T | undefined => {
        if (!authority.active) return undefined;
        return tryResolve<T>(contract);
      },
      require: <T>(contract: string): T => {
        if (!authority.active) {
          throw new Error(
            `Extension context for "${authority.extensionName}" is no longer active`,
          );
        }
        return resolveContract<T>(contract);
      },
      provide: <T>(contract: string, impl: T): void => {
        if (!authority.active) {
          this.logger.warn(
            `Ignoring provide("${contract}") from "${authority.extensionName}": its context is no longer active`,
          );
          return;
        }
        const winner = contractWinner.get(contract);
        if (!winner || winner === resolved) {
          this.registerOwned(contract, impl);
        }
      },
      signal: authority.controller.signal,
      config: projectConfig,
      logger: this.logger,
    };
  }

  private async runExtensionSetup(
    record: SetupRecord,
    context: ExtensionContext,
    timeoutMs: number,
  ): Promise<void> {
    const setup = record.resolved.extension.setup!;
    const setupPromise = Promise.resolve().then(() => setup(context));
    record.setupState = "pending";
    record.setupSettled = setupPromise.then(
      () => {
        record.setupState = "settled";
      },
      () => {
        record.setupState = "settled";
      },
    );
    if (timeoutMs === 0) {
      await setupPromise;
      return;
    }

    const failure = new ExtensionSetupTimeoutFailure(
      record.resolved,
      timeoutMs,
    );
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        // Reject the race before dispatching abort listeners so an abort-aware
        // setup cannot replace the deterministic timeout error with its own.
        reject(failure);
        this.revokeAuthority(record.authority);
      }, timeoutMs);
    });

    try {
      await Promise.race([setupPromise, timeoutPromise]);
    } finally {
      clearTimeout(timerId);
    }
  }

  private registerOwned<T>(contract: string, impl: T): void {
    this.ownsContracts = true;
    register(contract, impl);
  }

  private revokeAuthority(authority: ContextAuthority | undefined): void {
    if (!authority?.active) return;
    authority.active = false;
    authority.controller.abort();
  }

  private trackTimedOutCleanup(rollback: Promise<void>): void {
    const cleanup = rollback.catch((error) => {
      // Keep the tracked promise fulfilled to avoid an unhandled rejection,
      // but retain the failure as a sticky quarantine. Activating another
      // generation would overlap resources that cleanup failed to close.
      this.quarantineFailure ??= error;
    });
    this.lateSetups.add(cleanup);
    void cleanup.then(
      () => this.lateSetups.delete(cleanup),
      () => this.lateSetups.delete(cleanup),
    );
  }

  private async waitForLateSetups(throwOnQuarantine = true): Promise<void> {
    while (this.lateSetups.size > 0) {
      await Promise.all([...this.lateSetups]);
    }
    if (throwOnQuarantine) this.throwIfQuarantined();
  }

  /**
   * @internal Wait for setup work that outlived a timeout and its final cleanup.
   * Used by the orchestration coordinator after `setupAll()` has already
   * rejected; not a general replacement for `teardownAll()`.
   */
  async awaitLateSetupCleanup(): Promise<void> {
    await this.lifecycleTail;
    // `teardownAll()` is intentionally used here instead of only observing
    // the tracked timeout barrier. If a late teardown failed transiently, the
    // orchestration coordinator gets one explicit retry before deciding that
    // the old generation must remain quarantined.
    await this.teardownAll();
  }

  /** Teardown all loaded extensions in reverse order. */
  teardownAll(): Promise<void> {
    return this.enqueueLifecycle(async () => {
      // A public shutdown is a full barrier: if a setup outlived its timeout,
      // do not report disposal complete until that setup settles and receives
      // its teardown pass. A failed pass retains the owning records, so a
      // later explicit shutdown call can retry only those failed hooks.
      await this.waitForLateSetups(false);
      await this.teardownAllInternal();
      await this.waitForLateSetups(false);
      this.throwIfQuarantined();
    });
  }

  private async teardownAllInternal(): Promise<void> {
    const setupOrder = [...this.setupOrder];

    // Revoke every context before the first teardown hook runs. This prevents
    // an earlier extension from observing or mutating registry state while a
    // later extension is already being dismantled.
    for (const record of setupOrder) {
      this.revokeAuthority(record.authority);
    }

    const failures: unknown[] = [];
    const failedRecords = new Set<SetupRecord>();
    const pendingSetups: SetupRecord[] = [];

    const teardownRecord = async (record: SetupRecord): Promise<void> => {
      const ext = record.resolved.extension;
      if (!ext.teardown) return;
      try {
        await ext.teardown();
      } catch (error) {
        failures.push(error);
        failedRecords.add(record);
        this.logger.error(`Error tearing down "${ext.name}":`, error);
      }
    };

    // Teardown every extension whose setup has already settled. A timed-out
    // non-cooperative setup is deferred until settlement so its hook runs
    // after its final resource acquisition is possible.
    for (const record of [...setupOrder].reverse()) {
      if (record.setupState === "pending") {
        pendingSetups.push(record);
        continue;
      }
      await teardownRecord(record);
    }

    for (const record of pendingSetups) {
      await record.setupSettled;
      await teardownRecord(record);
    }

    if (failures.length === 0) {
      this.setupOrder = [];
      // Teardown hooks may resolve dependencies from the retiring registry.
      // Clear it only after every hook (including a retry) completed.
      const shouldResetContracts = this.ownsContracts;
      this.ownsContracts = false;
      if (shouldResetContracts) reset();
      this.quarantineFailure = undefined;
      return;
    }

    // Successful hooks are never repeated. Failed hooks and the retiring
    // registry remain owned so an explicit retry has the same dependencies
    // and cannot overlap a replacement generation.
    this.setupOrder = setupOrder.filter((record) => failedRecords.has(record));
    const details = failures
      .map((error) => error instanceof Error ? error.message : String(error))
      .join("; ");
    const failure = new AggregateError(
      failures,
      `Extension teardown failed${details ? `: ${details}` : ""}`,
    );
    this.quarantineFailure = failure;
    throw failure;
  }

  private throwIfQuarantined(): void {
    if (this.quarantineFailure !== undefined) throw this.quarantineFailure;
  }

  private enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.lifecycleTail.then(operation);
    this.lifecycleTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private assertValidExtension(candidate: unknown): asserts candidate is Extension {
    const issues = validateExtension(candidate);
    if (issues.length === 0) return;

    const name = candidate !== null &&
        typeof candidate === "object" &&
        "name" in candidate &&
        typeof candidate.name === "string" &&
        candidate.name.length > 0
      ? candidate.name
      : "<unknown>";
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Extension "${name}" is invalid:\n  ${issues.join("\n  ")}`,
    });
  }
}

function requiredContractNames(ext: Extension): string[] {
  return ext.contracts?.requires ?? [];
}

function combineLifecycleFailures(setupError: unknown, teardownError: unknown): AggregateError {
  const teardownFailures = teardownError instanceof AggregateError
    ? teardownError.errors
    : [teardownError];
  return new AggregateError(
    [setupError, ...teardownFailures],
    `Extension setup failed and rollback teardown failed: ${
      setupError instanceof Error ? setupError.message : String(setupError)
    }`,
  );
}
