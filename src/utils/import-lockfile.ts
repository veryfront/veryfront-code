import { computeHash } from "./hash-utils.ts";
import { generateUuid } from "./id.ts";
import { serverLogger } from "./logger/index.ts";
import {
  createFileSystem,
  realPath as resolvePlatformRealPath,
} from "#veryfront/platform/compat/fs.ts";
import { normalize } from "#veryfront/compat/path/resolution.ts";
import {
  CACHE_ERROR,
  INVALID_ARGUMENT,
  LOCKFILE_FORMAT_MISMATCH,
  LOCKFILE_READ_ERROR,
  NETWORK_ERROR,
} from "#veryfront/errors/error-registry.ts";
import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";

const logger = serverLogger.component("lockfile");

export interface LockfileEntry {
  resolved: string;
  integrity: string;
  dependencies?: string[];
  fetchedAt?: string;
}

export interface LockfileData {
  version: 1;
  imports: Record<string, LockfileEntry>;
}

const LOCKFILE_NAME = "veryfront.lock";
const LOCKFILE_VERSION = 1;
const LOCKFILE_CANONICALIZATION_TIMEOUT_MS = 1_000;
// Canonicalization failures are exceptional and must not create an unbounded
// process-wide journal. The limit applies only while a shared backing store
// cannot establish stable identities; healthy paths reconcile and release
// records as normal.
const MAX_UNRESOLVED_LOCKFILE_RECORDS = 1_024;
// Historical aliases are opportunistic. Never let an old or deleted project
// hold the shared filesystem queue for the normal one-second path timeout.
const HISTORICAL_LOCKFILE_CANONICALIZATION_TIMEOUT_MS = 25;
const MAX_HISTORICAL_RECONCILIATIONS_PER_ACCESS = 8;
const MAX_HISTORICAL_CANONICALIZATION_ATTEMPTS = 8;
const HISTORICAL_CANONICALIZATION_RETRY_BASE_MS = 250;
const HISTORICAL_CANONICALIZATION_RETRY_MAX_MS = 30_000;
const apply = Reflect.apply;
const NativeError = Error;
const NativeFinalizationRegistry = FinalizationRegistry;
const NativeJSON = JSON;
const NativeMap = Map;
const NativePromise = Promise;
const NativeURL = URL;
const NativeWeakMap = WeakMap;
const NativeWeakRef = WeakRef;
const arrayIsArray = Array.isArray;
const arraySort = Array.prototype.sort;
const finalizationRegistryRegister = FinalizationRegistry.prototype.register;
const finalizationRegistryUnregister = FinalizationRegistry.prototype.unregister;
const mapClear = Map.prototype.clear;
const mapDelete = Map.prototype.delete;
const mapEntries = Map.prototype.entries;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const jsonParse = JSON.parse;
const jsonStringify = JSON.stringify;
const nativeClearTimeout = clearTimeout;
const nativeSetTimeout = setTimeout;
const numberIsSafeInteger = Number.isSafeInteger;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectEntries = Object.entries;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwn = Object.hasOwn;
const objectKeys = Object.keys;
const mapIteratorNext = objectGetPrototypeOf(new NativeMap().entries()).next;
const mapSizeGetter = objectGetOwnPropertyDescriptor(Map.prototype, "size")!.get!;
const promiseResolve = Promise.resolve;
const promiseReject = Promise.reject;
const promiseThen = Promise.prototype.then;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const weakRefDeref = WeakRef.prototype.deref;
const urlToString = URL.prototype.toString;
const dateNow = Date.now;

function getMapValue<K, V>(map: Map<K, V>, key: K): V | undefined {
  return apply(mapGet, map, [key]) as V | undefined;
}

function setMapValue<K, V>(map: Map<K, V>, key: K, value: V): void {
  apply(mapSet, map, [key, value]);
}

function deleteMapValue<K, V>(map: Map<K, V>, key: K): boolean {
  return apply(mapDelete, map, [key]) as boolean;
}

function clearMap<K, V>(map: Map<K, V>): void {
  apply(mapClear, map, []);
}

function getMapSize<K, V>(map: Map<K, V>): number {
  return apply(mapSizeGetter, map, []) as number;
}

function getWeakMapValue<K extends WeakKey, V>(map: WeakMap<K, V>, key: K): V | undefined {
  return apply(weakMapGet, map, [key]) as V | undefined;
}

function setWeakMapValue<K extends WeakKey, V>(map: WeakMap<K, V>, key: K, value: V): void {
  apply(weakMapSet, map, [key, value]);
}

function dereference<T extends WeakKey>(reference: WeakRef<T>): T | undefined {
  return apply(weakRefDeref, reference, []) as T | undefined;
}

function registerFinalizer<T>(
  registry: FinalizationRegistry<T>,
  target: object,
  heldValue: T,
  unregisterToken: object,
): void {
  apply(finalizationRegistryRegister, registry, [target, heldValue, unregisterToken]);
}

function unregisterFinalizer<T>(
  registry: FinalizationRegistry<T>,
  unregisterToken: object,
): boolean {
  return apply(finalizationRegistryUnregister, registry, [unregisterToken]) as boolean;
}

function resolveVoidPromise(): Promise<void> {
  return apply(promiseResolve, NativePromise, []) as Promise<void>;
}

function rejectPromise<T = never>(reason: unknown): Promise<T> {
  return apply(promiseReject, NativePromise, [reason]) as Promise<T>;
}

function thenPromise<T, TResult1 = T, TResult2 = never>(
  promise: Promise<T>,
  onFulfilled?: ((value: T) => TResult1) | null,
  onRejected?: ((reason: unknown) => TResult2) | null,
): Promise<TResult1 | TResult2> {
  return apply(promiseThen, promise, [onFulfilled, onRejected]) as Promise<
    TResult1 | TResult2
  >;
}

function chainPromise<T, TResult>(
  promise: Promise<T>,
  onFulfilled: (value: T) => Promise<TResult>,
): Promise<TResult> {
  return new NativePromise<TResult>((resolve, reject) => {
    thenPromise(
      promise,
      (value) => {
        let next: Promise<TResult>;
        try {
          next = onFulfilled(value);
        } catch (error) {
          reject(error);
          return;
        }
        // Do not return `next` from this handler. Native promise adoption reads
        // the live `.then` property, which tenant code can replace after this
        // module loads. Apply the captured intrinsic explicitly instead.
        thenPromise(next, resolve, reject);
      },
      reject,
    );
  });
}

function allPromises<T>(promises: readonly Promise<T>[]): Promise<T[]> {
  return new NativePromise<T[]>((resolve, reject) => {
    const results: T[] = [];
    results.length = promises.length;
    let remaining = promises.length;
    if (remaining === 0) {
      resolve(results);
      return;
    }
    for (let index = 0; index < promises.length; index++) {
      thenPromise(
        promises[index]!,
        (value) => {
          results[index] = value;
          remaining--;
          if (remaining === 0) resolve(results);
        },
        reject,
      );
    }
  });
}

