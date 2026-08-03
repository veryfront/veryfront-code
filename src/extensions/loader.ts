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
import { resolve as resolveContract } from "./contracts.ts";
import {
  assertContractGenerationAdmissionAllowed,
  beginContractGeneration,
  commitContractGeneration,
  completeContractGenerationRetirement,
  type ContractGeneration,
  drainContractGeneration,
  failContractGeneration,
  isContractGenerationDrained,
  runWithContractGenerationEpoch,
  runWithContractGenerationResolution,
  sealContractGeneration,
  stageContract,
  tryResolveContractForGeneration,
} from "./contract-registry-internal.ts";
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
  MAX_EXTENSION_PRESET_CHILDREN,
  MAX_EXTENSION_PRESET_DEPTH,
  MAX_EXTENSION_PRESET_NODES,
  MAX_EXTENSION_VERSION_CHARACTERS,
  snapshotDenseMetadataArray,
} from "./metadata-policy.ts";
import {
  createIntrinsicPromise,
  createIntrinsicPromiseContinuation,
  createResolvedIntrinsicPromise,
} from "./promise-intrinsics-internal.ts";

const DEFAULT_SETUP_TIMEOUT_MS = 30_000;
// JavaScript runtimes clamp larger delays to an implementation-specific short
// delay (Node uses 1 ms), which would turn an oversized safety timeout into an
// immediate failure.
const MAX_SETUP_TIMEOUT_MS = 2_147_483_647;
const NativeAggregateError = AggregateError;
const NativeError = Error;
const NativeSet = Set;
const apply = Reflect.apply;
const arrayIteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const arrayIterator = Array.prototype[arrayIteratorSymbol];
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const setAdd = Set.prototype.add;
const setDelete = Set.prototype.delete;
const setForEach = Set.prototype.forEach;
const setHas = Set.prototype.has;
const setSizeGetter = (() => {
  const getter = getOwnPropertyDescriptor(Set.prototype, "size")?.get;
  if (getter === undefined) {
    throw new NativeError("Set.prototype.size getter is unavailable");
  }
  return getter;
})();

function createDataDescriptor(value: unknown): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = false;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = false;
  return descriptor;
}

function appendArrayValue<T>(array: T[], value: T): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  defineProperty(array, array.length, descriptor);
}

function copyArrayValues<T>(source: readonly T[]): T[] {
  const copy: T[] = [];
  for (let index = 0; index < source.length; index += 1) {
    appendArrayValue(copy, source[index]);
  }
  return copy;
}

function addSetValue<T>(set: Set<T>, value: T): void {
  apply(setAdd, set, [value]);
}

function deleteSetValue<T>(set: Set<T>, value: T): boolean {
  return apply(setDelete, set, [value]) as boolean;
}

function forEachSetValue<T>(set: Set<T>, callback: (value: T) => void): void {
  apply(setForEach, set, [callback]);
}

function hasSetValue<T>(set: Set<T>, value: T): boolean {
  return apply(setHas, set, [value]) as boolean;
}

function getSetSize<T>(set: Set<T>): number {
  return apply(setSizeGetter, set, []) as number;
}

