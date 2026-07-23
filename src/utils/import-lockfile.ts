import { computeHash } from "./hash-utils.ts";
import { serverLogger } from "./logger/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { CACHE_ERROR, NETWORK_ERROR } from "#veryfront/errors/error-registry.ts";
import { VERSION } from "./version-constant.ts";
import { resolve } from "#veryfront/platform/compat/path/index.ts";
import { cwd } from "#veryfront/platform/compat/process.ts";

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
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;
const LOCK_RETRY_INITIAL_MS = 10;
const LOCK_RETRY_MAX_MS = 100;

const pathMutationTails = new Map<string, Promise<void>>();

async function withPathMutation<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const previous = pathMutationTails.get(path) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  pathMutationTails.set(path, current);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release?.();
    if (pathMutationTails.get(path) === current) pathMutationTails.delete(path);
  }
}

export function createEmptyLockfile(): LockfileData {
  return { version: LOCKFILE_VERSION, imports: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeLockfileEntry(value: unknown): LockfileEntry | null {
  if (
    !isRecord(value) || typeof value.resolved !== "string" || typeof value.integrity !== "string"
  ) {
    return null;
  }
  if (
    value.dependencies !== undefined &&
    (!Array.isArray(value.dependencies) ||
      !value.dependencies.every((dependency) => typeof dependency === "string"))
  ) {
    return null;
  }
  if (value.fetchedAt !== undefined && typeof value.fetchedAt !== "string") return null;

  return {
    resolved: value.resolved,
    integrity: value.integrity,
    ...(value.dependencies === undefined ? {} : { dependencies: [...value.dependencies] }),
    ...(value.fetchedAt === undefined ? {} : { fetchedAt: value.fetchedAt }),
  };
}

function defineImport(
  imports: Record<string, LockfileEntry>,
  specifier: string,
  entry: LockfileEntry,
): void {
  Object.defineProperty(imports, specifier, {
    configurable: true,
    enumerable: true,
    value: entry,
    writable: true,
  });
}

function normalizeLockfileData(value: unknown): LockfileData {
  if (!isRecord(value) || value.version !== LOCKFILE_VERSION || !isRecord(value.imports)) {
    throw new TypeError("Invalid lockfile structure");
  }

  const imports: Record<string, LockfileEntry> = {};
  for (const [specifier, candidate] of Object.entries(value.imports)) {
    const entry = normalizeLockfileEntry(candidate);
    if (!entry) throw new TypeError(`Invalid lockfile entry for ${specifier}`);
    defineImport(imports, specifier, entry);
  }

  return { version: LOCKFILE_VERSION, imports };
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

/** Public API contract for lockfile manager. */
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
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove?(path: string): Promise<void>;
  /** Atomically creates a new file, returning false when it already exists. */
  writeFileExclusive?(path: string, content: string): Promise<boolean>;
  /** Atomically replaces the destination with the source file. */
  rename?(sourcePath: string, destinationPath: string): Promise<void>;
};

function createPlatformFSAdapter(): FSAdapter {
  const fs = createFileSystem();

  return {
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
    async writeFileExclusive(path: string, content: string): Promise<boolean> {
      const nodeFs = await import("node:fs/promises");
      let handle: Awaited<ReturnType<typeof nodeFs.open>> | undefined;
      try {
        handle = await nodeFs.open(path, "wx");
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === "EEXIST") return false;
        throw cause;
      }

      try {
        await handle.writeFile(content, { encoding: "utf8" });
        await handle.sync();
        await handle.close();
        handle = undefined;
        return true;
      } catch (cause) {
        await handle?.close().catch(() => undefined);
        handle = undefined;
        await nodeFs.rm(path, { force: true }).catch(() => undefined);
        throw cause;
      }
    },
    async rename(sourcePath: string, destinationPath: string): Promise<void> {
      const nodeFs = await import("node:fs/promises");
      await nodeFs.rename(sourcePath, destinationPath);
    },
  };
}

/** Create lockfile manager. */
export function createLockfileManager(projectDir: string, fsAdapter?: FSAdapter): LockfileManager {
  const fs = fsAdapter ?? createPlatformFSAdapter();
  // Supplying cwd explicitly keeps relative project directories correct in
  // runtimes where the path compatibility layer cannot load node:path.
  const lockfilePath = resolve(cwd(), projectDir, LOCKFILE_NAME);
  const processLockPath = `${lockfilePath}.lock`;
  let cache: LockfileData | null = null;
  let readInFlight: Promise<LockfileData | null> | null = null;
  let revision = 0;
  const pendingEntries = new Map<string, { entry: LockfileEntry; revision: number }>();

  function createToken(): string {
    return crypto.randomUUID();
  }

  function sortLockfile(data: LockfileData): LockfileData {
    return {
      version: data.version,
      imports: Object.fromEntries(
        Object.entries(data.imports).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0
        ),
      ),
    };
  }

  function mergeEntries(
    base: LockfileData | null,
    entries: Iterable<[string, { entry: LockfileEntry }]>,
  ): LockfileData {
    const merged = normalizeLockfileData(base ?? createEmptyLockfile());
    for (const [specifier, pending] of entries) {
      defineImport(merged.imports, specifier, pending.entry);
    }
    return merged;
  }

  async function readFromDisk(): Promise<LockfileData | null> {
    let content: string;
    try {
      if (!(await fs.exists(lockfilePath))) return null;
      content = await fs.readFile(lockfilePath);
    } catch (cause) {
      throw CACHE_ERROR.create({
        detail: `Failed to read lockfile ${lockfilePath}`,
        cause,
      });
    }

    try {
      const parsed = JSON.parse(content) as unknown;
      if (isRecord(parsed) && parsed.version !== LOCKFILE_VERSION) {
        logger.warn(
          `[lockfile] Version mismatch, expected ${LOCKFILE_VERSION}, got ${parsed.version}`,
        );
        return createEmptyLockfile();
      }
      return normalizeLockfileData(parsed);
    } catch (cause) {
      throw CACHE_ERROR.create({
        detail: `Invalid lockfile ${lockfilePath}`,
        cause,
      });
    }
  }

  async function load(): Promise<LockfileData | null> {
    if (cache) return cache;
    if (readInFlight) return readInFlight;

    const pending = (async (): Promise<LockfileData | null> => {
      const readRevision = revision;
      const diskData = await readFromDisk();
      if (revision !== readRevision) return cache;
      cache = diskData;
      return diskData;
    })();

    readInFlight = pending;
    try {
      return await pending;
    } finally {
      if (readInFlight === pending) readInFlight = null;
    }
  }

  async function read(): Promise<LockfileData | null> {
    return await load();
  }

  async function acquireProcessLock(): Promise<() => Promise<void>> {
    if (!fs.writeFileExclusive || !fs.remove) return () => Promise.resolve();

    const token = createToken();
    const startedAt = Date.now();
    let retryDelayMs = LOCK_RETRY_INITIAL_MS;

    while (!(await fs.writeFileExclusive(processLockPath, token))) {
      if (Date.now() - startedAt >= LOCK_ACQUIRE_TIMEOUT_MS) {
        throw CACHE_ERROR.create({
          detail: `Timed out acquiring lockfile mutation lock ${processLockPath}; ` +
            "remove it only after confirming no Veryfront process is writing",
        });
      }
      await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, retryDelayMs));
      retryDelayMs = Math.min(retryDelayMs * 2, LOCK_RETRY_MAX_MS);
    }

    return async (): Promise<void> => {
      let currentToken: string;
      try {
        currentToken = await fs.readFile(processLockPath);
      } catch (cause) {
        throw CACHE_ERROR.create({
          detail: `Failed to verify lock ownership for ${processLockPath}`,
          cause,
        });
      }
      if (currentToken !== token) {
        throw CACHE_ERROR.create({
          detail: `Lock ownership changed unexpectedly for ${processLockPath}`,
        });
      }
      await fs.remove?.(processLockPath);
    };
  }

  async function removeIfPresent(path: string): Promise<void> {
    if (!fs.remove || !(await fs.exists(path))) return;
    await fs.remove(path);
  }

  async function writeAtomically(data: LockfileData): Promise<void> {
    const content = `${JSON.stringify(sortLockfile(data), null, 2)}\n`;
    if (!fs.rename) {
      await fs.writeFile(lockfilePath, content);
      return;
    }

    const temporaryPath = `${lockfilePath}.tmp.${createToken()}`;
    try {
      await fs.writeFile(temporaryPath, content);
      await fs.rename(temporaryPath, lockfilePath);
    } finally {
      await removeIfPresent(temporaryPath);
    }
  }

  async function mutateFile<T>(operation: () => Promise<T>): Promise<T> {
    return await withPathMutation(lockfilePath, async () => {
      const releaseProcessLock = await acquireProcessLock();
      try {
        return await operation();
      } finally {
        await releaseProcessLock();
      }
    });
  }

  async function write(data: LockfileData): Promise<void> {
    const normalized = normalizeLockfileData(data);
    const writeRevision = ++revision;
    pendingEntries.clear();
    cache = normalized;

    await mutateFile(() => writeAtomically(normalized));
    if (revision === writeRevision) cache = normalized;
    logger.debug(`Written ${Object.keys(normalized.imports).length} entries`);
  }

  async function get(url: string): Promise<LockfileEntry | null> {
    const data = await load();
    if (!data || !Object.hasOwn(data.imports, url)) return null;
    return data.imports[url] ?? null;
  }

  async function set(url: string, entry: LockfileEntry): Promise<void> {
    const normalizedEntry = normalizeLockfileEntry(entry);
    if (!normalizedEntry) throw new TypeError(`Invalid lockfile entry for ${url}`);

    const existing = await load();
    const data = existing ?? cache ?? createEmptyLockfile();
    const entryRevision = ++revision;
    defineImport(data.imports, url, normalizedEntry);
    pendingEntries.set(url, { entry: normalizedEntry, revision: entryRevision });
    cache = data;
  }

  async function has(url: string): Promise<boolean> {
    const data = await load();
    return data !== null && Object.hasOwn(data.imports, url);
  }

  async function clear(): Promise<void> {
    cache = createEmptyLockfile();
    revision++;
    pendingEntries.clear();

    await mutateFile(async () => {
      if (!fs.remove) return;
      await removeIfPresent(lockfilePath);
    });
  }

  async function flush(): Promise<void> {
    if (pendingEntries.size === 0) return;

    const flushRevision = revision;
    const snapshot = new Map(pendingEntries);
    const merged = await mutateFile(async () => {
      const merged = mergeEntries(await readFromDisk(), snapshot);
      await writeAtomically(merged);
      return merged;
    });

    for (const [specifier, pending] of snapshot) {
      if (pendingEntries.get(specifier)?.revision === pending.revision) {
        pendingEntries.delete(specifier);
      }
    }
    if (revision === flushRevision) cache = merged;
    logger.debug(`Written ${Object.keys(merged.imports).length} entries`);
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

const USER_AGENT_HEADERS = { "user-agent": `Mozilla/5.0 Veryfront/${VERSION}` };

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
