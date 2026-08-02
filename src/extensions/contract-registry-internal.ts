/**
 * Internal contract-registry ownership and active-use lifecycle.
 *
 * Public registry operations intentionally remain synchronous and preserve
 * their existing signatures. Loader-owned registrations additionally carry
 * an opaque generation identity so teardown can stop admission, drain active
 * users, and remove only the exact entries that generation published.
 *
 * @internal
 */

import { assertCanonicalNonEmptyString } from "./runtime-validation.ts";
import { AsyncLocalStorage } from "#veryfront/platform/compat/async-context.ts";

type ContractGenerationStatus =
  | "staging"
  | "active"
  | "retiring"
  | "retired"
  | "failed";

interface ContractEntry<T = unknown> {
  readonly implementation: T;
  readonly generation: ContractGeneration | undefined;
}

interface ContractLeaseRecord {
  released: boolean;
  quarantined: boolean;
  quarantineFailure: Error | undefined;
  retirementNotified: boolean;
  retirementHandler: ((reason: unknown) => void) | undefined;
}

interface ContractGenerationResolutionScope {
  /**
   * Failed candidates are not globally published, so rollback may opt into
   * their staged entries. Successful teardown and retirement controls use
   * epoch isolation without an entry overlay.
   */
  readonly entryOverlay: ContractGeneration | undefined;
  readonly resetToken: object;
  active: boolean;
}

/** Opaque ownership state for one loader generation. */
export interface ContractGeneration {
  /** Registry epoch that owns every global side effect of this generation. */
  readonly resetToken: object;
  status: ContractGenerationStatus;
  readonly entries: Map<string, ContractEntry>;
  /** Candidate entries hidden by explicit rollback-time register/unregister. */
  readonly entryOverlayShadows: Set<string>;
  readonly leases: Set<ContractLeaseRecord>;
  readonly retirementHandlerFailures: unknown[];
  retirementNotificationDepth: number;
  retirementReason: unknown;
  hasRetirementReason: boolean;
  retirementNotificationStarted: boolean;
  settleLeaseDrain: (() => void) | undefined;
  rejectLeaseDrain: ((reason: unknown) => void) | undefined;
  retirementDrainQuarantined: boolean;
  retirementPromise: Promise<void> | undefined;
}

/** A stable reference captured with a resolved contract implementation. */
export interface ContractReference<T> {
  readonly name: string;
  readonly entry: ContractEntry<T>;
}

/** One active-use lease. Release is idempotent. */
export interface ContractLease {
  /**
   * Register the synchronous cancellation control for this use. When
   * retirement already started, registration invokes it immediately.
   */
  setRetirementHandler(handler: (reason: unknown) => void): void;
  /**
   * Close generation admission after this use outlives its cancellation grace.
   * The lease remains active until the provider reports terminal settlement.
   */
  quarantine(): void;
  /** Release this generation use. Safe to call more than once. */
  release(): void;
}

/** A contract implementation and the identity required to lease it. */
export interface ContractSnapshot<T> {
  readonly implementation: T;
  readonly reference: ContractReference<T>;
}

const NativeAggregateError = AggregateError;
const NativeError = Error;
const NativeMap = Map;
const NativePromise = Promise;
const NativeSet = Set;
const apply = Reflect.apply;
const arrayIteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const arrayIterator = Array.prototype[arrayIteratorSymbol];
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const setPrototypeOf = Object.setPrototypeOf;
const mapClear = Map.prototype.clear;
const mapDelete = Map.prototype.delete;
const mapForEach = Map.prototype.forEach;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
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
const registeredContracts = new NativeMap<string, ContractEntry>();
const generationResolutionStorage = new AsyncLocalStorage<
  ContractGenerationResolutionScope
>();
const asyncLocalStorageGetStore = AsyncLocalStorage.prototype.getStore;
const asyncLocalStorageRun = AsyncLocalStorage.prototype.run;

function createRegistryResetToken(): object {
  return freeze(createObject(null));
}

function createNullPrototypeRecord<T extends object>(record: T): T {
  return apply(setPrototypeOf, Object, [record, null]) as T;
}

function createDataDescriptor(
  value: unknown,
  configurable = false,
  writable = false,
): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = configurable;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = writable;
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

