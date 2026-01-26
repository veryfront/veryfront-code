import * as dntShim from "../../_dnt.shims.js";
import { computeHash } from "./hash-utils.js";
import { serverLogger as logger } from "./logger/index.js";
import { createFileSystem } from "../platform/compat/fs.js";

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

export function createEmptyLockfile(): LockfileData {
  return { version: LOCKFILE_VERSION, imports: {} };
}

export async function computeIntegrity(content: string): Promise<string> {
  const hash = await computeHash(content);
  return `sha256-${hash}`;
}

export async function verifyIntegrity(content: string, integrity: string): Promise<boolean> {
  const computed = await computeIntegrity(content);
  return computed === integrity;
}

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

export function createLockfileManager(projectDir: string, fsAdapter?: FSAdapter): LockfileManager {
  const fs = fsAdapter ?? createPlatformFSAdapter();
  const lockfilePath = `${projectDir}/${LOCKFILE_NAME}`;
  let cache: LockfileData | null = null;
  let dirty = false;

  async function read(): Promise<LockfileData | null> {
    if (cache) return cache;

    try {
      if (!(await fs.exists(lockfilePath))) return null;

      const content = await fs.readFile(lockfilePath);
      cache = JSON.parse(content) as LockfileData;

      if (cache.version !== LOCKFILE_VERSION) {
        logger.warn(
          `[lockfile] Version mismatch, expected ${LOCKFILE_VERSION}, got ${cache.version}`,
        );
        cache = createEmptyLockfile();
      }

      return cache;
    } catch (e) {
      logger.debug(`[lockfile] Could not read lockfile: ${e}`);
      return null;
    }
  }

  async function write(data: LockfileData): Promise<void> {
    cache = data;

    const sorted: LockfileData = {
      version: data.version,
      imports: Object.fromEntries(
        Object.entries(data.imports).sort(([a], [b]) => a.localeCompare(b)),
      ),
    };

    await fs.writeFile(lockfilePath, JSON.stringify(sorted, null, 2) + "\n");
    dirty = false;
    logger.debug(`[lockfile] Written ${Object.keys(data.imports).length} entries`);
  }

  async function get(url: string): Promise<LockfileEntry | null> {
    const data = await read();
    return data?.imports[url] ?? null;
  }

  async function set(url: string, entry: LockfileEntry): Promise<void> {
    const data = (await read()) ?? createEmptyLockfile();
    data.imports[url] = entry;
    cache = data;
    dirty = true;
  }

  async function has(url: string): Promise<boolean> {
    const data = await read();
    return url in (data?.imports ?? {});
  }

  async function clear(): Promise<void> {
    cache = createEmptyLockfile();
    dirty = false;

    if (!fs.remove) return;
    if (!(await fs.exists(lockfilePath))) return;

    await fs.remove(lockfilePath);
  }

  async function flush(): Promise<void> {
    if (!dirty || !cache) return;
    await write(cache);
  }

  return { read, write, get, set, has, clear, flush };
}

export interface FetchWithLockOptions {
  lockfile: LockfileManager;
  url: string;
  fetchFn?: typeof dntShim.fetch;
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
  const { lockfile, url, fetchFn = dntShim.fetch, strict = false } = options;

  const entry = await lockfile.get(url);

  if (entry) {
    logger.debug(`[lockfile] Cache hit for ${url}`);

    const res = await fetchFn(entry.resolved, { headers: USER_AGENT_HEADERS });

    if (!res.ok) {
      if (strict) {
        throw new Error(
          `Lockfile entry stale: ${url} resolved to ${entry.resolved} returned ${res.status}`,
        );
      }
      logger.warn(`[lockfile] Cached URL ${entry.resolved} returned ${res.status}, refetching`);
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
        throw new Error(
          `Integrity mismatch for ${url}: expected ${entry.integrity}, got ${currentIntegrity}`,
        );
      }
      logger.warn(`[lockfile] Integrity mismatch for ${url}, updating lockfile`);
    }
  }

  logger.debug(`[lockfile] Fetching fresh: ${url}`);
  const res = await fetchFn(url, { headers: USER_AGENT_HEADERS, redirect: "follow" });

  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);

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
  } catch {
    return null;
  }
}
