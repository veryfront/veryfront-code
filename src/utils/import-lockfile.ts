import { computeHash } from "./hash-utils.ts";
import { serverLogger } from "./logger/index.ts";
import {
  createFileSystem,
  realPath as resolvePlatformRealPath,
} from "#veryfront/platform/compat/fs.ts";
import { normalize } from "#veryfront/compat/path/resolution.ts";
import {
  CACHE_ERROR,
  LOCKFILE_FORMAT_MISMATCH,
  LOCKFILE_READ_ERROR,
  NETWORK_ERROR,
} from "#veryfront/errors/error-registry.ts";

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
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectEntries = Object.entries;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;

function cloneLockfileEntry(entry: LockfileEntry): LockfileEntry {
  const dependencies = getOwnDataProperty(entry, "dependencies")?.value as
    | string[]
    | undefined;
  const fetchedAt = getOwnDataProperty(entry, "fetchedAt")?.value as string | undefined;
  return {
    resolved: entry.resolved,
    integrity: entry.integrity,
    ...(dependencies === undefined ? {} : { dependencies: [...dependencies] }),
    ...(fetchedAt === undefined ? {} : { fetchedAt }),
  };
}

function defineImportEntry(
  imports: Record<string, LockfileEntry>,
  url: string,
  entry: LockfileEntry,
): void {
  objectDefineProperty(imports, url, {
    value: entry,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function createImportDictionary(
  entries: Iterable<readonly [string, LockfileEntry]> = [],
  prototype: "internal" | "public" = "internal",
): Record<string, LockfileEntry> {
  const imports = prototype === "internal"
    ? objectCreate(null) as Record<string, LockfileEntry>
    : {};
  for (const [url, entry] of entries) defineImportEntry(imports, url, entry);
  return imports;
}

function cloneLockfileData(
  data: LockfileData,
  prototype: "internal" | "public" = "internal",
): LockfileData {
  return {
    version: LOCKFILE_VERSION,
    imports: createImportDictionary(
      objectEntries(data.imports).map(([url, entry]) => [url, cloneLockfileEntry(entry)]),
      prototype,
    ),
  };
}

function createInternalLockfile(): LockfileData {
  return { version: LOCKFILE_VERSION, imports: createImportDictionary() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getOwnDataProperty(
  value: object,
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
  if (
    dependencies !== undefined &&
    (!Array.isArray(dependencies) ||
      dependencies.some((dependency) => typeof dependency !== "string"))
  ) {
    return null;
  }

  const fetchedAt = getOwnDataProperty(value, "fetchedAt")?.value;
  if (fetchedAt !== undefined && typeof fetchedAt !== "string") return null;

  return {
    resolved,
    integrity,
    ...(dependencies === undefined ? {} : { dependencies: [...dependencies] }),
    ...(fetchedAt === undefined ? {} : { fetchedAt }),
  };
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

function sanitizeLockfileData(value: unknown, lockfilePath: string): LockfileData {
  if (!isRecord(value)) throw lockfileReadError(lockfilePath, "invalid-structure");

  const version = getOwnDataProperty(value, "version")?.value;
  if (typeof version !== "number" || !Number.isSafeInteger(version)) {
    throw lockfileReadError(lockfilePath, "invalid-structure");
  }
  if (version !== LOCKFILE_VERSION) {
    throw lockfileFormatMismatch(lockfilePath, version);
  }
  const parsedImports = getOwnDataProperty(value, "imports")?.value;
  if (!isRecord(parsedImports)) {
    throw lockfileReadError(lockfilePath, "invalid-structure");
  }

  const imports: Array<[string, LockfileEntry]> = [];
  for (const [url, entry] of objectEntries(parsedImports)) {
    const sanitizedEntry = sanitizeLockfileEntry(entry);
    if (sanitizedEntry === null) {
      throw lockfileReadError(lockfilePath, "invalid-structure");
    }
    imports.push([url, sanitizedEntry]);
  }
  return { version: LOCKFILE_VERSION, imports: createImportDictionary(imports) };
}

function parseLockfile(content: string, lockfilePath: string): LockfileData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
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
  exists(path: string): Promise<boolean>;
  remove?(path: string): Promise<void>;
  /** Resolve an existing project path to its stable backing identity. */
  realPath?(path: string): Promise<string>;
};

const PLATFORM_FS_COORDINATION_KEY = "veryfront-platform-filesystem";
const adapterIdentityByInstance = new WeakMap<FSAdapter, number>();
const lockfileAccessTails = new Map<string, Promise<void>>();
interface LockfileSharedState {
  parent?: LockfileSharedState;
  revision: number;
  lastClearSequence: number;
}

interface PendingLockfileEntry {
  entry: LockfileEntry;
  sequence: number;
}

interface LockfileCoordinationRecord {
  recordKey: string;
  projectDir: string;
  logicalStateKey: string;
  state?: WeakRef<LockfileSharedState>;
  retainedState?: LockfileSharedState;
}

interface LockfileCoordinationDomain {
  records: Map<string, LockfileCoordinationRecord>;
}

interface LockfileCoordinationDomainReference {
  generation: number;
  reference: WeakRef<LockfileCoordinationDomain>;
}

interface LockfileSharedStateReference {
  generation: number;
  reference: WeakRef<LockfileSharedState>;
}

const lockfileSharedStateReferences = new Map<string, LockfileSharedStateReference>();
const lockfileCoordinationDomainByAdapter = new WeakMap<FSAdapter, LockfileCoordinationDomain>();
const sharedLockfileCoordinationDomains = new Map<
  string,
  LockfileCoordinationDomainReference
>();
let nextLockfileCoordinationDomainGeneration = 1;
const sharedLockfileCoordinationRegistry = new FinalizationRegistry<{
  accessKey: string;
  generation: number;
}>(({ accessKey, generation }) => {
  const current = sharedLockfileCoordinationDomains.get(accessKey);
  if (current?.generation === generation && current.reference.deref() === undefined) {
    sharedLockfileCoordinationDomains.delete(accessKey);
  }
});
let nextLockfileSharedStateGeneration = 1;
let nextLockfileMutationSequence = 1;
const lockfileSharedStateRegistry = new FinalizationRegistry<{
  stateKey: string;
  generation: number;
}>(({ stateKey, generation }) => {
  const current = lockfileSharedStateReferences.get(stateKey);
  if (current?.generation === generation && current.reference.deref() === undefined) {
    lockfileSharedStateReferences.delete(stateKey);
  }
});
let nextAdapterIdentity = 1;

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

function registerLockfileSharedState(
  stateKey: string,
  state: LockfileSharedState,
): void {
  const generation = nextLockfileSharedStateGeneration++;
  lockfileSharedStateReferences.set(stateKey, {
    generation,
    reference: new WeakRef(state),
  });
  lockfileSharedStateRegistry.register(state, { stateKey, generation });
}

function getLockfileSharedState(stateKeys: readonly string[]): LockfileSharedState {
  const roots: LockfileSharedState[] = [];
  for (const stateKey of stateKeys) {
    const referenced = lockfileSharedStateReferences.get(stateKey)?.reference.deref();
    if (!referenced) continue;
    const root = resolveLockfileSharedState(referenced);
    if (!roots.includes(root)) roots.push(root);
  }

  const state = roots.shift() ?? { revision: 0, lastClearSequence: 0 };
  for (const other of roots) {
    other.parent = state;
    state.revision = Math.max(state.revision, other.revision) + 1;
    state.lastClearSequence = Math.max(
      state.lastClearSequence,
      other.lastClearSequence,
    );
  }
  for (const stateKey of stateKeys) registerLockfileSharedState(stateKey, state);
  return state;
}

function getAdapterInstanceIdentity(fs: FSAdapter): string {
  let identity = adapterIdentityByInstance.get(fs);
  if (identity === undefined) {
    identity = nextAdapterIdentity++;
    adapterIdentityByInstance.set(fs, identity);
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
    let domain = sharedLockfileCoordinationDomains.get(accessKey)?.reference.deref();
    if (!domain) {
      domain = { records: new Map() };
      const generation = nextLockfileCoordinationDomainGeneration++;
      sharedLockfileCoordinationDomains.set(accessKey, {
        generation,
        reference: new WeakRef(domain),
      });
      sharedLockfileCoordinationRegistry.register(domain, {
        accessKey,
        generation,
      });
    }
    return domain;
  }

  let domain = lockfileCoordinationDomainByAdapter.get(fs);
  if (!domain) {
    domain = { records: new Map() };
    lockfileCoordinationDomainByAdapter.set(fs, domain);
  }
  return domain;
}

async function resolveCanonicalLockfilePath(
  fs: FSAdapter,
  projectDir: string,
): Promise<string | undefined> {
  if (!fs.realPath) return undefined;
  const timedOut = Symbol("lockfile canonicalization timed out");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const canonicalProjectDirResult = await Promise.race([
      Promise.resolve().then(() => fs.realPath!(projectDir)),
      new Promise<typeof timedOut>((resolve) => {
        timeoutId = setTimeout(
          () => resolve(timedOut),
          LOCKFILE_CANONICALIZATION_TIMEOUT_MS,
        );
      }),
    ]);
    if (canonicalProjectDirResult === timedOut) return undefined;
    const canonicalProjectDir = normalize(canonicalProjectDirResult);
    return normalize(`${canonicalProjectDir}/${LOCKFILE_NAME}`);
  } catch {
    return undefined;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function resolveLockfileCoordinationIdentity(
  fs: FSAdapter,
  projectDir: string,
  lockfilePath: string,
  adapterIdentity: string,
  accessKey: string,
  hasSharedCoordinationKey: boolean,
  managerDomain?: LockfileCoordinationDomain,
): Promise<{
  coordinationDomain: LockfileCoordinationDomain;
  stateKeys: string[];
  unresolvedRecord?: LockfileCoordinationRecord;
  resolvedRecordKey?: string;
}> {
  // A declared coordination key is the complete shared lock domain. Including
  // a canonical path here would split adapters that share a backing store when
  // only some of them implement realPath, recreating a read-merge-write race.
  const logicalStateKey = JSON.stringify([accessKey, lockfilePath]);
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
    const recordKey = JSON.stringify([adapterIdentity, lockfilePath]);
    const unresolvedRecord = domain.records.get(recordKey) ?? {
      recordKey,
      projectDir,
      logicalStateKey,
    };
    return {
      coordinationDomain: domain,
      stateKeys: [logicalStateKey],
      unresolvedRecord,
    };
  }

  const recordKey = JSON.stringify([adapterIdentity, lockfilePath]);
  const canonicalLockfilePath = await resolveCanonicalLockfilePath(fs, projectDir);
  if (canonicalLockfilePath === undefined) {
    const unresolvedRecord = domain.records.get(recordKey) ?? {
      recordKey,
      projectDir,
      logicalStateKey,
    };
    return {
      coordinationDomain: domain,
      stateKeys: [logicalStateKey],
      unresolvedRecord,
    };
  }
  // A successful resolution can also attach mutation-bearing logical states
  // whose earlier canonicalization attempts failed. Resolve their paths
  // through the current adapter: a shared coordination key promises one
  // backing filesystem, and retaining or calling a discarded peer adapter
  // would let one failed implementation poison the whole shared queue.
  const resolvedRecords: Array<{
    canonicalPath: string;
    record: LockfileCoordinationRecord;
    recordKey: string;
    state: LockfileSharedState;
  }> = [];
  for (const [knownRecordKey, knownRecord] of domain.records) {
    // Keep the current record, including any strongly retained completed
    // mutation history, until the caller has attached its logical state to the
    // canonical state. A failed historical lookup must leave it retryable.
    if (knownRecordKey === recordKey) continue;
    const knownState = knownRecord.retainedState ?? knownRecord.state?.deref();
    if (!knownState) {
      domain.records.delete(knownRecordKey);
      continue;
    }
    const knownCanonicalPath = await resolveCanonicalLockfilePath(
      fs,
      knownRecord.projectDir,
    );
    if (knownCanonicalPath === undefined) {
      throw lockfileReadError(
        normalize(`${knownRecord.projectDir}/${LOCKFILE_NAME}`),
        "access-failed",
        new Error("Canonical lockfile identity could not be resolved"),
      );
    }
    resolvedRecords.push({
      canonicalPath: knownCanonicalPath,
      record: knownRecord,
      recordKey: knownRecordKey,
      state: knownState,
    });
  }

  // Commit historical reconciliations only after every live record resolves.
  // Retaining the states here prevents completed clear or write history from
  // disappearing between resolution and canonical attachment.
  for (const resolved of resolvedRecords) {
    domain.records.delete(resolved.recordKey);
    getLockfileSharedState([
      resolved.record.logicalStateKey,
      JSON.stringify([accessKey, resolved.canonicalPath]),
    ]);
  }

  return {
    coordinationDomain: domain,
    resolvedRecordKey: recordKey,
    stateKeys: [
      logicalStateKey,
      JSON.stringify([accessKey, canonicalLockfilePath]),
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
  const predecessor = lockfileAccessTails.get(accessKey) ?? Promise.resolve();
  const result = predecessor.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  lockfileAccessTails.set(accessKey, tail);

  return result.finally(() => {
    if (lockfileAccessTails.get(accessKey) === tail) {
      lockfileAccessTails.delete(accessKey);
    }
  });
}

function createPlatformFSAdapter(): FSAdapter {
  const fs = createFileSystem();

  return {
    coordinationKey: PLATFORM_FS_COORDINATION_KEY,
    readFile(path: string): Promise<string> {
      return fs.readTextFile(path);
    },
    writeFile(path: string, content: string): Promise<void> {
      return fs.writeTextFile(path, content);
    },
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
    ? JSON.stringify([`shared:${coordinationKey}`])
    : JSON.stringify([adapterIdentity]);
  let cache: LockfileData | null = null;
  let cacheRevision = -1;
  let managerOperationTail: Promise<void> = Promise.resolve();
  let managerCoordinationDomain: LockfileCoordinationDomain | undefined;
  let managerUnresolvedRecord: LockfileCoordinationRecord | undefined;
  let managerSharedState: LockfileSharedState | undefined;
  const pendingEntries = new Map<string, PendingLockfileEntry>();

  function serializeManagerOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = managerOperationTail.then(operation);
    managerOperationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function resolveStateUnderAccess(): Promise<{
    state: LockfileSharedState;
    accessQueueKey: string;
  }> {
    // Retry canonicalization for every serialized manager operation. A
    // project path may not exist on the first access, and a later successful
    // resolution must bridge the earlier logical state to canonical aliases.
    const { coordinationDomain, stateKeys, unresolvedRecord, resolvedRecordKey } =
      await resolveLockfileCoordinationIdentity(
        fs,
        normalizedProjectDir,
        lockfilePath,
        adapterIdentity,
        accessKey,
        hasSharedCoordinationKey,
        managerCoordinationDomain,
      );
    managerCoordinationDomain = coordinationDomain;
    // A coordinationKey declares a shared backing store. Canonicalize the
    // per-lockfile cache state independently so aliases invalidate each other
    // without coupling separate projects.
    managerSharedState = getLockfileSharedState(stateKeys);
    if (resolvedRecordKey !== undefined) {
      coordinationDomain.records.delete(resolvedRecordKey);
    }
    managerUnresolvedRecord = unresolvedRecord;
    if (unresolvedRecord) {
      // A live warmed reader must be discoverable by a healthy alias so a
      // later clear can invalidate its cache. Keep only the state weakly: dead
      // readers and their adapters remain collectible.
      unresolvedRecord.state = new WeakRef(managerSharedState);
      coordinationDomain.records.set(unresolvedRecord.recordKey, unresolvedRecord);
    }
    return {
      state: resolveLockfileSharedState(managerSharedState),
      accessQueueKey: stateKeys[stateKeys.length - 1] ?? JSON.stringify([accessKey, lockfilePath]),
    };
  }

  function retainUnresolvedMutation(
    state: LockfileSharedState,
    durable: boolean,
  ): void {
    if (!managerCoordinationDomain || !managerUnresolvedRecord) return;
    managerUnresolvedRecord.state = new WeakRef(state);
    if (durable) managerUnresolvedRecord.retainedState = state;
    managerCoordinationDomain.records.set(
      managerUnresolvedRecord.recordKey,
      managerUnresolvedRecord,
    );
  }

  function withLockfileAccess<T>(
    operation: (state: LockfileSharedState) => Promise<T>,
  ): Promise<T> {
    const logicalQueueKey = hasSharedCoordinationKey
      ? JSON.stringify([accessKey, lockfilePath])
      : accessKey;
    return serializeLockfileAccess(logicalQueueKey, async () => {
      const { state, accessQueueKey } = await resolveStateUnderAccess();
      if (accessQueueKey === logicalQueueKey) return await operation(state);
      return await serializeLockfileAccess(accessQueueKey, () => operation(state));
    });
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
    for (const [url, pending] of pendingEntries) {
      if (pending.sequence < state.lastClearSequence) pendingEntries.delete(url);
    }
    if (cacheRevision === state.revision) return cache;

    const data = await readFromDisk();
    if (pendingEntries.size === 0) {
      cache = data;
    } else {
      cache = data ?? createInternalLockfile();
      for (const [url, pending] of pendingEntries) {
        defineImportEntry(cache.imports, url, cloneLockfileEntry(pending.entry));
      }
    }
    cacheRevision = state.revision;
    return cache;
  }

  async function readCurrent(): Promise<LockfileData | null> {
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

  async function writeToDisk(data: LockfileData): Promise<void> {
    const sorted: LockfileData = {
      version: LOCKFILE_VERSION,
      imports: createImportDictionary(
        objectEntries(data.imports)
          .sort(([a], [b]) => compareLockfileImportKeys(a, b))
          .map(([url, entry]) => [url, cloneLockfileEntry(entry)]),
      ),
    };

    await fs.writeFile(lockfilePath, `${JSON.stringify(sorted, null, 2)}\n`);
    logger.debug(`Written ${Object.keys(data.imports).length} entries`);
  }

  function write(data: LockfileData): Promise<void> {
    return serializeManagerOperation(() => {
      const snapshot = sanitizeLockfileData(data, lockfilePath);
      return withLockfileAccess(async (state) => {
        // Revalidate the existing file before replacing it. Unsupported,
        // unreadable, and malformed files are always preserved.
        await readFromDisk();
        await writeToDisk(snapshot);
        cache = snapshot;
        pendingEntries.clear();
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
    const snapshot = cloneLockfileEntry(entry);
    return serializeManagerOperation(() =>
      withLockfileAccess(async (state) => {
        const data = (await readCurrentUnderAccess(state)) ?? createInternalLockfile();
        defineImportEntry(data.imports, url, snapshot);
        cache = data;
        pendingEntries.set(url, {
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

        // State changes only after validation and any requested deletion have
        // succeeded, so a failed clear leaves both memory and disk untouched.
        cache = cleared;
        pendingEntries.clear();
        state.lastClearSequence = nextLockfileMutationSequence++;
        cacheRevision = ++state.revision;
        retainUnresolvedMutation(state, true);
      })
    );
  }

  function flush(): Promise<void> {
    return serializeManagerOperation(async () => {
      if (pendingEntries.size === 0) return;

      await withLockfileAccess(async (state) => {
        for (const [url, pending] of pendingEntries) {
          if (pending.sequence < state.lastClearSequence) pendingEntries.delete(url);
        }
        if (pendingEntries.size === 0) {
          cache = await readFromDisk();
          cacheRevision = state.revision;
          return;
        }

        // Merge only this manager's pending entries onto the latest on-disk
        // state while holding the canonical backing-store access turn. This
        // makes the whole read-merge-write sequence atomic relative to other
        // in-process managers, including managers using path aliases.
        const snapshot = new Map(pendingEntries);
        const merged = (await readFromDisk()) ?? createInternalLockfile();
        for (const [url, pending] of snapshot) {
          defineImportEntry(merged.imports, url, cloneLockfileEntry(pending.entry));
        }

        await writeToDisk(merged);
        for (const [url, pending] of snapshot) {
          if (pendingEntries.get(url) === pending) pendingEntries.delete(url);
        }
        for (const [url, pending] of pendingEntries) {
          defineImportEntry(merged.imports, url, cloneLockfileEntry(pending.entry));
        }
        cache = merged;
        cacheRevision = ++state.revision;
        retainUnresolvedMutation(state, true);
      });
    });
  }

  return { read, write, get, set, has, clear, flush };
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
    return new URL(specifier, baseUrl).toString();
  } catch (_) {
    /* expected: specifier may not be a valid relative URL */
    return null;
  }
}
