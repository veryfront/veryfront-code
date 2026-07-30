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
import { formatCapabilities, mapToDenoPermissions } from "./capabilities.ts";
import {
  detectConflicts,
  selectContractProviders,
  snapshotExtensionContractMetadata,
  SOURCE_PRIORITY,
  validateExtension,
} from "./validation.ts";
import type { ExtensionContractSnapshot } from "./validation.ts";
import type {
  Capability,
  Extension,
  ExtensionContext,
  ExtensionLogger,
  ExtensionSource,
  ResolvedExtension,
} from "./types.ts";
import { describeThrownValue } from "./safe-value.ts";
import { getDeferredExtensionState } from "./deferred-extension.ts";
import {
  containsUnicodeControlOrLineSeparator,
  isWellFormedUnicode,
  MAX_EXTENSION_NAME_CHARACTERS,
  MAX_EXTENSION_VERSION_CHARACTERS,
} from "./metadata-policy.ts";

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
  readonly activation: ActivationSnapshot;
  authority?: ContextAuthority;
  setupState?: "pending" | "settled";
  setupSettled?: Promise<void>;
}

interface LoadPlan {
  readonly loadOrder: ResolvedExtension[];
  readonly contractWinner: Map<string, ResolvedExtension>;
  readonly contractSnapshots: ReadonlyMap<ResolvedExtension, ExtensionContractSnapshot>;
  readonly activationSnapshots: ReadonlyMap<ResolvedExtension, ActivationSnapshot>;
}

interface ActivationSnapshot {
  readonly extensionName: string;
  readonly version: string;
  readonly source: ExtensionSource;
  readonly capabilityAuditLines: readonly string[];
  readonly setup?: Extension["setup"];
  readonly teardown?: Extension["teardown"];
}

class ExtensionSetupTimeoutFailure extends Error {
  constructor(
    readonly resolved: ResolvedExtension,
    readonly extensionName: string,
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
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      descriptors = Object.getOwnPropertyDescriptors(contracts);
    } catch (cause) {
      throw new TypeError("Primed contracts could not be inspected", { cause });
    }