function racePromiseWithTimeout<T, TTimeout>(
  promise: Promise<T>,
  timeoutValue: TTimeout,
  timeoutMs: number,
): { promise: Promise<T | TTimeout>; cancelTimeout: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const raced = new NativePromise<T | TTimeout>((resolve, reject) => {
    thenPromise(promise, resolve, reject);
    timeoutId = nativeSetTimeout(() => resolve(timeoutValue), timeoutMs);
  });
  return {
    promise: raced,
    cancelTimeout: () => {
      if (timeoutId !== undefined) nativeClearTimeout(timeoutId);
    },
  };
}

function forEachMapEntry<K, V>(
  map: Map<K, V>,
  callback: (key: K, value: V) => void | boolean,
): void {
  const iterator = apply(mapEntries, map, []) as MapIterator<[K, V]>;
  while (true) {
    const next = apply(mapIteratorNext, iterator, []) as IteratorResult<[K, V]>;
    if (next.done) return;
    if (callback(next.value[0], next.value[1]) === false) return;
  }
}

function cloneLockfileEntry(entry: LockfileEntry): LockfileEntry {
  const sanitized = sanitizeLockfileEntry(entry);
  if (sanitized === null) throw lockfileInputError("invalid-structure");
  return sanitized;
}

function defineImportEntry(
  imports: Record<string, LockfileEntry>,
  url: string,
  entry: LockfileEntry,
): void {
  // A null-prototype descriptor is required here. Tenant code can mutate
  // Object.prototype in a shared runtime; inherited accessor/value fields can
  // otherwise turn an ordinary data descriptor into an invalid descriptor.
  const descriptor = objectCreate(null) as PropertyDescriptor;
  descriptor.value = entry;
  descriptor.enumerable = true;
  descriptor.configurable = true;
  descriptor.writable = true;
  objectDefineProperty(imports, url, descriptor);
}

function createImportDictionary(
  entries: readonly (readonly [string, LockfileEntry])[] = [],
  prototype: "internal" | "public" = "internal",
): Record<string, LockfileEntry> {
  const imports = prototype === "internal"
    ? objectCreate(null) as Record<string, LockfileEntry>
    : {};
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    defineImportEntry(imports, entry[0], entry[1]);
  }
  return imports;
}

function cloneLockfileData(
  data: LockfileData,
  prototype: "internal" | "public" = "internal",
): LockfileData {
  const sourceEntries = objectEntries(data.imports);
  const entries: Array<[string, LockfileEntry]> = [];
  entries.length = sourceEntries.length;
  for (let index = 0; index < sourceEntries.length; index++) {
    const sourceEntry = sourceEntries[index]!;
    entries[index] = [sourceEntry[0], cloneLockfileEntry(sourceEntry[1])];
  }
  return {
    version: LOCKFILE_VERSION,
    imports: createImportDictionary(entries, prototype),
  };
}

function createInternalLockfile(): LockfileData {
  return { version: LOCKFILE_VERSION, imports: createImportDictionary() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !arrayIsArray(value);
}

function getOwnDataProperty(
  value: Record<string, unknown> | readonly unknown[],
  key: PropertyKey,
): { readonly value: unknown } | undefined {
  const descriptor = objectGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !objectHasOwn(descriptor, "value")) return undefined;
  return { value: descriptor.value };
}

function sanitizeLockfileEntry(value: unknown): LockfileEntry | null {
  if (!isRecord(value)) return null;

  const resolved = getOwnDataProperty(value, "resolved")?.value;
  const integrity = getOwnDataProperty(value, "integrity")?.value;
  if (typeof resolved !== "string" || typeof integrity !== "string") return null;

  const dependencies = getOwnDataProperty(value, "dependencies")?.value;
  let sanitizedDependencies: string[] | undefined;
  if (dependencies !== undefined) {
    const sanitized = sanitizeStringArray(dependencies);
    if (sanitized === null) return null;
    sanitizedDependencies = sanitized;
  }

  const fetchedAt = getOwnDataProperty(value, "fetchedAt")?.value;
  if (fetchedAt !== undefined && typeof fetchedAt !== "string") return null;

  return {
    resolved,
    integrity,
    ...(sanitizedDependencies === undefined ? {} : { dependencies: sanitizedDependencies }),
    ...(fetchedAt === undefined ? {} : { fetchedAt }),
  };
}

function sanitizeStringArray(value: unknown): string[] | null {
  if (!arrayIsArray(value)) return null;
  const length = getOwnDataProperty(value, "length")?.value;
  if (typeof length !== "number" || !numberIsSafeInteger(length) || length < 0) return null;

  const sanitized: string[] = [];
  let index = 0;
  const keys = objectKeys(value);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex]!;
    if (key !== String(index)) continue;
    const item = getOwnDataProperty(value, key)?.value;
    if (typeof item !== "string") return null;
    objectDefineProperty(sanitized, index, {
      value: item,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    index++;
  }
  return index === length ? sanitized : null;
}

function lockfileReadError(
  lockfilePath: string,
  reason: "access-failed" | "invalid-json" | "invalid-structure",
  cause?: unknown,
) {
  const description = reason === "access-failed"
    ? "could not be accessed"
    : reason === "invalid-json"
    ? "does not contain valid JSON"
    : "has an invalid structure";

  return LOCKFILE_READ_ERROR.create({
    detail: `The lockfile ${description}. The file was left untouched.`,
    cause,
    context: { lockfilePath, reason },
  });
}

function lockfileInputError(
  reason: "invalid-structure",
  cause?: unknown,
) {
  return INVALID_ARGUMENT.create({
    detail: "The provided lockfile data has an invalid structure. The file was left untouched.",
    cause,
    context: { reason },
  });
}

function lockfileFormatMismatch(lockfilePath: string, version: number) {
  return LOCKFILE_FORMAT_MISMATCH.create({
    detail: `The lockfile uses format version ${version}, but this ` +
      `Veryfront build supports version ${LOCKFILE_VERSION}. The file was left untouched. ` +
      "Upgrade Veryfront or migrate the lockfile before reading or modifying it.",
    context: {
      lockfilePath,
      expectedVersion: LOCKFILE_VERSION,
      actualVersion: version,
    },
  });
}

function sanitizeLockfileData(
  value: unknown,
  lockfilePath: string,
  invalidStructureError: () => Error = () => lockfileReadError(lockfilePath, "invalid-structure"),
): LockfileData {
  if (!isRecord(value)) throw invalidStructureError();

  const version = getOwnDataProperty(value, "version")?.value;
  if (typeof version !== "number" || !numberIsSafeInteger(version)) {
    throw invalidStructureError();
  }
  if (version !== LOCKFILE_VERSION) {
    throw lockfileFormatMismatch(lockfilePath, version);
  }
  const parsedImports = getOwnDataProperty(value, "imports")?.value;
  if (!isRecord(parsedImports)) {
    throw invalidStructureError();
  }

  const imports: Array<[string, LockfileEntry]> = [];
  const urls = objectKeys(parsedImports);
  for (let index = 0; index < urls.length; index++) {
    const url = urls[index]!;
    const entry = getOwnDataProperty(parsedImports, url)?.value;
    const sanitizedEntry = sanitizeLockfileEntry(entry);
    if (sanitizedEntry === null) {
      throw invalidStructureError();
    }
    imports[imports.length] = [url, sanitizedEntry];
  }
  return { version: LOCKFILE_VERSION, imports: createImportDictionary(imports) };
}