function prepareAggregateErrorValues(values: unknown[]): unknown[] {
  defineProperty(
    values,
    arrayIteratorSymbol,
    createDataDescriptor(arrayIterator),
  );
  return values;
}

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
   * @internal Runs after candidate preflight but before this candidate owns the
   * process-wide transition fence. It may finish cleanup for an already
   * failed transition, but must not retire the currently active generation.
   */
  beforeTransition?: () => void | Promise<void>;
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
  private contractGeneration: ContractGeneration | undefined;
  private contractGenerationActivationFailed = false;
  private lifecycleTail: Promise<void> = createResolvedIntrinsicPromise();
  private readonly lateSetups = new NativeSet<Promise<void>>();
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
    assertContractGenerationAdmissionAllowed();
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
    return this.flattenPresetsInner(extensions, new Set(), 0, { visited: 0 });
  }

  private flattenPresetsInner(
    extensions: ResolvedExtension[],
    path: Set<Extension>,
    depth: number,
    budget: { visited: number },
  ): ResolvedExtension[] {
    if (depth > MAX_EXTENSION_PRESET_DEPTH) {
      throw EXTENSION_VALIDATION_ERROR.create({
        message: `Extension preset nesting exceeds ${MAX_EXTENSION_PRESET_DEPTH} levels`,
      });
    }
    const result: ResolvedExtension[] = [];

    for (const resolved of extensions) {
      budget.visited += 1;
      if (budget.visited > MAX_EXTENSION_PRESET_NODES) {
        throw EXTENSION_VALIDATION_ERROR.create({
          message: `Extension preset graph exceeds ${MAX_EXTENSION_PRESET_NODES} nodes`,
        });
      }
      const candidate = resolved.extension as unknown;
      this.assertValidExtension(candidate);
      const ext = candidate;
      const preset = this.snapshotPresetMetadata(ext);

      if (preset.children.length > 0) {
        if (path.has(ext)) {
          throw EXTENSION_VALIDATION_ERROR.create({
            message: `Circular preset extends chain detected via "${preset.extensionName}"`,
          });
        }
        path.add(ext);
        const children = preset.children.map((child) => ({
          extension: child,
          source: resolved.source,
          origin: resolved.origin,
        }));
        result.push(...this.flattenPresetsInner(children, path, depth + 1, budget));
        path.delete(ext);
      } else {
        result.push(resolved);
      }
    }

    return result;
  }

  private snapshotPresetMetadata(
    extension: Extension,
  ): Readonly<{ extensionName: string; children: readonly Extension[] }> {
    const read = (field: "name" | "extends"): unknown => {
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

    const extensionName = read("name");
    if (
      typeof extensionName !== "string" || extensionName.trim().length === 0 ||
      extensionName.trim() !== extensionName ||
      extensionName.length > MAX_EXTENSION_NAME_CHARACTERS ||
      !isWellFormedUnicode(extensionName) ||
      containsUnicodeControlOrLineSeparator(extensionName)
    ) {
      throw new TypeError("extension.name changed after validation");
    }
    const extendsValue = read("extends");
    const children = extendsValue === undefined
      ? Object.freeze([]) as readonly unknown[]
      : snapshotDenseMetadataArray(
        extendsValue,
        "extension.extends",
        0,
        MAX_EXTENSION_PRESET_CHILDREN,
      );
    return Object.freeze({
      extensionName,
      children: children as readonly Extension[],
    });
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
    assertContractGenerationAdmissionAllowed();
    const timeoutMs = this.normalizeSetupTimeout(options?.setupTimeoutMs);
    const materialized = await this.materializeExtensions(extensions);
    const { activationSnapshots, contractSnapshots, loadOrder, contractWinner } = this
      .prepareLoadPlan(materialized);

    // A timed-out setup can keep running after Promise.race settles. Do not
    // activate a replacement until that work settles and receives a final
    // cleanup pass, or it could mutate resources owned by the new generation.
    await this.waitForLateSetups();
    await options?.beforeTransition?.();
    const candidateGeneration = beginContractGeneration();
    try {
      // Fence lifecycle-aware consumers before process-wide orchestration
      // tears down the previous loader. The candidate remains unpublished
      // until every setup and declared-contract check succeeds.
      await options?.beforeActivate?.();
      await this.teardownAllInternal();
    } catch (error) {
      failContractGeneration(candidateGeneration);
      throw error;
    }

    this.contractGeneration = candidateGeneration;
    this.contractGenerationActivationFailed = false;

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
            candidateGeneration,
          );
          await this.runExtensionSetup(record, context, timeoutMs);
        }

        this.assertWinningContractsWereProvided(
          resolved,
          activation.extensionName,
          contracts,
          contractWinner,
          candidateGeneration,
        );

        this.logger.debug(
          `Extension "${activation.extensionName}" v${activation.version} loaded from ${activation.source}`,
        );
      }
      commitContractGeneration(candidateGeneration);
    } catch (error) {
      this.contractGenerationActivationFailed = true;
      sealContractGeneration(candidateGeneration, error);
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
    generation: ContractGeneration,
  ): void {
    const missing = contracts.declaredProvides.filter((contract) =>
      contractWinner.get(contract) === resolved &&
      tryResolveContractForGeneration(generation, contract) === undefined
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
    generation: ContractGeneration,
  ): ExtensionContext {
    return {
      get: <T>(contract: string): T | undefined => {
        if (!authority.active) return undefined;
        return tryResolveContractForGeneration<T>(generation, contract);
      },
      require: <T>(contract: string): T => {
        if (!authority.active) {
          throw new Error(
            `Extension context for "${authority.extensionName}" is no longer active`,
          );
        }
        const implementation = tryResolveContractForGeneration<T>(
          generation,
          contract,
        );
        return implementation === undefined ? resolveContract<T>(contract) : implementation;
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
          this.registerOwned(contract, impl, generation);
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
        if (this.contractGeneration !== undefined) {
          sealContractGeneration(this.contractGeneration, failure);
        }
        this.revokeAuthority(record.authority);
      }, timeoutMs);
    });

    try {
      await Promise.race([setupPromise, timeoutPromise]);
    } finally {
      clearTimeout(timerId);
    }
  }

  private registerOwned<T>(
    contract: string,
    impl: T,
    generation?: ContractGeneration,
  ): void {
    const owner = generation ?? this.contractGeneration;
    if (owner === undefined) {
      throw new Error("Extension contract generation is not available");
    }
    stageContract(owner, contract, impl);
  }

  private revokeAuthority(authority: ContextAuthority | undefined): void {
    if (!authority?.active) return;
    authority.active = false;
    authority.controller.abort();
  }

  private trackTimedOutCleanup(rollback: Promise<void>): void {
    const cleanup = createIntrinsicPromiseContinuation(
      rollback,
      () => undefined,
      (error) => {
        // Keep the tracked promise fulfilled to avoid an unhandled rejection,
        // but retain the failure as a sticky quarantine. Activating another
        // generation would overlap resources that cleanup failed to close.
        this.quarantineFailure ??= error;
      },
    );
    addSetValue(this.lateSetups, cleanup);
    createIntrinsicPromiseContinuation(
      cleanup,
      () => {
        deleteSetValue(this.lateSetups, cleanup);
      },
      () => {
        deleteSetValue(this.lateSetups, cleanup);
      },
    );
  }

  private waitForLateSetups(throwOnQuarantine = true): Promise<void> {
    return createIntrinsicPromise<void>((resolve, reject) => {
      let settled = false;
      const fail = (reason: unknown): void => {
        if (settled) return;
        settled = true;
        reject(reason);
      };
      const finish = (): void => {
        if (settled) return;
        try {
          if (throwOnQuarantine) this.throwIfQuarantined();
          settled = true;
          resolve();
        } catch (error) {
          fail(error);
        }
      };
      const waitForCurrentBatch = (): void => {
        if (settled) return;
        if (getSetSize(this.lateSetups) === 0) {
          finish();
          return;
        }

        let remaining = 0;
        const markSettled = (): void => {
          if (settled) return;
          remaining -= 1;
          if (remaining === 0) waitForCurrentBatch();
        };
        try {
          forEachSetValue(this.lateSetups, (cleanup) => {
            remaining += 1;
            createIntrinsicPromiseContinuation(
              cleanup,
              markSettled,
              fail,
            );
          });
        } catch (error) {
          fail(error);
          return;
        }
        if (remaining === 0) waitForCurrentBatch();
      };

      waitForCurrentBatch();
    });
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
    return this.enqueueLifecycle(() => this.runTeardownBarrier());
  }

  private runTeardownBarrier(): Promise<void> {
    return createIntrinsicPromise<void>((resolve, reject) => {
      const fail = (reason: unknown): void => reject(reason);
      const finish = (): void => {
        try {
          this.throwIfQuarantined();
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      const waitAfterTeardown = (): void => {
        let lateSetupBarrier: Promise<void>;
        try {
          lateSetupBarrier = this.waitForLateSetups(false);
          createIntrinsicPromiseContinuation(
            lateSetupBarrier,
            finish,
            fail,
          );
        } catch (error) {
          reject(error);
        }
      };
      const startTeardown = (): void => {
        let teardown: Promise<void>;
        try {
          // This call reaches generation sealing and retirement notification
          // synchronously before its first suspension point.
          teardown = this.teardownAllInternal();
          createIntrinsicPromiseContinuation(
            teardown,
            waitAfterTeardown,
            fail,
          );
        } catch (error) {
          reject(error);
        }
      };

      try {
        // A public shutdown is a full barrier: if a setup outlived its timeout,
        // do not overlap its cleanup with another teardown pass.
        const lateSetupBarrier = this.waitForLateSetups(false);
        createIntrinsicPromiseContinuation(
          lateSetupBarrier,
          startTeardown,
          fail,
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  private async teardownAllInternal(): Promise<void> {
    const setupOrder = copyArrayValues(this.setupOrder);
    const generation = this.contractGeneration;

    // Admission closes before context abort dispatch. Abort listeners run
    // synchronously and must not start one last generation-owned operation.
    if (generation !== undefined) {
      sealContractGeneration(generation);
    }

    // Revoke every context before the first teardown hook runs. This prevents
    // an earlier extension from observing or mutating registry state while a
    // later extension is already being dismantled.
    for (let index = 0; index < setupOrder.length; index += 1) {
      this.revokeAuthority(setupOrder[index]!.authority);
    }

    const failures: unknown[] = [];
    const retirementFailures: unknown[] = [];
    const failedRecords = new NativeSet<SetupRecord>();
    const pendingSetups: SetupRecord[] = [];

    if (generation !== undefined) {
      try {
        // Notify cancellation only after all extension contexts are revoked,
        // then wait for every admitted operation to release its lease.
        await drainContractGeneration(generation);
      } catch (error) {
        this.logger.error("Error draining extension contract generation:", error);
        if (!isContractGenerationDrained(generation)) {
          // A failed drain is an admission barrier, not permission to dismantle
          // resources that an admitted operation can still be using.
          this.quarantineFailure = error;
          throw error;
        }
        appendArrayValue(retirementFailures, error);
      }
    }

    const teardownRecord = async (record: SetupRecord): Promise<void> => {
      const { extensionName, teardown } = record.activation;
      if (!teardown) return;
      try {
        if (generation !== undefined) {
          if (this.contractGenerationActivationFailed) {
            await runWithContractGenerationResolution(generation, teardown);
          } else {
            await runWithContractGenerationEpoch(generation, teardown);
          }
        } else {
          await teardown();
        }
      } catch (error) {
        appendArrayValue(failures, error);
        addSetValue(failedRecords, record);
        this.logger.error(`Error tearing down "${extensionName}":`, error);
      }
    };

    // Teardown every extension whose setup has already settled. A timed-out
    // non-cooperative setup is deferred until settlement so its hook runs
    // after its final resource acquisition is possible.
    for (let index = setupOrder.length - 1; index >= 0; index -= 1) {
      const record = setupOrder[index]!;
      if (record.setupState === "pending") {
        appendArrayValue(pendingSetups, record);
        continue;
      }
      await teardownRecord(record);
    }

    for (let index = 0; index < pendingSetups.length; index += 1) {
      const record = pendingSetups[index]!;
      await record.setupSettled;
      await teardownRecord(record);
    }

    if (failures.length === 0) {
      this.setupOrder = [];
      // Entries stay available through teardown hooks. Compare-delete only
      // this generation's exact entries so newer/unrelated registrations live.
      if (generation !== undefined) {
        if (this.contractGenerationActivationFailed) {
          failContractGeneration(generation);
        } else {
          completeContractGenerationRetirement(generation);
        }
        if (this.contractGeneration === generation) {
          this.contractGeneration = undefined;
        }
      }
      this.contractGenerationActivationFailed = false;
      this.quarantineFailure = undefined;
      if (retirementFailures.length === 1) throw retirementFailures[0];
      if (retirementFailures.length > 1) {
        throw new NativeAggregateError(
          prepareAggregateErrorValues(retirementFailures),
          "Extension contract generation retirement failed",
        );
      }
      return;
    }

    // Successful hooks are never repeated. Failed hooks and the retiring
    // registry remain owned so an explicit retry has the same dependencies
    // and cannot overlap a replacement generation.
    const retryOrder: SetupRecord[] = [];
    for (let index = 0; index < setupOrder.length; index += 1) {
      const record = setupOrder[index]!;
      if (hasSetValue(failedRecords, record)) {
        appendArrayValue(retryOrder, record);
      }
    }
    this.setupOrder = retryOrder;
    const lifecycleFailures = copyArrayValues(retirementFailures);
    for (let index = 0; index < failures.length; index += 1) {
      appendArrayValue(lifecycleFailures, failures[index]);
    }
    let details = "";
    for (let index = 0; index < lifecycleFailures.length; index += 1) {
      if (details.length > 0) details += "; ";
      details += describeThrownValue(lifecycleFailures[index]);
    }
    const failure = new NativeAggregateError(
      prepareAggregateErrorValues(lifecycleFailures),
      `Extension teardown failed${details ? `: ${details}` : ""}`,
    );
    this.quarantineFailure = failure;
    throw failure;
  }

  private throwIfQuarantined(): void {
    if (this.quarantineFailure !== undefined) throw this.quarantineFailure;
  }

  private enqueueLifecycle(operation: () => Promise<void>): Promise<void> {
    const result = createIntrinsicPromise<void>((resolve, reject) => {
      const runOperation = (): void => {
        let operationResult: Promise<void>;
        try {
          operationResult = operation();
        } catch (error) {
          reject(error);
          return;
        }
        try {
          createIntrinsicPromiseContinuation(
            operationResult,
            resolve,
            reject,
          );
        } catch (error) {
          reject(error);
        }
      };
      try {
        createIntrinsicPromiseContinuation(
          this.lifecycleTail,
          runOperation,
          reject,
        );
      } catch (error) {
        reject(error);
      }
    });
    this.lifecycleTail = createIntrinsicPromiseContinuation(
      result,
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