    const additions: Record<string, unknown> = Object.create(null);
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue;
      if (name.trim().length === 0 || name.trim() !== name) {
        throw new TypeError(
          "Primed contract name must be a non-empty string without surrounding whitespace",
        );
      }
      if (!Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`Primed contract "${name}" must be a data property`);
      }
      if (descriptor.value === undefined) {
        throw new TypeError(`Primed contract "${name}" must not be undefined`);
      }
      additions[name] = descriptor.value;
    }

    this.primed = Object.assign(
      Object.create(null) as Record<string, unknown>,
      this.primed,
      additions,
    );
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
    const activationSnapshots = this.snapshotActivationMetadataFor(extensions);
    const contractSnapshots = this.snapshotContractMetadata(extensions);
    const normalized = this.normalizeExtensionNames(extensions, activationSnapshots);
    const contractWinner = selectContractProviders(normalized, contractSnapshots);
    return this.topologicalSortWithProviders(
      normalized,
      contractWinner,
      contractSnapshots,
      activationSnapshots,
    );
  }

  private topologicalSortWithProviders(
    extensions: ResolvedExtension[],
    contractWinner: Map<string, ResolvedExtension>,
    contractSnapshots: ReadonlyMap<ResolvedExtension, ExtensionContractSnapshot>,
    activationSnapshots: ReadonlyMap<ResolvedExtension, ActivationSnapshot>,
  ): ResolvedExtension[] {
    const providerOf = new Map<string, string>();
    const extByName = new Map<string, ResolvedExtension>();
    const consumesContracts = new Map<string, readonly string[]>();

    for (const [contract, provider] of contractWinner) {
      providerOf.set(contract, activationSnapshots.get(provider)!.extensionName);
    }

    for (const resolved of extensions) {
      const name = activationSnapshots.get(resolved)!.extensionName;
      extByName.set(name, resolved);
      const contracts = contractSnapshots.get(resolved)!.requires;
      if (contracts.length > 0) {
        consumesContracts.set(name, contracts);
      }
    }

    const graph = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const resolved of extensions) {
      const name = activationSnapshots.get(resolved)!.extensionName;
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
      const sortedNames = new Set(
        sorted.map((resolved) => activationSnapshots.get(resolved)!.extensionName),
      );
      const unsorted = extensions
        .filter((resolved) => !sortedNames.has(activationSnapshots.get(resolved)!.extensionName))
        .map((resolved) => activationSnapshots.get(resolved)!.extensionName);
      throw CIRCULAR_DEPENDENCY_ERROR.create({
        message: `Circular extension dependency detected among: ${unsorted.join(", ")}`,
      });
    }

    return sorted;
  }

  private normalizeExtensionNames(
    extensions: ResolvedExtension[],
    activationSnapshots?: ReadonlyMap<ResolvedExtension, ActivationSnapshot>,
  ): ResolvedExtension[] {
    const winnerByName = new Map<string, ResolvedExtension>();

    for (const resolved of extensions) {
      const name = activationSnapshots?.get(resolved)?.extensionName ??
        resolved.extension.name;
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
      const name = activationSnapshots?.get(resolved)?.extensionName ??
        resolved.extension.name;
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
    const materialized = await this.materializeExtensions(extensions);
    const { activationSnapshots, contractSnapshots, loadOrder, contractWinner } = this
      .prepareLoadPlan(materialized);

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
        const activation = activationSnapshots.get(resolved)!;
        const contracts = contractSnapshots.get(resolved)!;
        if (activation.capabilityAuditLines.length > 0) {
          this.logger.debug(
            `Extension "${activation.extensionName}" declares capabilities:`,
            ...activation.capabilityAuditLines,
          );
        }

        // Track the extension before any registration or setup side effect so
        // the first extension receives the same rollback guarantees as later
        // extensions.
        const record: SetupRecord = { resolved, activation };
        this.setupOrder.push(record);

        for (const { contract, implementation } of contracts.legacyProvides) {
          if (contractWinner.get(contract) === resolved) {
            this.registerOwned(contract, implementation);
          }
        }

        if (activation.setup) {
          const authority: ContextAuthority = {
            active: true,
            controller: new AbortController(),
            extensionName: activation.extensionName,
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

        this.assertWinningContractsWereProvided(
          resolved,
          activation.extensionName,
          contracts,
          contractWinner,
        );

        this.logger.debug(
          `Extension "${activation.extensionName}" v${activation.version} loaded from ${activation.source}`,
        );
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
            `Extension "${error.extensionName}" setup() timed out after ${error.timeoutMs}ms`,
          detail:
            `Extension "${error.extensionName}" setup() did not complete within ${error.timeoutMs}ms`,
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

  private async materializeExtensions(
    candidates: ResolvedExtension[],
  ): Promise<ResolvedExtension[]> {
    const resolved: ResolvedExtension[] = [];
    for (const candidate of candidates) {
      const deferred = getDeferredExtensionState(candidate);
      if (!deferred) {
        resolved.push(candidate);
        continue;
      }

      const extension = await deferred.load(this.logger);
      if (extension === undefined) continue;
      this.assertValidExtension(extension);
      if (extension.name !== deferred.expectedName) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message:
            `Deferred extension "${deferred.expectedName}" materialized as "${extension.name}"`,
        });
      }
      resolved.push({
        extension,
        source: candidate.source,
        origin: candidate.origin,
      });
    }
    return resolved;
  }

  private prepareLoadPlan(extensions: ResolvedExtension[]): LoadPlan {
    const flattened = this.flattenPresets(extensions);
    const activationSnapshots = this.snapshotActivationMetadataFor(flattened);
    const contractSnapshots = this.snapshotContractMetadata(flattened);
    const normalized = this.normalizeExtensionNames(flattened, activationSnapshots);
    const extensionNames = new Map(
      normalized.map((resolved) => [
        resolved,
        activationSnapshots.get(resolved)!.extensionName,
      ]),
    );
    const conflicts = detectConflicts(
      normalized,
      contractSnapshots,
      extensionNames,
    );
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

    const contractWinner = selectContractProviders(normalized, contractSnapshots);
    this.assertRequiredContractsAvailable(
      normalized,
      contractSnapshots,
      activationSnapshots,
      contractWinner,
    );
    const loadOrder = this.topologicalSortWithProviders(
      normalized,
      contractWinner,
      contractSnapshots,
      activationSnapshots,
    );
    return { loadOrder, contractWinner, contractSnapshots, activationSnapshots };
  }

  private snapshotActivationMetadataFor(
    extensions: ResolvedExtension[],
  ): ReadonlyMap<ResolvedExtension, ActivationSnapshot> {
    const snapshots = new Map<ResolvedExtension, ActivationSnapshot>();
    for (const resolved of extensions) {
      snapshots.set(resolved, this.snapshotActivationMetadata(resolved));
    }
    return snapshots;
  }

  private snapshotActivationMetadata(
    resolved: ResolvedExtension,
  ): ActivationSnapshot {
    const extension = resolved.extension;
    const read = (
      field: "name" | "version" | "capabilities" | "setup" | "teardown",
    ): unknown => {
      let descriptor: PropertyDescriptor | undefined;
      try {
        descriptor = Object.getOwnPropertyDescriptor(extension, field);
      } catch (cause) {
        throw new TypeError(`extension.${field} could not be inspected`, { cause });
      }
      if (!descriptor) return undefined;
      if (!descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError(
          `extension.${field} must be an enumerable own data property`,
        );
      }
      return descriptor.value;
    };

    const extensionName = read("name") as string;
    const version = read("version") as string;
    const capabilities = read("capabilities") as Capability[];
    const setup = read("setup") as Extension["setup"];
    const teardown = read("teardown") as Extension["teardown"];
    function assertCanonical(
      value: unknown,
      field: "name" | "version",
      maximumLength: number,
    ): asserts value is string {
      if (
        typeof value !== "string" || value.trim().length === 0 ||
        value.trim() !== value || value.length > maximumLength ||
        !isWellFormedUnicode(value) ||
        containsUnicodeControlOrLineSeparator(value)
      ) {
        throw new TypeError(`extension.${field} changed after validation`);
      }
    }
    assertCanonical(extensionName, "name", MAX_EXTENSION_NAME_CHARACTERS);
    assertCanonical(version, "version", MAX_EXTENSION_VERSION_CHARACTERS);
    if (setup !== undefined && typeof setup !== "function") {
      throw new TypeError("extension.setup changed after validation");
    }
    if (teardown !== undefined && typeof teardown !== "function") {
      throw new TypeError("extension.teardown changed after validation");
    }
    mapToDenoPermissions(capabilities);
    return Object.freeze({
      extensionName,
      version,
      source: resolved.source,
      capabilityAuditLines: Object.freeze(formatCapabilities(capabilities)),
      ...(setup ? { setup } : {}),
      ...(teardown ? { teardown } : {}),
    });
  }

  private snapshotContractMetadata(
    extensions: ResolvedExtension[],
  ): ReadonlyMap<ResolvedExtension, ExtensionContractSnapshot> {
    const snapshots = new Map<ResolvedExtension, ExtensionContractSnapshot>();
    for (const resolved of extensions) {
      snapshots.set(
        resolved,
        snapshotExtensionContractMetadata(resolved.extension),
      );
    }
    return snapshots;
  }

  private assertRequiredContractsAvailable(
    extensions: ResolvedExtension[],
    contractSnapshots: ReadonlyMap<ResolvedExtension, ExtensionContractSnapshot>,
    activationSnapshots: ReadonlyMap<ResolvedExtension, ActivationSnapshot>,
    contractWinner: Map<string, ResolvedExtension>,
  ): void {
    const missing: Array<{ extension: string; contract: string }> = [];
    for (const resolved of extensions) {
      const extensionName = activationSnapshots.get(resolved)!.extensionName;
      for (const contract of contractSnapshots.get(resolved)!.requires) {
        if (
          contractWinner.has(contract) ||
          Object.prototype.hasOwnProperty.call(this.primed, contract)
        ) continue;
        missing.push({ extension: extensionName, contract });
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
    extensionName: string,
    contracts: ExtensionContractSnapshot,
    contractWinner: Map<string, ResolvedExtension>,
  ): void {
    const missing = contracts.declaredProvides.filter((contract) =>
      contractWinner.get(contract) === resolved && tryResolve(contract) === undefined
    );
    if (missing.length === 0) return;

    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Extension "${extensionName}" completed setup without providing declared contract${
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
        if (!winner) {
          throw EXTENSION_VALIDATION_ERROR.create({
            message:
              `Extension "${authority.extensionName}" cannot provide undeclared contract "${contract}". Declare it in contracts.provides or provides.`,
          });
        }
        if (winner === resolved) {
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
    const setup = record.activation.setup!;
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
      record.activation.extensionName,
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
      const { extensionName, teardown } = record.activation;
      if (!teardown) return;
      try {
        await teardown();
      } catch (error) {
        failures.push(error);
        failedRecords.add(record);
        this.logger.error(`Error tearing down "${extensionName}":`, error);
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
      .map(describeThrownValue)
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

    let name = "<invalid>";
    if (candidate !== null && typeof candidate === "object") {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(candidate, "name");
        const candidateName = descriptor && "value" in descriptor ? descriptor.value : undefined;
        if (
          descriptor?.enumerable && typeof candidateName === "string" &&
          candidateName.trim().length > 0 && candidateName.trim() === candidateName &&
          candidateName.length <= MAX_EXTENSION_NAME_CHARACTERS &&
          isWellFormedUnicode(candidateName) &&
          !containsUnicodeControlOrLineSeparator(candidateName)
        ) {
          name = candidateName;
        }
      } catch {
        // Validation already records the inspection failure.
      }
    }
    const renderedName = JSON.stringify(name);
    throw EXTENSION_VALIDATION_ERROR.create({
      message: `Extension ${renderedName} is invalid:\n  ${issues.join("\n  ")}`,
    });
  }
}

function combineLifecycleFailures(setupError: unknown, teardownError: unknown): AggregateError {
  const teardownFailures = teardownError instanceof AggregateError
    ? teardownError.errors
    : [teardownError];
  return new AggregateError(
    [setupError, ...teardownFailures],
    `Extension setup failed and rollback teardown failed: ${describeThrownValue(setupError)}`,
  );
}