function parseLockfile(content: string, lockfilePath: string): LockfileData {
  let parsed: unknown;
  try {
    parsed = apply(jsonParse, NativeJSON, [content]);
  } catch (cause) {
    throw lockfileReadError(lockfilePath, "invalid-json", cause);
  }

  return sanitizeLockfileData(parsed, lockfilePath);
}

export function createEmptyLockfile(): LockfileData {
  return { version: LOCKFILE_VERSION, imports: createImportDictionary([], "public") };
}

/** Compute integrity. */
export async function computeIntegrity(content: string): Promise<string> {
  const hash = await computeHash(content);
  return `sha256-${hash}`;
}

export async function verifyIntegrity(content: string, integrity: string): Promise<boolean> {
  const computed = await computeIntegrity(content);
  return computed === integrity;
}

/**
 * Public API contract for lockfile manager.
 *
 * Reads and updates fail closed with `lockfile-format-mismatch` for an
 * unsupported format and `lockfile-read-error` for unreadable or malformed
 * data, so an older Veryfront build cannot overwrite unrecognized lockfile
 * data. `clear()` is the explicit destructive recovery operation and does not
 * parse the file before removing it.
 */
export interface LockfileManager {
  read(): Promise<LockfileData | null>;
  write(data: LockfileData): Promise<void>;
  get(url: string): Promise<LockfileEntry | null>;
  set(url: string, entry: LockfileEntry): Promise<void>;
  has(url: string): Promise<boolean>;
  clear(): Promise<void>;
  flush(): Promise<void>;
}