function copyArrayForAggregateError<T>(source: readonly T[]): T[] {
  const copy: T[] = [];
  for (let index = 0; index < source.length; index += 1) {
    appendArrayValue(copy, source[index]);
  }
  defineProperty(
    copy,
    arrayIteratorSymbol,
    createDataDescriptor(arrayIterator),
  );
  return copy;
}

function clearMap<K, V>(map: Map<K, V>): void {
  apply(mapClear, map, []);
}

function deleteMapValue<K, V>(map: Map<K, V>, key: K): boolean {
  return apply(mapDelete, map, [key]) as boolean;
}

function forEachMapValue<K, V>(
  map: Map<K, V>,
  callback: (value: V, key: K) => void,
): void {
  apply(mapForEach, map, [callback]);
}

function getMapValue<K, V>(map: Map<K, V>, key: K): V | undefined {
  return apply(mapGet, map, [key]) as V | undefined;
}

function setMapValue<K, V>(map: Map<K, V>, key: K, value: V): void {
  apply(mapSet, map, [key, value]);
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

function createPinnedPromise<T>(
  executor: (
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  const promise = new NativePromise<T>(executor);
  defineProperty(
    promise,
    "constructor",
    createDataDescriptor(NativePromise),
  );
  return promise;
}

function createResolvedPromise(): Promise<void> {
  return createPinnedPromise<void>((resolve) => resolve());
}

type ScopedResolutionState =
  | ContractGenerationResolutionScope
  | null
  | undefined;

function getScopedResolutionState(): ScopedResolutionState {
  const scope = apply(
    asyncLocalStorageGetStore,
    generationResolutionStorage,
    [],
  ) as ContractGenerationResolutionScope | undefined;
  if (scope === undefined) return undefined;
  if (!scope.active || scope.resetToken !== contractRegistryResetToken) {
    // A low-level reset is an epoch boundary. While stale cleanup is still
    // running, suppress both its candidate overlay and fallback into the new
    // global registry so it cannot act on replacement resources. Inactive
    // inherited scopes stay blocked so detached descendants cannot outlive
    // their teardown authority and later observe a replacement.
    return null;
  }
  return scope;
}

function extensionTeardownUnavailable(name: string): Error {
  return new NativeError(
    `Extension contract "${name}" is unavailable during extension teardown`,
  );
}

function assertNoLifecycleAdmissionDuringTeardown(name: string): void {
  if (getScopedResolutionState() !== undefined) {
    throw extensionTeardownUnavailable(name);
  }
}

function assertCurrentMutationScope(
  operation: string,
): ContractGenerationResolutionScope | undefined {
  const scope = getScopedResolutionState();
  if (scope === null) {
    throw new NativeError(
      `Cannot ${operation} extension contracts from an expired teardown scope`,
    );
  }
  return scope;
}

function assertNoGenerationTransitionDuringTeardown(operation: string): void {
  if (getScopedResolutionState() !== undefined) {
    throw new NativeError(
      `Cannot ${operation} an extension contract generation during extension teardown`,
    );
  }
}

/**
 * Reject candidate preparation before extension-controlled materialization or
 * transition hooks can run inside a current or inherited teardown scope.
 */
export function assertContractGenerationAdmissionAllowed(): void {
  assertNoGenerationTransitionDuringTeardown("start");
}

let activeGeneration: ContractGeneration | undefined;
let stagingGeneration: ContractGeneration | undefined;
let failedGenerationUnavailable = false;
let contractRegistryResetToken = createRegistryResetToken();

function createEntry<T>(
  implementation: T,
  generation?: ContractGeneration,
): ContractEntry<T> {
  return freeze(createNullPrototypeRecord<ContractEntry<T>>({
    implementation,
    generation,
  }));
}

function assertStagingGeneration(generation: ContractGeneration): void {
  if (generation.status !== "staging" || stagingGeneration !== generation) {
    throw new NativeError("Contract generation is not the active staging generation");
  }
}

function unavailableDuringTransition(name: string): Error {
  const entry = getMapValue(registeredContracts, name);
  if (entry?.generation?.status === "retiring") {
    return new NativeError(
      `Extension contract "${name}" is unavailable while its generation is retiring`,
    );
  }
  if (stagingGeneration !== undefined) {
    return new NativeError(
      "Extension contracts are unavailable while a generation is staging",
    );
  }
  if (failedGenerationUnavailable) {
    return new NativeError(
      "Extension contracts are unavailable because the previous generation failed",
    );
  }
  return new NativeError(
    `Extension contract "${name}" is unavailable because its captured generation is no longer active`,
  );
}

function notifyRetirement(
  generation: ContractGeneration,
  record: ContractLeaseRecord,
): void {
  if (
    record.released ||
    record.retirementNotified ||
    record.retirementHandler === undefined ||
    !generation.hasRetirementReason ||
    !generation.retirementNotificationStarted
  ) {
    return;
  }
  record.retirementNotified = true;
  generation.retirementNotificationDepth += 1;
  try {
    try {
      runWithContractGenerationEpochSync(
        generation,
        () => {
          apply(record.retirementHandler!, undefined, [
            generation.retirementReason,
          ]);
        },
      );
    } catch (error) {
      appendArrayValue(generation.retirementHandlerFailures, error);
    }
  } finally {
    generation.retirementNotificationDepth -= 1;
    finishLeaseDrain(generation);
  }
}

function finishLeaseDrain(generation: ContractGeneration): void {
  if (
    getSetSize(generation.leases) !== 0 ||
    generation.retirementNotificationDepth !== 0
  ) {
    return;
  }
  const settle = generation.settleLeaseDrain;
  generation.settleLeaseDrain = undefined;
  generation.rejectLeaseDrain = undefined;
  if (settle !== undefined) apply(settle, undefined, []);
}

function getQuarantinedLeaseFailure(
  generation: ContractGeneration,
): Error | undefined {
  let failure: Error | undefined;
  forEachSetValue(generation.leases, (record) => {
    if (failure === undefined && record.quarantined) {
      failure = record.quarantineFailure;
    }
  });
  return failure;
}

function rejectLeaseDrainForQuarantine(generation: ContractGeneration): boolean {
  const failure = getQuarantinedLeaseFailure(generation);
  if (failure === undefined) return false;
  const reject = generation.rejectLeaseDrain;
  if (reject === undefined) return true;
  generation.settleLeaseDrain = undefined;
  generation.rejectLeaseDrain = undefined;
  generation.retirementDrainQuarantined = true;
  apply(reject, undefined, [failure]);
  return true;
}

function throwRetirementHandlerFailures(generation: ContractGeneration): void {
  if (generation.retirementHandlerFailures.length === 0) return;
  if (generation.retirementHandlerFailures.length === 1) {
    throw generation.retirementHandlerFailures[0];
  }
  throw new NativeAggregateError(
    copyArrayForAggregateError(generation.retirementHandlerFailures),
    "Extension contract generation retirement controls failed",
  );
}

function unpublishExactGenerationEntries(generation: ContractGeneration): void {
  forEachMapValue(generation.entries, (entry, name) => {
    if (getMapValue(registeredContracts, name) === entry) {
      deleteMapValue(registeredContracts, name);
    }
  });
}

/** Read one raw public registration. */
export function tryResolveRegisteredContract<T>(name: string): T | undefined {
  const scopedResolution = getScopedResolutionState();
  if (scopedResolution === null) return undefined;
  if (scopedResolution?.entryOverlay !== undefined) {
    const overlay = scopedResolution.entryOverlay;
    if (!hasSetValue(overlay.entryOverlayShadows, name)) {
      const scopedEntry = getMapValue(overlay.entries, name);
      if (scopedEntry !== undefined) return scopedEntry.implementation as T;
    }
  }
  return getMapValue(registeredContracts, name)?.implementation as T | undefined;
}

function assertRetiringGeneration(generation: ContractGeneration): void {
  if (generation.status !== "retiring") {
    throw new NativeError(
      "Contract generation resolution scope requires a retiring generation",
    );
  }
}

function createContractGenerationResolutionScope(
  generation: ContractGeneration,
  entryOverlay?: ContractGeneration,
): ContractGenerationResolutionScope {
  return createNullPrototypeRecord<ContractGenerationResolutionScope>({
    entryOverlay,
    resetToken: generation.resetToken,
    active: true,
  });
}

function runWithContractGenerationScope<T>(
  generation: ContractGeneration,
  entryOverlay: ContractGeneration | undefined,
  operation: () => T | Promise<T>,
): Promise<T> {
  assertRetiringGeneration(generation);
  const scope = createContractGenerationResolutionScope(
    generation,
    entryOverlay,
  );
  try {
    return apply(
      asyncLocalStorageRun,
      generationResolutionStorage,
      [
        scope,
        async (): Promise<T> => {
          try {
            return await operation();
          } finally {
            scope.active = false;
          }
        },
      ],
    ) as Promise<T>;
  } catch (error) {
    scope.active = false;
    throw error;
  }
}

function runWithContractGenerationEpochSync<T>(
  generation: ContractGeneration,
  operation: () => T,
): T {
  assertRetiringGeneration(generation);
  const scope = createContractGenerationResolutionScope(generation);
  try {
    return apply(
      asyncLocalStorageRun,
      generationResolutionStorage,
      [scope, operation],
    ) as T;
  } finally {
    scope.active = false;
  }
}

/**
 * Bind raw contract resolution to a failed candidate during rollback.
 *
 * Failed candidates retain their unpublished staged dependencies. Reset and
 * hook settlement still revoke inherited descendants.
 */
export function runWithContractGenerationResolution<T>(
  generation: ContractGeneration,
  operation: () => T | Promise<T>,
): Promise<T> {
  return runWithContractGenerationScope(
    generation,
    generation,
    operation,
  );
}

/**
 * Bind teardown to one registry epoch without overriding current raw entries.
 *
 * Successful teardown keeps the registry's public overwrite semantics while
 * stale or detached work remains unable to cross a reset boundary.
 */
export function runWithContractGenerationEpoch<T>(
  generation: ContractGeneration,
  operation: () => T | Promise<T>,
): Promise<T> {
  return runWithContractGenerationScope(
    generation,
    undefined,
    operation,
  );
}

/** Install one unmanaged public registration. */
export function registerUnmanagedContract<T>(name: string, implementation: T): void {
  const scope = assertCurrentMutationScope("register");
  setMapValue(registeredContracts, name, createEntry(implementation));
  if (scope?.entryOverlay !== undefined) {
    addSetValue(scope.entryOverlay.entryOverlayShadows, name);
  }
}

/** Remove the current public registration without lifecycle coordination. */
export function unregisterContract(name: string): void {
  const scope = assertCurrentMutationScope("unregister");
  deleteMapValue(registeredContracts, name);
  if (scope?.entryOverlay !== undefined) {
    addSetValue(scope.entryOverlay.entryOverlayShadows, name);
  }
}

/**
 * Force-clear the public registry and lifecycle state.
 *
 * This preserves the historical synchronous reset primitive used by tests and
 * composition roots. Normal loader shutdown must use generation retirement.
 */
export function resetContractRegistry(): void {
  assertCurrentMutationScope("reset");
  clearMap(registeredContracts);
  activeGeneration = undefined;
  stagingGeneration = undefined;
  failedGenerationUnavailable = false;
  contractRegistryResetToken = createRegistryResetToken();
}

/** Start staging one candidate generation without publishing partial entries. */
export function beginContractGeneration(): ContractGeneration {
  assertContractGenerationAdmissionAllowed();
  if (stagingGeneration !== undefined) {
    throw new NativeError("Another extension contract generation is already staging");
  }
  const generation = createNullPrototypeRecord<ContractGeneration>({
    resetToken: contractRegistryResetToken,
    status: "staging",
    entries: new NativeMap(),
    entryOverlayShadows: new NativeSet(),
    leases: new NativeSet(),
    retirementHandlerFailures: [],
    retirementNotificationDepth: 0,
    retirementReason: undefined,
    hasRetirementReason: false,
    retirementNotificationStarted: false,
    settleLeaseDrain: undefined,
    rejectLeaseDrain: undefined,
    retirementDrainQuarantined: false,
    retirementPromise: undefined,
  });
  stagingGeneration = generation;
  return generation;
}

/** Stage or replace one loader-owned entry inside a candidate generation. */
export function stageContract<T>(
  generation: ContractGeneration,
  name: string,
  implementation: T,
): void {
  assertNoGenerationTransitionDuringTeardown("stage");
  assertCanonicalNonEmptyString(name, "Contract name");
  if (implementation === undefined) {
    throw new TypeError(`Contract "${name}" implementation must not be undefined`);
  }
  assertStagingGeneration(generation);
  setMapValue(generation.entries, name, createEntry(implementation, generation));
}

/** Resolve candidate-local dependencies without publishing the candidate. */
export function tryResolveContractForGeneration<T>(
  generation: ContractGeneration,
  name: string,
): T | undefined {
  assertCanonicalNonEmptyString(name, "Contract name");
  if (generation.resetToken !== contractRegistryResetToken) {
    throw new NativeError(
      `Extension contract "${name}" is unavailable after the registry was reset`,
    );
  }
  const staged = getMapValue(generation.entries, name);
  if (staged !== undefined) return staged.implementation as T;
  return tryResolveRegisteredContract<T>(name);
}

/** Atomically publish every staged entry and open active-use admission. */
export function commitContractGeneration(generation: ContractGeneration): void {
  assertNoGenerationTransitionDuringTeardown("commit");
  assertStagingGeneration(generation);
  if (activeGeneration?.status === "active") {
    throw new NativeError(
      "Cannot publish an extension contract generation before the active generation retires",
    );
  }
  forEachMapValue(registeredContracts, (entry) => {
    const owner = entry.generation;
    if (
      owner !== undefined &&
      owner !== generation &&
      owner.status !== "retired" &&
      owner.status !== "failed"
    ) {
      throw new NativeError(
        "Cannot publish an extension contract generation while a prior generation remains owned",
      );
    }
  });

  forEachMapValue(generation.entries, (entry, name) => {
    setMapValue(registeredContracts, name, entry);
  });
  generation.status = "active";
  activeGeneration = generation;
  stagingGeneration = undefined;
  failedGenerationUnavailable = false;
}

/**
 * Capture a contract for lifecycle-aware use.
 *
 * Missing is distinct from an unavailable transition: callers may apply their
 * documented fallback only for a stable, genuinely absent registration.
 */
export function trySnapshotContractForUse<T>(
  name: string,
): Readonly<ContractSnapshot<T>> | undefined {
  assertCanonicalNonEmptyString(name, "Contract name");
  assertNoLifecycleAdmissionDuringTeardown(name);
  if (stagingGeneration !== undefined) {
    throw unavailableDuringTransition(name);
  }
  const entry = getMapValue(registeredContracts, name) as ContractEntry<T> | undefined;
  if (entry !== undefined) {
    const owner = entry.generation;
    if (owner === undefined || owner.status === "active") {
      return freeze({
        implementation: entry.implementation,
        reference: freeze({ name, entry }),
      });
    }
    throw unavailableDuringTransition(name);
  }
  if (failedGenerationUnavailable) {
    throw unavailableDuringTransition(name);
  }
  return undefined;
}

/**
 * Capture only a loader-generation-owned contract for security-sensitive use.
 *
 * Ownerless registrations remain available to compatibility consumers through
 * `trySnapshotContractForUse`, but cannot satisfy a contract whose safety
 * depends on retirement fencing and active-use lease drainage.
 */
export function trySnapshotGenerationOwnedContractForUse<T>(
  name: string,
): Readonly<ContractSnapshot<T>> | undefined {
  const snapshot = trySnapshotContractForUse<T>(name);
  if (snapshot === undefined || snapshot.reference.entry.generation === undefined) {
    return undefined;
  }
  return snapshot;
}

/** Acquire active-use ownership immediately before invoking a contract. */
export function acquireContractLease<T>(
  reference: Readonly<ContractReference<T>>,
): Readonly<ContractLease> {
  assertNoLifecycleAdmissionDuringTeardown(reference.name);
  const entry = reference.entry;
  const generation = entry.generation;
  if (generation === undefined) {
    return freeze({
      setRetirementHandler() {},
      quarantine() {},
      release() {},
    });
  }
  if (
    stagingGeneration !== undefined ||
    generation.status !== "active" ||
    getMapValue(registeredContracts, reference.name) !== entry
  ) {
    throw unavailableDuringTransition(reference.name);
  }

  const record = createNullPrototypeRecord<ContractLeaseRecord>({
    released: false,
    quarantined: false,
    quarantineFailure: undefined,
    retirementNotified: false,
    retirementHandler: undefined,
  });
  addSetValue(generation.leases, record);
  let retirementHandlerRegistered = false;
  return freeze({
    setRetirementHandler(handler: (reason: unknown) => void): void {
      if (typeof handler !== "function") {
        throw new TypeError("Contract lease retirement handler must be a function");
      }
      if (record.released) {
        throw new NativeError("Cannot configure a released contract generation lease");
      }
      if (retirementHandlerRegistered) {
        throw new NativeError("Contract generation lease already has a retirement handler");
      }
      retirementHandlerRegistered = true;
      record.retirementHandler = handler;
      notifyRetirement(generation, record);
    },
    quarantine(): void {
      if (record.released || record.quarantined) return;
      const failure = new NativeError(
        `Extension contract generation is quarantined because "${reference.name}" has an unsettled use`,
      );
      record.quarantined = true;
      record.quarantineFailure = failure;
      if (generation.status === "active") {
        sealContractGeneration(generation, failure);
      }
      rejectLeaseDrainForQuarantine(generation);
    },
    release(): void {
      if (record.released) return;
      if (!deleteSetValue(generation.leases, record)) {
        throw new NativeError("Contract generation lease record is missing");
      }
      record.released = true;
      if (
        record.quarantined &&
        generation.retirementDrainQuarantined &&
        getQuarantinedLeaseFailure(generation) === undefined
      ) {
        generation.retirementPromise = undefined;
        generation.retirementDrainQuarantined = false;
      }
      finishLeaseDrain(generation);
    },
  });
}

/**
 * Close admission synchronously before contexts or other generation-owned
 * resources begin revocation.
 */
export function sealContractGeneration(
  generation: ContractGeneration,
  reason: unknown = new NativeError("Extension contract generation was retired"),
): void {
  if (generation.status === "retired" || generation.status === "failed") {
    return;
  }
  if (generation.status === "retiring") {
    return;
  }

  generation.status = "retiring";
  if (activeGeneration === generation) activeGeneration = undefined;
  generation.retirementReason = reason;
  generation.hasRetirementReason = true;
}

/**
 * Notify active uses synchronously, then await release or reject if an active
 * lease has quarantined the generation. A drain may be retried after release.
 */
export function drainContractGeneration(
  generation: ContractGeneration,
): Promise<void> {
  if (generation.status === "retired" || generation.status === "failed") {
    return createResolvedPromise();
  }
  if (generation.status !== "retiring") {
    throw new NativeError("Contract generation must be sealed before it can drain");
  }
  if (generation.retirementPromise !== undefined) {
    return generation.retirementPromise;
  }

  const retirement = createPinnedPromise<void>((resolve, reject) => {
    generation.settleLeaseDrain = (): void => {
      try {
        throwRetirementHandlerFailures(generation);
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    generation.rejectLeaseDrain = reject;
  });
  generation.retirementPromise = retirement;
  generation.retirementNotificationStarted = true;
  forEachSetValue(generation.leases, (record) => {
    notifyRetirement(generation, record);
  });
  if (!rejectLeaseDrainForQuarantine(generation)) {
    finishLeaseDrain(generation);
  }
  return retirement;
}

/** Whether every admitted use has released before extension teardown begins. */
export function isContractGenerationDrained(generation: ContractGeneration): boolean {
  return getSetSize(generation.leases) === 0;
}

/** Complete a successful teardown and remove only this generation's entries. */
export function completeContractGenerationRetirement(
  generation: ContractGeneration,
): void {
  if (generation.status !== "retiring") {
    throw new NativeError("Contract generation must retire before teardown can complete");
  }
  if (!isContractGenerationDrained(generation)) {
    throw new NativeError("Contract generation still has active leases");
  }
  const ownsCurrentRegistry = generation.resetToken === contractRegistryResetToken;
  if (ownsCurrentRegistry) {
    unpublishExactGenerationEntries(generation);
  }
  generation.status = "retired";
  if (ownsCurrentRegistry) {
    if (activeGeneration === generation) activeGeneration = undefined;
    if (stagingGeneration === generation) stagingGeneration = undefined;
  }
}

/**
 * Finish a failed candidate. Absence remains fail-closed until a later
 * generation commits successfully or the low-level registry is reset.
 */
export function failContractGeneration(
  generation: ContractGeneration,
): void {
  if (!isContractGenerationDrained(generation)) {
    throw new NativeError("Failed contract generation still has active leases");
  }
  const ownsCurrentRegistry = generation.resetToken === contractRegistryResetToken;
  if (ownsCurrentRegistry) {
    unpublishExactGenerationEntries(generation);
  }
  generation.status = "failed";
  if (ownsCurrentRegistry) {
    if (activeGeneration === generation) activeGeneration = undefined;
    if (stagingGeneration === generation) stagingGeneration = undefined;
    failedGenerationUnavailable = activeGeneration === undefined;
  }
}
