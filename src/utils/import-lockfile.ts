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
  Object.defineProperty(imports, url, {
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
    ? Object.create(null) as Record<string, LockfileEntry>
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
      Object.entries(data.imports).map(([url, entry]) => [url, cloneLockfileEntry(entry)]),
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

function parseLockfile(content: string, lockfilePath: string): LockfileData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (cause) {
    throw lockfileReadError(lockfilePath, "invalid-json", cause);
  }

  if (!isRecord(parsed)) {
    throw lockfileReadError(lockfilePath, "invalid-structure");
  }
  const version = getOwnDataProperty(parsed, "version")?.value;
  if (typeof version !== "number" || !Number.isSafeInteger(version)) {
    throw lockfileReadError(lockfilePath, "invalid-structure");
  }
  if (version !== LOCKFILE_VERSION) {
    throw LOCKFILE_FORMAT_MISMATCH.create({
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
  const parsedImports = getOwnDataProperty(parsed, "imports")?.value;
  if (!isRecord(parsedImports)) {
    throw lockfileReadError(lockfilePath, "invalid-structure");
  }

  const imports: Array<[string, LockfileEntry]> = [];
  for (const [url, entry] of Object.entries(parsedImports)) {
    const sanitizedEntry = sanitizeLockfileEntry(entry);
    if (sanitizedEntry === null) {
      throw lockfileReadError(lockfilePath, "invalid-structure");
    }
    imports.push([url, sanitizedEntry]);
  }
  return { version: LOCKFILE_VERSION, imports: createImportDictionary(imports) };
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
  /** Resolve an existing path when no shared coordinationKey is available. */
  realPath?(path: string): Promise<string>;
};

const PLATFORM_FS_COORDINATION_KEY = "veryfront-platform-filesystem";
const adapterIdentityByInstance = new WeakMap<FSAdapter, number>();
const lockfileAccessTails = new Map<string, Promise<void>>();
let nextAdapterIdentity = 1;

function getAdapterInstanceIdentity(fs: FSAdapter): string {
  let identity = adapterIdentityByInstance.get(fs);
  if (identity === undefined) {
    identity = nextAdapterIdentity++;
    adapterIdentityByInstance.set(fs, identity);
  }
  return `instance:${identity}`;
}

async function resolveLockfileAccessKey(
  fs: FSAdapter,
  projectDir: string,
): Promise<string> {
  // A declared coordination key is the complete shared lock domain. Including
  // a canonical path here would split adapters that share a backing store when
  // only some of them implement realPath, recreating a read-merge-write race.
  if (fs.coordinationKey !== undefined) {
    return JSON.stringify([`shared:${fs.coordinationKey}`]);
  }

  const adapterIdentity = getAdapterInstanceIdentity(fs);
  if (!fs.realPath) return JSON.stringify([adapterIdentity]);

  try {
    const canonicalProjectDir = normalize(await fs.realPath(projectDir));
    return JSON.stringify([
      adapterIdentity,
      normalize(`${canonicalProjectDir}/${LOCKFILE_NAME}`),
    ]);
  } catch {
    // Without a trustworthy canonical project path, serialize conservatively
    // across the whole backing adapter so symlink and case aliases cannot race.
    return JSON.stringify([adapterIdentity]);
  }
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
  let cache: LockfileData | null = null;
  let managerOperationTail: Promise<void> = Promise.resolve();
  let accessKeyPromise: Promise<string> | undefined;
  const pendingEntries = new Map<string, LockfileEntry>();

  function serializeManagerOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = managerOperationTail.then(operation);
    managerOperationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function withLockfileAccess<T>(operation: () => Promise<T>): Promise<T> {
    accessKeyPromise ??= resolveLockfileAccessKey(fs, normalizedProjectDir);
    return accessKeyPromise.then((accessKey) => serializeLockfileAccess(accessKey, operation));
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

  async function readCurrent(): Promise<LockfileData | null> {
    if (cache) return cache;

    // Cold reads share the same access turn as write/remove operations. This
    // prevents a second manager from parsing a partially replaced lockfile.
    const data = await withLockfileAccess(readFromDisk);
    if (data) cache = data;
    return data;
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
        Object.entries(data.imports)
          .sort(([a], [b]) => compareLockfileImportKeys(a, b))
          .map(([url, entry]) => [url, cloneLockfileEntry(entry)]),
      ),
    };

    await fs.writeFile(lockfilePath, `${JSON.stringify(sorted, null, 2)}\n`);
    logger.debug(`Written ${Object.keys(data.imports).length} entries`);
  }

  function write(data: LockfileData): Promise<void> {
    const snapshot = cloneLockfileData(data);
    return serializeManagerOperation(() =>
      withLockfileAccess(async () => {
        // Revalidate the existing file before replacing it. Unsupported,
        // unreadable, and malformed files are always preserved.
        await readFromDisk();
        await writeToDisk(snapshot);
        cache = snapshot;
        pendingEntries.clear();
      })
    );
  }

  function get(url: string): Promise<LockfileEntry | null> {
    return serializeManagerOperation(async () => {
      const entry = (await readCurrent())?.imports[url];
      return entry === undefined ? null : cloneLockfileEntry(entry);
    });
  }

  function set(url: string, entry: LockfileEntry): Promise<void> {
    const snapshot = cloneLockfileEntry(entry);
    return serializeManagerOperation(async () => {
      const data = (await readCurrent()) ?? createInternalLockfile();
      defineImportEntry(data.imports, url, snapshot);
      cache = data;
      pendingEntries.set(url, snapshot);
    });
  }

  function has(url: string): Promise<boolean> {
    return serializeManagerOperation(async () => {
      const data = await readCurrent();
      return data !== null && objectHasOwn(data.imports, url);
    });
  }

  function clear(): Promise<void> {
    return serializeManagerOperation(() =>
      withLockfileAccess(async () => {
        // Clear is an explicit destructive recovery path. Check access to the
        // path, but do not parse content that the user has chosen to discard.
        const existing = await lockfileExists();
        const cleared = createInternalLockfile();
        if (existing) {
          if (fs.remove) await fs.remove(lockfilePath);
          else await writeToDisk(cleared);
        }

        // State changes only after validation and any requested deletion have
        // succeeded, so a failed clear leaves both memory and disk untouched.
        cache = cleared;
        pendingEntries.clear();
      })
    );
  }

  function flush(): Promise<void> {
    return serializeManagerOperation(async () => {
      if (pendingEntries.size === 0) return;

      await withLockfileAccess(async () => {
        // Merge only this manager's pending entries onto the latest on-disk
        // state while holding the canonical backing-store access turn. This
        // makes the whole read-merge-write sequence atomic relative to other
        // in-process managers, including managers using path aliases.
        const snapshot = new Map(pendingEntries);
        const merged = (await readFromDisk()) ?? createInternalLockfile();
        for (const [url, entry] of snapshot) {
          defineImportEntry(merged.imports, url, cloneLockfileEntry(entry));
        }

        await writeToDisk(merged);
        for (const [url, entry] of snapshot) {
          if (pendingEntries.get(url) === entry) pendingEntries.delete(url);
        }
        for (const [url, entry] of pendingEntries) {
          defineImportEntry(merged.imports, url, cloneLockfileEntry(entry));
        }
        cache = merged;
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