export type FSAdapter = {
  /**
   * Authoritative queue identity for adapters that access the same backing
   * filesystem. Separate adapter objects must share this key to coordinate all
   * lockfile access, regardless of their optional canonicalization support.
   */
  readonly coordinationKey?: string;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /**
   * Atomically replace `to` with the file at `from` (same-directory rename).
   * When present, lockfile writes stage a temp file and rename it into place,
   * so a crash mid-write can never leave a truncated lockfile behind.
   */
  rename?(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove?(path: string): Promise<void>;
  /**
   * Resolve an existing project path to its stable backing identity.
   * Coordination through realPath is per-adapter-instance (or per shared
   * coordinationKey domain): two separate adapter instances without a shared
   * coordinationKey never serialize with each other through realPath alone,
   * even when both implementations agree on the canonical path.
   */
  realPath?(path: string): Promise<string>;
};

const PLATFORM_FS_COORDINATION_KEY = "veryfront-platform-filesystem";
const adapterIdentityByInstance = new NativeWeakMap<FSAdapter, bigint>();
const lockfileAccessTails = new NativeMap<string, Promise<void>>();
interface LockfileSharedState {
  parent?: LockfileSharedState;
  revision: bigint;
  lastClearSequence: bigint;
}

interface PendingLockfileEntry {
  entry: LockfileEntry;
  sequence: bigint;
}

interface LockfileCoordinationRecord {
  recordKey: string;
  projectDir: string;
  logicalStateKey: string;
  state?: WeakRef<LockfileSharedState>;
  retainedState?: LockfileSharedState;
  historicalAttempts?: number;
  historicalRetryAfter?: number;
  historicalCanonicalization?: Promise<string | undefined>;
}

interface LockfileCoordinationDomain {
  records: Map<string, LockfileCoordinationRecord>;
}

interface LockfileCoordinationDomainReference {
  reference: WeakRef<LockfileCoordinationDomain>;
  unregisterToken: object;
}

interface LockfileCanonicalizationState {
  inFlight?: Promise<string>;
  completed?: {
    promise: Promise<string>;
    canonicalPath: string;
  };
}

interface LockfileSharedStateReference {
  reference: WeakRef<LockfileSharedState>;
  unregisterToken: object;
}

const lockfileSharedStateReferences = new NativeMap<string, LockfileSharedStateReference>();
const lockfileSharedStateAccessIdentities = new NativeWeakMap<LockfileSharedState, bigint>();
const lockfileCoordinationDomainByAdapter = new NativeWeakMap<
  FSAdapter,
  LockfileCoordinationDomain
>();
const sharedLockfileCoordinationDomains = new NativeMap<
  string,
  LockfileCoordinationDomainReference
>();
const sharedLockfileCoordinationRegistry = new NativeFinalizationRegistry<{
  accessKey: string;
  unregisterToken: object;
}>(({ accessKey, unregisterToken }) => {
  const current = getMapValue(sharedLockfileCoordinationDomains, accessKey);
  if (
    current?.unregisterToken === unregisterToken &&
    dereference(current.reference) === undefined
  ) {
    deleteMapValue(sharedLockfileCoordinationDomains, accessKey);
  }
});
let nextLockfileMutationSequence = 1n;
let nextLockfileSharedStateAccessIdentity = 1n;
const lockfileSharedStateRegistry = new NativeFinalizationRegistry<{
  stateKey: string;
  unregisterToken: object;
}>(({ stateKey, unregisterToken }) => {
  const current = getMapValue(lockfileSharedStateReferences, stateKey);
  if (
    current?.unregisterToken === unregisterToken &&
    dereference(current.reference) === undefined
  ) {
    deleteMapValue(lockfileSharedStateReferences, stateKey);
  }
});
let nextAdapterIdentity = 1n;

function createLockfileSharedState(): LockfileSharedState {
  const state = objectCreate(null) as LockfileSharedState;
  state.revision = 0n;
  state.lastClearSequence = 0n;
  return state;
}

function resolveLockfileSharedState(state: LockfileSharedState): LockfileSharedState {
  let root = state;
  while (root.parent) root = root.parent;
  let current = state;
  while (current.parent && current.parent !== root) {
    const parent = current.parent;
    current.parent = root;
    current = parent;
  }
  return root;
}

function getLockfileSharedStateAccessKey(state: LockfileSharedState): string {
  const root = resolveLockfileSharedState(state);
  let identity = getWeakMapValue(lockfileSharedStateAccessIdentities, root);
  if (identity === undefined) {
    identity = nextLockfileSharedStateAccessIdentity++;
    setWeakMapValue(lockfileSharedStateAccessIdentities, root, identity);
  }
  return `lockfile-state:${identity}`;
}

function registerLockfileSharedState(
  stateKey: string,
  state: LockfileSharedState,
): void {
  const root = resolveLockfileSharedState(state);
  const current = getMapValue(lockfileSharedStateReferences, stateKey);
  if (current && dereference(current.reference) === root) return;
  if (current) unregisterFinalizer(lockfileSharedStateRegistry, current.unregisterToken);

  const unregisterToken = objectCreate(null) as object;
  setMapValue(lockfileSharedStateReferences, stateKey, {
    reference: new NativeWeakRef(root),
    unregisterToken,
  });
  registerFinalizer(
    lockfileSharedStateRegistry,
    root,
    { stateKey, unregisterToken },
    unregisterToken,
  );
}

function getLockfileSharedState(stateKeys: readonly string[]): LockfileSharedState {
  const uniqueStateKeys: string[] = [];
  for (let stateKeyIndex = 0; stateKeyIndex < stateKeys.length; stateKeyIndex++) {
    const stateKey = stateKeys[stateKeyIndex]!;
    let duplicate = false;
    for (let knownKeyIndex = 0; knownKeyIndex < uniqueStateKeys.length; knownKeyIndex++) {
      const knownKey = uniqueStateKeys[knownKeyIndex]!;
      if (knownKey === stateKey) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) uniqueStateKeys[uniqueStateKeys.length] = stateKey;
  }

  const roots: LockfileSharedState[] = [];
  for (let stateKeyIndex = 0; stateKeyIndex < uniqueStateKeys.length; stateKeyIndex++) {
    const stateKey = uniqueStateKeys[stateKeyIndex]!;
    const reference = getMapValue(lockfileSharedStateReferences, stateKey)?.reference;
    const referenced = reference ? dereference(reference) : undefined;
    if (!referenced) continue;
    const root = resolveLockfileSharedState(referenced);
    let duplicate = false;
    for (let rootIndex = 0; rootIndex < roots.length; rootIndex++) {
      const knownRoot = roots[rootIndex]!;
      if (knownRoot === root) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) roots[roots.length] = root;
  }

  const state = roots[0] ?? createLockfileSharedState();
  for (let index = 1; index < roots.length; index++) {
    const other = roots[index]!;
    other.parent = state;
    state.revision = (state.revision > other.revision ? state.revision : other.revision) + 1n;
    state.lastClearSequence = state.lastClearSequence > other.lastClearSequence
      ? state.lastClearSequence
      : other.lastClearSequence;
  }
  for (let stateKeyIndex = 0; stateKeyIndex < uniqueStateKeys.length; stateKeyIndex++) {
    registerLockfileSharedState(uniqueStateKeys[stateKeyIndex]!, state);
  }
  return state;
}

function getAdapterInstanceIdentity(fs: FSAdapter): string {
  let identity = getWeakMapValue(adapterIdentityByInstance, fs);
  if (identity === undefined) {
    identity = nextAdapterIdentity++;
    setWeakMapValue(adapterIdentityByInstance, fs, identity);
  }
  return `instance:${identity}`;
}

function getLockfileCoordinationDomain(
  fs: FSAdapter,
  accessKey: string,
  hasSharedCoordinationKey: boolean,
  managerDomain?: LockfileCoordinationDomain,
): LockfileCoordinationDomain {
  if (hasSharedCoordinationKey) {
    if (managerDomain) return managerDomain;
    const current = getMapValue(sharedLockfileCoordinationDomains, accessKey);
    let domain = current ? dereference(current.reference) : undefined;
    if (!domain) {
      if (current) {
        unregisterFinalizer(sharedLockfileCoordinationRegistry, current.unregisterToken);
      }
      domain = objectCreate(null) as LockfileCoordinationDomain;
      domain.records = new NativeMap();
      const unregisterToken = objectCreate(null) as object;
      setMapValue(sharedLockfileCoordinationDomains, accessKey, {
        reference: new NativeWeakRef(domain),
        unregisterToken,
      });
      registerFinalizer(
        sharedLockfileCoordinationRegistry,
        domain,
        { accessKey, unregisterToken },
        unregisterToken,
      );
    }
    return domain;
  }

  let domain = getWeakMapValue(lockfileCoordinationDomainByAdapter, fs);
  if (!domain) {
    domain = objectCreate(null) as LockfileCoordinationDomain;
    domain.records = new NativeMap();
    setWeakMapValue(lockfileCoordinationDomainByAdapter, fs, domain);
  }
  return domain;
}

async function resolveCanonicalLockfilePath(
  fs: FSAdapter,
  projectDir: string,
  timeoutMs = LOCKFILE_CANONICALIZATION_TIMEOUT_MS,
  state?: LockfileCanonicalizationState,
): Promise<string | undefined> {
  if (!fs.realPath) return undefined;
  if (state?.completed) {
    const canonicalPath = state.completed.canonicalPath;
    state.completed = undefined;
    return canonicalPath;
  }

  let resolution = state?.inFlight;
  if (!resolution) {
    resolution = thenPromise(
      chainPromise(resolveVoidPromise(), () => fs.realPath!(projectDir)),
      (canonicalProjectDir) => normalize(`${normalize(canonicalProjectDir)}/${LOCKFILE_NAME}`),
    );
    if (state) {
      state.inFlight = resolution;
      void thenPromise(
        resolution,
        (canonicalPath) => {
          if (state.inFlight !== resolution) return;
          state.inFlight = undefined;
          state.completed = { promise: resolution!, canonicalPath };
        },
        () => {
          if (state.inFlight === resolution) state.inFlight = undefined;
        },
      );
    }
  }

  const timedOut = Symbol("lockfile canonicalization timed out");
  const race = racePromiseWithTimeout(resolution, timedOut, timeoutMs);
  try {
    const canonicalProjectDirResult = await race.promise;
    if (canonicalProjectDirResult === timedOut) return undefined;
    if (state?.completed?.promise === resolution) state.completed = undefined;
    return canonicalProjectDirResult;
  } catch {
    return undefined;
  } finally {
    race.cancelTimeout();
  }
}

function pruneCollectedCoordinationRecords(domain: LockfileCoordinationDomain): void {
  forEachMapEntry(domain.records, (recordKey, record) => {
    const liveState = record.state ? dereference(record.state) : undefined;
    if (!record.retainedState && liveState === undefined) {
      deleteMapValue(domain.records, recordKey);
    }
  });
}

function getUnresolvedCoordinationRecord(
  domain: LockfileCoordinationDomain,
  projectDir: string,
  lockfilePath: string,
  logicalStateKey: string,
): LockfileCoordinationRecord {
  const existing = getMapValue(domain.records, logicalStateKey);
  if (existing) return existing;

  if (getMapSize(domain.records) >= MAX_UNRESOLVED_LOCKFILE_RECORDS) {
    pruneCollectedCoordinationRecords(domain);
  }
  if (getMapSize(domain.records) >= MAX_UNRESOLVED_LOCKFILE_RECORDS) {
    throw lockfileReadError(
      lockfilePath,
      "access-failed",
      new NativeError(
        `The shared lockfile coordinator reached its limit of ` +
          `${MAX_UNRESOLVED_LOCKFILE_RECORDS} unresolved project paths`,
      ),
    );
  }

  const record = objectCreate(null) as LockfileCoordinationRecord;
  record.recordKey = logicalStateKey;
  record.projectDir = projectDir;
  record.logicalStateKey = logicalStateKey;
  return record;
}

async function reconcileHistoricalCoordinationRecords(
  fs: FSAdapter,
  domain: LockfileCoordinationDomain,
  currentRecordKey: string,
  accessKey: string,
): Promise<boolean> {
  const candidates: Array<{
    recordKey: string;
    record: LockfileCoordinationRecord;
    state: LockfileSharedState;
    canonicalization?: Promise<string | undefined>;
    ownsCanonicalization?: boolean;
  }> = [];
  const now = dateNow();

  // Durable mutations take precedence over warmed-reader hints. A second pass
  // fills the remaining bounded batch with live weak records.
  for (let durablePass = 0; durablePass < 2; durablePass++) {
    const durableOnly = durablePass === 0;
    forEachMapEntry(domain.records, (knownRecordKey, knownRecord) => {
      if (knownRecordKey === currentRecordKey) return;
      if (candidates.length >= MAX_HISTORICAL_RECONCILIATIONS_PER_ACCESS) return false;
      if (durableOnly !== (knownRecord.retainedState !== undefined)) return;
      if (
        (knownRecord.historicalAttempts ?? 0) >=
          MAX_HISTORICAL_CANONICALIZATION_ATTEMPTS ||
        (knownRecord.historicalRetryAfter ?? 0) > now
      ) {
        return;
      }
      const knownState = knownRecord.retainedState ??
        (knownRecord.state ? dereference(knownRecord.state) : undefined);
      if (!knownState) {
        deleteMapValue(domain.records, knownRecordKey);
        return;
      }
      candidates[candidates.length] = {
        recordKey: knownRecordKey,
        record: knownRecord,
        state: knownState,
      };
    });
  }

  // Resolve one bounded batch concurrently, so N stale paths cost at most the
  // historical timeout once rather than N times while the shared queue waits.
  const canonicalizationPromises: Array<Promise<string | undefined>> = [];
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    let canonicalization = candidate.record.historicalCanonicalization;
    if (!canonicalization) {
      canonicalization = resolveCanonicalLockfilePath(
        fs,
        candidate.record.projectDir,
        HISTORICAL_LOCKFILE_CANONICALIZATION_TIMEOUT_MS,
      );
      candidate.record.historicalCanonicalization = canonicalization;
      candidate.ownsCanonicalization = true;
    }
    candidate.canonicalization = canonicalization;
    canonicalizationPromises[index] = canonicalization;
  }
  const canonicalPaths = await allPromises(canonicalizationPromises);
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index]!;
    // Concurrent healthy projects share the same bounded historical lookup.
    // Only its owner mutates retry/state bookkeeping once it settles.
    if (!candidate.ownsCanonicalization) continue;
    if (candidate.record.historicalCanonicalization === candidate.canonicalization) {
      candidate.record.historicalCanonicalization = undefined;
    }
    const knownCanonicalPath = canonicalPaths[index];
    if (knownCanonicalPath === undefined) {
      const attempts = (candidate.record.historicalAttempts ?? 0) + 1;
      candidate.record.historicalAttempts = attempts;
      const retryDelay = HISTORICAL_CANONICALIZATION_RETRY_BASE_MS *
        2 ** (attempts - 1);
      candidate.record.historicalRetryAfter = now +
        (retryDelay < HISTORICAL_CANONICALIZATION_RETRY_MAX_MS
          ? retryDelay
          : HISTORICAL_CANONICALIZATION_RETRY_MAX_MS);
      // Keep failures retryable without letting a permanently missing project
      // starve records inserted later in the bounded journal. Attempts are
      // finite here; the record's own manager can still retry its canonical
      // identity on every operation and reconcile it without this path.
      deleteMapValue(domain.records, candidate.recordKey);
      setMapValue(domain.records, candidate.recordKey, candidate.record);
      continue;
    }

    deleteMapValue(domain.records, candidate.recordKey);
    getLockfileSharedState([
      candidate.record.logicalStateKey,
      apply(jsonStringify, NativeJSON, [[accessKey, knownCanonicalPath]]) as string,
    ]);
  }
  return candidates.length > 0;
}

