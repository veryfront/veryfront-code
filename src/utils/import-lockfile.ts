import { computeHash } from "./hash-utils.ts";
import { serverLogger } from "./logger/index.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import {
  CACHE_ERROR,
  LOCKFILE_FORMAT_MISMATCH,
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
const lockfileMutationTails = new Map<string, Promise<void>>();

function serializeLockfileMutation<T>(
  lockfilePath: string,
  mutation: () => Promise<T>,
): Promise<T> {
  const predecessor = lockfileMutationTails.get(lockfilePath) ?? Promise.resolve();
  const result = predecessor.then(mutation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  lockfileMutationTails.set(lockfilePath, tail);

  return result.finally(() => {
    if (lockfileMutationTails.get(lockfilePath) === tail) {
      lockfileMutationTails.delete(lockfilePath);
    }
  });
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
 * Reads and mutations fail closed with a `lockfile-format-mismatch` error when the
 * on-disk lockfile uses an unsupported format version, so an older Veryfront
 * build can never destroy data written by a newer one.
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
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove?(path: string): Promise<void>;
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
  };
}

/** Create lockfile manager. */
export function createLockfileManager(projectDir: string, fsAdapter?: FSAdapter): LockfileManager {
  const fs = fsAdapter ?? createPlatformFSAdapter();
  const lockfilePath = `${projectDir}/${LOCKFILE_NAME}`;
  let cache: LockfileData | null = null;
  const pendingEntries = new Map<string, LockfileEntry>();

  async function readFromDisk(): Promise<LockfileData | null> {
    let content: string;
    try {
      const exists = await fs.exists(lockfilePath);
      if (!exists) return null;
      content = await fs.readFile(lockfilePath);
    } catch (e) {
      logger.debug(`Could not read lockfile: ${e}`);
      return null;
    }

    let parsed: LockfileData;
    try {
      parsed = JSON.parse(content) as LockfileData;
    } catch (e) {
      logger.debug(`Could not parse lockfile: ${e}`);
      return null;
    }

    if (parsed.version !== LOCKFILE_VERSION) {
      // Fail closed: silently substituting an empty lockfile here would let the
      // next flush() overwrite a newer-format file and destroy the user's data.
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

    return parsed;
  }

  async function read(): Promise<LockfileData | null> {
    if (cache) return cache;

    const data = await readFromDisk();
    if (data) cache = data;
    return data;
  }

  async function writeToDisk(data: LockfileData): Promise<void> {
    const sorted: LockfileData = {
      version: data.version,
      imports: Object.fromEntries(
        Object.entries(data.imports).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };

    await fs.writeFile(lockfilePath, `${JSON.stringify(sorted, null, 2)}\n`);
    logger.debug(`Written ${Object.keys(data.imports).length} entries`);
  }

  async function write(data: LockfileData): Promise<void> {
    await serializeLockfileMutation(lockfilePath, async () => {
      // Revalidate the on-disk format before replacing it. This throws when the
      // file was written by a newer Veryfront build, preserving that data.
      await readFromDisk();
      await writeToDisk(data);
      cache = data;
      pendingEntries.clear();
    });
  }

  async function get(url: string): Promise<LockfileEntry | null> {
    const data = await read();
    return data?.imports[url] ?? null;
  }

  async function set(url: string, entry: LockfileEntry): Promise<void> {
    const data = (await read()) ?? createEmptyLockfile();
    data.imports[url] = entry;
    cache = data;
    pendingEntries.set(url, entry);
  }

  async function has(url: string): Promise<boolean> {
    const data = await read();
    return url in (data?.imports ?? {});
  }

  async function clear(): Promise<void> {
    await serializeLockfileMutation(lockfilePath, async () => {
      cache = createEmptyLockfile();
      pendingEntries.clear();

      if (!fs.remove) return;

      const exists = await fs.exists(lockfilePath);
      if (!exists) return;

      await fs.remove(lockfilePath);
    });
  }

  async function flush(): Promise<void> {
    if (pendingEntries.size === 0) return;

    await serializeLockfileMutation(lockfilePath, async () => {
      if (pendingEntries.size === 0) return;

      // Merge only this manager's pending entries onto the latest on-disk
      // state while holding the per-path mutation turn. This makes the whole
      // read-merge-write sequence atomic relative to other in-process managers.
      const snapshot = new Map(pendingEntries);
      const merged = (await readFromDisk()) ?? createEmptyLockfile();
      for (const [url, entry] of snapshot) {
        merged.imports[url] = entry;
      }

      await writeToDisk(merged);
      cache = merged;
      for (const [url, entry] of snapshot) {
        if (pendingEntries.get(url) === entry) pendingEntries.delete(url);
      }
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
