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

function cloneLockfileEntry(entry: LockfileEntry): LockfileEntry {
  return {
    resolved: entry.resolved,
    integrity: entry.integrity,
    ...(entry.dependencies === undefined ? {} : { dependencies: [...entry.dependencies] }),
    ...(entry.fetchedAt === undefined ? {} : { fetchedAt: entry.fetchedAt }),
  };
}

function cloneLockfileData(data: LockfileData): LockfileData {
  return {
    version: LOCKFILE_VERSION,
    imports: Object.fromEntries(
      Object.entries(data.imports).map(([url, entry]) => [url, cloneLockfileEntry(entry)]),
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLockfileEntry(value: unknown): value is LockfileEntry {
  if (!isRecord(value)) return false;
  if (typeof value.resolved !== "string" || typeof value.integrity !== "string") return false;
  if (
    value.dependencies !== undefined &&
    (!Array.isArray(value.dependencies) ||
      value.dependencies.some((dependency) => typeof dependency !== "string"))
  ) {
    return false;
  }
  return value.fetchedAt === undefined || typeof value.fetchedAt === "string";
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
    detail: `Lockfile ${lockfilePath} ${description}. The file was left untouched.`,
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

  if (!isRecord(parsed) || !("version" in parsed)) {
    throw lockfileReadError(lockfilePath, "invalid-structure");
  }
  if (parsed.version !== LOCKFILE_VERSION) {
    throw LOCKFILE_FORMAT_MISMATCH.create({
      detail: `Lockfile ${lockfilePath} uses format version ${parsed.version}, but this ` +
        `Veryfront build supports version ${LOCKFILE_VERSION}. The file was left untouched; ` +
        "upgrade Veryfront or migrate the lockfile before reading or modifying it.",
      context: {
        lockfilePath,
        expectedVersion: LOCKFILE_VERSION,
        actualVersion: parsed.version,
      },
    });
  }
  if (!isRecord(parsed.imports)) {
    throw lockfileReadError(lockfilePath, "invalid-structure");
  }

  const imports: Array<[string, LockfileEntry]> = [];
  for (const [url, entry] of Object.entries(parsed.imports)) {
    if (!isLockfileEntry(entry)) {
      throw lockfileReadError(lockfilePath, "invalid-structure");
    }
    imports.push([url, cloneLockfileEntry(entry)]);
  }
  return { version: LOCKFILE_VERSION, imports: Object.fromEntries(imports) };
}

export function createEmptyLockfile(): LockfileData {
  return { version: LOCKFILE_VERSION, imports: {} };
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
 * Reads and mutations fail closed with `lockfile-format-mismatch` for an
 * unsupported format and `lockfile-read-error` for unreadable or malformed
 * data, so an older Veryfront build cannot destroy unrecognized lockfile data.
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
   * Stable identity for adapters that access the same backing filesystem.
   * Separate adapter objects must share this key to coordinate lockfile writes.
   */
  readonly coordinationKey?: string;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove?(path: string): Promise<void>;
  /** Resolve an existing path to its canonical backing path when supported. */
  realPath?(path: string): Promise<string>;
};

const PLATFORM_FS_COORDINATION_KEY = "veryfront-platform-filesystem";
const adapterIdentityByInstance = new WeakMap<FSAdapter, number>();
const lockfileAccessTails = new Map<string, Promise<void>>();
let nextAdapterIdentity = 1;

function getAdapterCoordinationIdentity(fs: FSAdapter): string {
  if (fs.coordinationKey !== undefined) return `shared:${fs.coordinationKey}`;

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
  lockfilePath: string,
): Promise<string> {
  const adapterIdentity = getAdapterCoordinationIdentity(fs);
  if (!fs.realPath) return JSON.stringify([adapterIdentity]);

  try {
    return JSON.stringify([adapterIdentity, normalize(await fs.realPath(lockfilePath))]);
  } catch {
    try {
      const canonicalProjectDir = normalize(await fs.realPath(projectDir));
      return JSON.stringify([
        adapterIdentity,
        normalize(`${canonicalProjectDir}/${LOCKFILE_NAME}`),
      ]);
    } catch {
      // Without a trustworthy canonical path, serialize conservatively across
      // the whole backing adapter so symlink and case aliases cannot race.
      return JSON.stringify([adapterIdentity]);
    }
  }
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
    accessKeyPromise ??= resolveLockfileAccessKey(fs, normalizedProjectDir, lockfilePath);
    return accessKeyPromise.then((accessKey) => serializeLockfileAccess(accessKey, operation));
  }

  async function readFromDisk(): Promise<LockfileData | null> {
    let content: string;
    try {
      const exists = await fs.exists(lockfilePath);
      if (!exists) return null;
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
      return data === null ? null : cloneLockfileData(data);
    });
  }

  async function writeToDisk(data: LockfileData): Promise<void> {
    const sorted: LockfileData = {
      version: LOCKFILE_VERSION,
      imports: Object.fromEntries(
        Object.entries(data.imports)
          .sort(([a], [b]) => a.localeCompare(b))
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
      const data = (await readCurrent()) ?? createEmptyLockfile();
      data.imports[url] = snapshot;
      cache = data;
      pendingEntries.set(url, snapshot);
    });
  }

  function has(url: string): Promise<boolean> {
    return serializeManagerOperation(async () => {
      const data = await readCurrent();
      return url in (data?.imports ?? {});
    });
  }

  function clear(): Promise<void> {
    return serializeManagerOperation(() =>
      withLockfileAccess(async () => {
        const existing = await readFromDisk();
        const cleared = createEmptyLockfile();
        if (existing !== null) {
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
        const merged = (await readFromDisk()) ?? createEmptyLockfile();
        for (const [url, entry] of snapshot) {
          merged.imports[url] = cloneLockfileEntry(entry);
        }

        await writeToDisk(merged);
        for (const [url, entry] of snapshot) {
          if (pendingEntries.get(url) === entry) pendingEntries.delete(url);
        }
        for (const [url, entry] of pendingEntries) {
          merged.imports[url] = cloneLockfileEntry(entry);
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