async function resolveLockfileCoordinationIdentity(
  fs: FSAdapter,
  projectDir: string,
  lockfilePath: string,
  accessKey: string,
  hasSharedCoordinationKey: boolean,
  canonicalizationState: LockfileCanonicalizationState,
  managerDomain?: LockfileCoordinationDomain,
): Promise<{
  coordinationDomain: LockfileCoordinationDomain;
  stateKeys: string[];
  unresolvedRecord?: LockfileCoordinationRecord;
  resolvedRecordKey?: string;
  reconciledUnresolvedRecords?: boolean;
}> {
  // A declared coordination key is the complete shared lock domain. Including
  // a canonical path here would split adapters that share a backing store when
  // only some of them implement realPath, recreating a read-merge-write race.
  const logicalStateKey = apply(jsonStringify, NativeJSON, [[accessKey, lockfilePath]]) as string;
  const domain = getLockfileCoordinationDomain(
    fs,
    accessKey,
    hasSharedCoordinationKey,
    managerDomain,
  );
  if (!fs.realPath) {
    if (!hasSharedCoordinationKey) {
      return { coordinationDomain: domain, stateKeys: [logicalStateKey] };
    }
    const unresolvedRecord = getUnresolvedCoordinationRecord(
      domain,
      projectDir,
      lockfilePath,
      logicalStateKey,
    );
    return {
      coordinationDomain: domain,
      stateKeys: [logicalStateKey],
      unresolvedRecord,
    };
  }

  const recordKey = logicalStateKey;
  const canonicalLockfilePath = await resolveCanonicalLockfilePath(
    fs,
    projectDir,
    LOCKFILE_CANONICALIZATION_TIMEOUT_MS,
    canonicalizationState,
  );
  if (canonicalLockfilePath === undefined) {
    const unresolvedRecord = getUnresolvedCoordinationRecord(
      domain,
      projectDir,
      lockfilePath,
      logicalStateKey,
    );
    return {
      coordinationDomain: domain,
      stateKeys: [logicalStateKey],
      unresolvedRecord,
    };
  }
  // Historical aliases are reconciled incrementally. A stale or deleted
  // project remains retryable but cannot fail an unrelated healthy project or
  // monopolize the shared backing-store queue.
  const reconciledUnresolvedRecords = await reconcileHistoricalCoordinationRecords(
    fs,
    domain,
    recordKey,
    accessKey,
  );

  return {
    coordinationDomain: domain,
    resolvedRecordKey: recordKey,
    reconciledUnresolvedRecords,
    stateKeys: [
      logicalStateKey,
      apply(jsonStringify, NativeJSON, [[accessKey, canonicalLockfilePath]]) as string,
    ],
  };
}

function compareLockfileImportKeys(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function serializeLockfileAccess<T>(
  accessKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const predecessor = getMapValue(lockfileAccessTails, accessKey) ?? resolveVoidPromise();
  const result = chainPromise(predecessor, operation);
  const tail = thenPromise(
    result,
    () => undefined,
    () => undefined,
  );
  setMapValue(lockfileAccessTails, accessKey, tail);

  const release = () => {
    if (getMapValue(lockfileAccessTails, accessKey) === tail) {
      deleteMapValue(lockfileAccessTails, accessKey);
    }
  };
  return thenPromise(
    result,
    (value) => {
      release();
      return value;
    },
    (error) => {
      release();
      throw error;
    },
  );
}

function createPlatformFSAdapter(): FSAdapter {
  const fs = createFileSystem();
  const renameFile = fs.rename;

  return {
    coordinationKey: PLATFORM_FS_COORDINATION_KEY,
    readFile(path: string): Promise<string> {
      return fs.readTextFile(path);
    },
    writeFile(path: string, content: string): Promise<void> {
      return fs.writeTextFile(path, content);
    },
    ...(renameFile === undefined ? {} : {
      rename(from: string, to: string): Promise<void> {
        return apply(renameFile, fs, [from, to]) as Promise<void>;
      },
    }),
    exists(path: string): Promise<boolean> {
      return fs.exists(path);
    },
    remove(path: string): Promise<void> {
      return fs.remove(path);
    },
    realPath(path: string): Promise<string> {
      return resolvePlatformRealPath(path);
    },
  };
}

/** Create lockfile manager. */
export function createLockfileManager(projectDir: string, fsAdapter?: FSAdapter): LockfileManager {
  const fs = fsAdapter ?? createPlatformFSAdapter();
  const normalizedProjectDir = normalize(projectDir);
  const lockfilePath = normalize(`${normalizedProjectDir}/${LOCKFILE_NAME}`);
  const adapterIdentity = getAdapterInstanceIdentity(fs);
  const coordinationKey = fs.coordinationKey;
  const hasSharedCoordinationKey = coordinationKey !== undefined;
  const accessKey = hasSharedCoordinationKey
    ? apply(jsonStringify, NativeJSON, [[`shared:${coordinationKey}`]]) as string
    : apply(jsonStringify, NativeJSON, [[adapterIdentity]]) as string;
  const logicalQueueKey = hasSharedCoordinationKey
    ? apply(jsonStringify, NativeJSON, [[accessKey, lockfilePath]]) as string
    : accessKey;
  let cache: LockfileData | null = null;
  let cacheRevision = -1n;
  let managerOperationTail: Promise<void> = resolveVoidPromise();
  let managerCoordinationDomain: LockfileCoordinationDomain | undefined;
  let managerUnresolvedRecord: LockfileCoordinationRecord | undefined;
  let managerSharedState: LockfileSharedState | undefined;
  const canonicalizationState = objectCreate(null) as LockfileCanonicalizationState;
  const pendingEntries = new NativeMap<string, PendingLockfileEntry>();

  function serializeManagerOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = chainPromise(managerOperationTail, operation);
    managerOperationTail = thenPromise(
      result,
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function resolveStateUnderAccess(): Promise<{
    state: LockfileSharedState;
    accessQueueKey: string;
    unresolved: boolean;
  }> {
    // Retry canonicalization for every serialized manager operation. A
    // project path may not exist on the first access, and a later successful
    // resolution must bridge the earlier logical state to canonical aliases.
    const {
      coordinationDomain,
      stateKeys,
      unresolvedRecord,
      resolvedRecordKey,
      reconciledUnresolvedRecords,
    } = await resolveLockfileCoordinationIdentity(
      fs,
      normalizedProjectDir,
      lockfilePath,
      accessKey,
      hasSharedCoordinationKey,
      canonicalizationState,
      managerCoordinationDomain,
    );
    managerCoordinationDomain = coordinationDomain;
    // A coordinationKey declares a shared backing store. Canonicalize the
    // per-lockfile cache state independently so aliases invalidate each other
    // without coupling separate projects.
    managerSharedState = getLockfileSharedState(stateKeys);
    if (resolvedRecordKey !== undefined) {
      deleteMapValue(coordinationDomain.records, resolvedRecordKey);
    }
    managerUnresolvedRecord = unresolvedRecord;
    if (unresolvedRecord) {
      // A live warmed reader must be discoverable by a healthy alias so a
      // later clear can invalidate its cache. Keep only the state weakly: dead
      // readers and their adapters remain collectible.
      unresolvedRecord.state = new NativeWeakRef(managerSharedState);
      setMapValue(coordinationDomain.records, unresolvedRecord.recordKey, unresolvedRecord);
    }
    const state = resolveLockfileSharedState(managerSharedState);
    return {
      state,
      // Queue by the reconciled state root rather than the manager's current
      // spelling of the path. A shared adapter with realPath can bridge an
      // alias owned by an adapter without realPath; both must then serialize
      // through the same queue to protect the read-merge-write window.
      accessQueueKey: getLockfileSharedStateAccessKey(state),
      unresolved: unresolvedRecord !== undefined || reconciledUnresolvedRecords === true,
    };
  }

  function retainUnresolvedMutation(
    state: LockfileSharedState,
    durable: boolean,
  ): void {
    if (!managerCoordinationDomain || !managerUnresolvedRecord) return;
    managerUnresolvedRecord.state = new NativeWeakRef(state);
    if (durable) managerUnresolvedRecord.retainedState = state;
    setMapValue(
      managerCoordinationDomain.records,
      managerUnresolvedRecord.recordKey,
      managerUnresolvedRecord,
    );
  }

  function withLockfileAccess<T>(
    operation: (state: LockfileSharedState) => Promise<T>,
  ): Promise<T> {
    return serializeLockfileAccess(
      logicalQueueKey,
      () =>
        chainPromise(
          resolveStateUnderAccess(),
          ({ state, accessQueueKey, unresolved }) => {
            const resolvedAccessQueueKey = hasSharedCoordinationKey && unresolved
              ? accessKey
              : accessQueueKey;
            return resolvedAccessQueueKey === logicalQueueKey
              ? operation(state)
              : serializeLockfileAccess(resolvedAccessQueueKey, () => operation(state));
          },
        ),
    );
  }

  async function lockfileExists(): Promise<boolean> {
    try {
      return await fs.exists(lockfilePath);
    } catch (cause) {
      throw lockfileReadError(lockfilePath, "access-failed", cause);
    }
  }

  async function readFromDisk(): Promise<LockfileData | null> {
    if (!(await lockfileExists())) return null;

    let content: string;
    try {
      content = await fs.readFile(lockfilePath);
    } catch (cause) {
      throw lockfileReadError(lockfilePath, "access-failed", cause);
    }

    return parseLockfile(content, lockfilePath);
  }

  async function readCurrentUnderAccess(
    state: LockfileSharedState,
  ): Promise<LockfileData | null> {
    forEachMapEntry(pendingEntries, (url, pending) => {
      if (pending.sequence < state.lastClearSequence) deleteMapValue(pendingEntries, url);
    });
    if (cacheRevision === state.revision) return cache;

    const data = await readFromDisk();
    if (getMapSize(pendingEntries) === 0) {
      cache = data;
    } else {
      const resolvedCache = data ?? createInternalLockfile();
      cache = resolvedCache;
      forEachMapEntry(pendingEntries, (url, pending) => {
        defineImportEntry(resolvedCache.imports, url, cloneLockfileEntry(pending.entry));
      });
    }
    cacheRevision = state.revision;
    return cache;
  }

  function readCurrent(): Promise<LockfileData | null> {
    // Cold and invalidated reads share the same access turn as write/remove
    // operations, so peer managers cannot observe a partially replaced file.
    return withLockfileAccess((state) => readCurrentUnderAccess(state));
  }

  function read(): Promise<LockfileData | null> {
    return serializeManagerOperation(async () => {
      const data = await readCurrent();
      return data === null ? null : cloneLockfileData(data, "public");
    });
  }

  async function replaceLockfileAtomically(
    rename: (from: string, to: string) => Promise<void>,
    serialized: string,
  ): Promise<void> {
    // Stage the new content next to the lockfile and rename it into place, so
    // readers observe either the previous or the new complete file and a
    // crash mid-write can never leave a truncated lockfile behind.
    const tempPath = `${lockfilePath}.${generateUuid()}.tmp`;
    try {
      await fs.writeFile(tempPath, serialized);
      await rename(tempPath, lockfilePath);
    } catch (error) {
      if (fs.remove) {
        try {
          await fs.remove(tempPath);
        } catch {
          // Best-effort cleanup only; the original write/rename failure wins.
        }
      }
      throw error;
    }
  }

  async function writeToDisk(data: LockfileData): Promise<void> {
    const sourceEntries = objectEntries(data.imports);
    apply(arraySort, sourceEntries, [
      (left: [string, LockfileEntry], right: [string, LockfileEntry]) =>
        compareLockfileImportKeys(left[0], right[0]),
    ]);
    const sortedEntries: Array<[string, LockfileEntry]> = [];
    sortedEntries.length = sourceEntries.length;
    for (let index = 0; index < sourceEntries.length; index++) {
      const sourceEntry = sourceEntries[index]!;
      sortedEntries[index] = [sourceEntry[0], cloneLockfileEntry(sourceEntry[1])];
    }
    const sorted: LockfileData = {
      version: LOCKFILE_VERSION,
      imports: createImportDictionary(sortedEntries),
    };
    const serialized = `${apply(jsonStringify, NativeJSON, [sorted, null, 2]) as string}\n`;

    const renameFile = fs.rename;
    if (renameFile) {
      await replaceLockfileAtomically(
        (from, to) => apply(renameFile, fs, [from, to]) as Promise<void>,
        serialized,
      );
    } else {
      // Adapters without rename cannot replace the file atomically; fall back
      // to an in-place write and accept the torn-write risk for them.
      await fs.writeFile(lockfilePath, serialized);
    }
    logger.debug(`Written ${objectKeys(data.imports).length} entries`);
  }

  function write(data: LockfileData): Promise<void> {
    return serializeManagerOperation(() => {
      const snapshot = sanitizeLockfileData(
        data,
        lockfilePath,
        () => lockfileInputError("invalid-structure"),
      );
      return withLockfileAccess(async (state) => {
        // Revalidate the existing file before replacing it. Unsupported,
        // unreadable, and malformed files are always preserved.
        await readFromDisk();
        await writeToDisk(snapshot);
        cache = snapshot;
        clearMap(pendingEntries);
        cacheRevision = ++state.revision;
        retainUnresolvedMutation(state, true);
      });
    });
  }

  function get(url: string): Promise<LockfileEntry | null> {
    return serializeManagerOperation(async () => {
      const entry = (await readCurrent())?.imports[url];
      return entry === undefined ? null : cloneLockfileEntry(entry);
    });
  }

  function set(url: string, entry: LockfileEntry): Promise<void> {
    let snapshot: LockfileEntry;
    try {
      snapshot = cloneLockfileEntry(entry);
    } catch (error) {
      return rejectPromise(error);
    }
    return serializeManagerOperation(() =>
      withLockfileAccess(async (state) => {
        const data = (await readCurrentUnderAccess(state)) ?? createInternalLockfile();
        defineImportEntry(data.imports, url, snapshot);
        cache = data;
        setMapValue(pendingEntries, url, {
          entry: snapshot,
          sequence: nextLockfileMutationSequence++,
        });
        retainUnresolvedMutation(state, false);
      })
    );
  }

  function has(url: string): Promise<boolean> {
    return serializeManagerOperation(async () => {
      const data = await readCurrent();
      return data !== null && objectHasOwn(data.imports, url);
    });
  }

  function clear(): Promise<void> {
    return serializeManagerOperation(() =>
      withLockfileAccess(async (state) => {
        // Clear is an explicit destructive recovery path. Check access to the
        // path, but do not parse content that the user has chosen to discard.
        const existing = await lockfileExists();
        let cleared: LockfileData | null = null;
        if (existing) {
          if (fs.remove) await fs.remove(lockfilePath);
          else {
            cleared = createInternalLockfile();
            await writeToDisk(cleared);
          }
        }

        // State changes only after the access check and any requested deletion
        // or fallback write have succeeded, so a failed clear leaves memory and
        // disk untouched.
        cache = cleared;
        clearMap(pendingEntries);
        state.lastClearSequence = nextLockfileMutationSequence++;
        cacheRevision = ++state.revision;
        retainUnresolvedMutation(state, true);
      })
    );
  }

  function flush(): Promise<void> {
    return serializeManagerOperation(async () => {
      if (getMapSize(pendingEntries) === 0) return;

      await withLockfileAccess(async (state) => {
        forEachMapEntry(pendingEntries, (url, pending) => {
          if (pending.sequence < state.lastClearSequence) {
            deleteMapValue(pendingEntries, url);
          }
        });
        if (getMapSize(pendingEntries) === 0) {
          cache = await readFromDisk();
          cacheRevision = state.revision;
          return;
        }

        // Merge only this manager's pending entries onto the latest on-disk
        // state while holding the canonical backing-store access turn. This
        // makes the whole read-merge-write sequence atomic relative to other
        // in-process managers, including managers using path aliases.
        const snapshot = new NativeMap<string, PendingLockfileEntry>();
        forEachMapEntry(pendingEntries, (url, pending) => {
          setMapValue(snapshot, url, pending);
        });
        const merged = (await readFromDisk()) ?? createInternalLockfile();
        forEachMapEntry(snapshot, (url, pending) => {
          defineImportEntry(merged.imports, url, cloneLockfileEntry(pending.entry));
        });

        await writeToDisk(merged);
        forEachMapEntry(snapshot, (url, pending) => {
          if (getMapValue(pendingEntries, url) === pending) {
            deleteMapValue(pendingEntries, url);
          }
        });
        forEachMapEntry(pendingEntries, (url, pending) => {
          defineImportEntry(merged.imports, url, cloneLockfileEntry(pending.entry));
        });
        cache = merged;
        cacheRevision = ++state.revision;
        retainUnresolvedMutation(state, true);
      });
    });
  }

  return { read, write, get, set, has, clear, flush };
}

const lockfileReadWarningIssued = new NativeWeakMap<LockfileManager, true>();

/**
 * Degrade an unreadable-lockfile failure (`lockfile-read-error`) on a build
 * hot path: warn once per manager, naming the file and the
 * `veryfront lock --clear` remedy, and report the error as absorbed. Every
 * other failure — most importantly `lockfile-format-mismatch`, a valid
 * lockfile written by a newer Veryfront build — is reported as not absorbed
 * so it keeps failing loudly.
 */
function absorbUnreadableLockfileError(
  lockfile: LockfileManager,
  error: unknown,
): boolean {
  const snapshot = snapshotVeryfrontError(error);
  if (snapshot?.slug !== LOCKFILE_READ_ERROR.slug) return false;

  if (getWeakMapValue(lockfileReadWarningIssued, lockfile) !== true) {
    setWeakMapValue(lockfileReadWarningIssued, lockfile, true);
    logger.warn(
      `Lockfile ${LOCKFILE_NAME} could not be read (${snapshot.message}); ` +
        "continuing this build without lockfile entries. " +
        "Run `veryfront lock --clear` to reset the unreadable or invalid lockfile.",
    );
  }
  return true;
}

/**
 * Read a lockfile entry on a build or dev-server hot path.
 *
 * A lockfile written by a newer Veryfront build (`lockfile-format-mismatch`)
 * keeps failing loudly: proceeding around data the running build cannot
 * understand is exactly the overwrite hazard this module guards against. An
 * unreadable or malformed lockfile (`lockfile-read-error`) instead degrades to
 * a cache miss so builds keep working from fresh fetches; a warning naming
 * the lockfile and the `veryfront lock --clear` remedy is logged once per
 * manager instead of once per import.
 */
export async function getLockfileEntryForBuild(
  lockfile: LockfileManager,
  url: string,
): Promise<LockfileEntry | null> {
  try {
    return await lockfile.get(url);
  } catch (error) {
    if (!absorbUnreadableLockfileError(lockfile, error)) throw error;
    return null;
  }
}

/**
 * Persist a lockfile entry from a build or dev-server hot path.
 *
 * Mirrors {@link getLockfileEntryForBuild}: when the on-disk lockfile is
 * unreadable or malformed (`lockfile-read-error`), the file is left untouched
 * for `veryfront lock --clear` and the entry is simply not recorded, so a
 * successful refetch still serves the build. Returns whether the entry was
 * staged; callers should only `flush()` after a `true` result. A newer-format
 * lockfile (`lockfile-format-mismatch`) keeps failing loudly.
 */
export async function setLockfileEntryForBuild(
  lockfile: LockfileManager,
  url: string,
  entry: LockfileEntry,
): Promise<boolean> {
  try {
    await lockfile.set(url, entry);
    return true;
  } catch (error) {
    if (!absorbUnreadableLockfileError(lockfile, error)) throw error;
    return false;
  }
}

export interface FetchWithLockOptions {
  lockfile: LockfileManager;
  url: string;
  fetchFn?: typeof fetch;
  strict?: boolean;
}

export interface FetchWithLockResult {
  content: string;
  resolvedUrl: string;
  fromCache: boolean;
  integrity: string;
}

const USER_AGENT_HEADERS = { "user-agent": "Mozilla/5.0 Veryfront/1.0" };

export async function fetchWithLock(options: FetchWithLockOptions): Promise<FetchWithLockResult> {
  const { lockfile, url, fetchFn = fetch, strict = false } = options;

  const entry = await lockfile.get(url);

  if (entry) {
    logger.debug(`Cache hit for ${url}`);

    const res = await fetchFn(entry.resolved, { headers: USER_AGENT_HEADERS });

    if (!res.ok) {
      if (strict) {
        throw CACHE_ERROR.create({
          detail:
            `Lockfile entry stale: ${url} resolved to ${entry.resolved} returned ${res.status}`,
        });
      }
      logger.warn(`Cached URL ${entry.resolved} returned ${res.status}, refetching`);
    } else {
      const content = await res.text();
      const currentIntegrity = await computeIntegrity(content);

      if (currentIntegrity === entry.integrity) {
        return {
          content,
          resolvedUrl: entry.resolved,
          fromCache: true,
          integrity: entry.integrity,
        };
      }

      if (strict) {
        throw CACHE_ERROR.create({
          detail:
            `Integrity mismatch for ${url}: expected ${entry.integrity}, got ${currentIntegrity}`,
        });
      }
      logger.warn(`Integrity mismatch for ${url}, updating lockfile`);
    }
  }

  logger.debug(`Fetching fresh: ${url}`);
  const res = await fetchFn(url, { headers: USER_AGENT_HEADERS, redirect: "follow" });

  if (!res.ok) throw NETWORK_ERROR.create({ detail: `Failed to fetch ${url}: ${res.status}` });

  const content = await res.text();
  const resolvedUrl = res.url || url;
  const integrity = await computeIntegrity(content);

  await lockfile.set(url, {
    resolved: resolvedUrl,
    integrity,
    fetchedAt: new Date().toISOString(),
  });

  await lockfile.flush();

  return { content, resolvedUrl, fromCache: false, integrity };
}

export interface ParsedImport {
  specifier: string;
  type: "static" | "dynamic";
}

const IMPORT_REGEX = /import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_REGEX = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const EXPORT_FROM_REGEX = /export\s+(?:[\w*\s{},]*)\s+from\s+['"]([^'"]+)['"]/g;

export function extractImports(content: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const seen = new Set<string>();

  function addMatches(regex: RegExp, type: ParsedImport["type"]): void {
    for (const match of content.matchAll(regex)) {
      const specifier = match[1];
      if (!specifier || seen.has(specifier)) continue;

      seen.add(specifier);
      imports.push({ specifier, type });
    }
  }

  addMatches(IMPORT_REGEX, "static");
  addMatches(EXPORT_FROM_REGEX, "static");
  addMatches(DYNAMIC_IMPORT_REGEX, "dynamic");

  return imports;
}

export function resolveImportUrl(specifier: string, baseUrl: string): string | null {
  if (specifier.startsWith("http://") || specifier.startsWith("https://")) return specifier;
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;

  try {
    const resolved = new NativeURL(specifier, baseUrl);
    return apply(urlToString, resolved, []) as string;
  } catch (_) {
    /* expected: specifier may not be a valid relative URL */
    return null;
  }
}
