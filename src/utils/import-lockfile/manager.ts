import { CACHE_ERROR } from "#veryfront/errors/error-registry/server.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path/index.ts";
import { generateUuid } from "../id.ts";
import { lockfileLogger as logger } from "./logger.ts";
import type { FSAdapter, LockfileData, LockfileEntry, LockfileManager } from "./types.ts";
import {
  cloneEntry,
  cloneLockfile,
  createInternalEmptyLockfile,
  entryContentBytes,
  invalidArgument,
  LOCKFILE_VERSION,
  MAX_IMPORT_COUNT,
  MAX_LOCKFILE_BYTES,
  MAX_LOCKFILE_CONTENT_BYTES,
  MAX_TOTAL_DEPENDENCIES,
  parseLockfile,
  snapshotEntryArgument,
  snapshotLockfileArgument,
  snapshotUrlArgument,
  utf8ByteLength,
} from "./validation.ts";

const LOCKFILE_NAME = "veryfront.lock";
const MAX_PROJECT_DIRECTORY_LENGTH = 4096;

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cacheOperationError(operation: "read" | "write" | "clear"): Error {
  const message = `Unable to ${operation} the import lockfile`;
  return CACHE_ERROR.create({ message, detail: message });
}

function createPlatformFSAdapter(): FSAdapter {
  const fs = createFileSystem();
  const renameFile = fs.rename?.bind(fs);

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
    ...(renameFile
      ? {
        rename(oldPath: string, newPath: string): Promise<void> {
          return renameFile(oldPath, newPath);
        },
      }
      : {}),
  };
}

function snapshotFSAdapter(adapter: FSAdapter): FSAdapter {
  if ((typeof adapter !== "object" && typeof adapter !== "function") || adapter === null) {
    throw invalidArgument("The file system adapter is invalid");
  }

  function getMethod(name: keyof FSAdapter, required: true): CallableFunction;
  function getMethod(name: keyof FSAdapter, required: false): CallableFunction | undefined;
  function getMethod(
    name: keyof FSAdapter,
    required: boolean,
  ): CallableFunction | undefined {
    let candidate: unknown;
    try {
      candidate = Reflect.get(adapter, name);
    } catch {
      throw invalidArgument("The file system adapter is invalid");
    }
    if (candidate === undefined && !required) return undefined;
    if (typeof candidate !== "function") {
      throw invalidArgument("The file system adapter is invalid");
    }
    return candidate;
  }

  const readFile = getMethod("readFile", true);
  const writeFile = getMethod("writeFile", true);
  const exists = getMethod("exists", true);
  const remove = getMethod("remove", false);
  const rename = getMethod("rename", false);
  return {
    readFile: (path) => Reflect.apply(readFile, adapter, [path]) as Promise<string>,
    writeFile: (path, content) =>
      Reflect.apply(writeFile, adapter, [path, content]) as Promise<void>,
    exists: (path) => Reflect.apply(exists, adapter, [path]) as Promise<boolean>,
    ...(remove
      ? { remove: (path: string) => Reflect.apply(remove, adapter, [path]) as Promise<void> }
      : {}),
    ...(rename
      ? {
        rename: (oldPath: string, newPath: string) =>
          Reflect.apply(rename, adapter, [oldPath, newPath]) as Promise<void>,
      }
      : {}),
  };
}

/** Create lockfile manager. */
export function createLockfileManager(projectDir: string, fsAdapter?: FSAdapter): LockfileManager {
  if (
    typeof projectDir !== "string" || projectDir.trim().length === 0 ||
    projectDir.length > MAX_PROJECT_DIRECTORY_LENGTH || projectDir.includes("\0")
  ) {
    throw invalidArgument("The project directory must be a non-empty safe path");
  }

  const fs = snapshotFSAdapter(fsAdapter ?? createPlatformFSAdapter());
  const lockfilePath = join(projectDir, LOCKFILE_NAME);
  let cache: LockfileData | null = null;
  let cacheContentBytes = 0;
  let cacheDependencyCount = 0;
  let cacheImportCount = 0;
  let loaded = false;
  let dirty = false;
  let loadPromise: Promise<void> | null = null;
  let mutationTail: Promise<void> = Promise.resolve();

  function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationTail.then(operation, operation);
    mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    if (loadPromise) return await loadPromise;

    const pendingLoad = (async (): Promise<void> => {
      let content: string;
      try {
        content = await fs.readFile(lockfilePath);
      } catch (error) {
        let isMissing = isNotFoundError(error);
        if (!isMissing) {
          try {
            isMissing = await fs.exists(lockfilePath) === false;
          } catch {
            throw cacheOperationError("read");
          }
        }
        if (isMissing) {
          cache = null;
          cacheContentBytes = 0;
          cacheDependencyCount = 0;
          cacheImportCount = 0;
          dirty = false;
          loaded = true;
          return;
        }
        throw cacheOperationError("read");
      }

      const validated = parseLockfile(content);
      cache = validated.data;
      cacheContentBytes = validated.contentBytes;
      cacheDependencyCount = validated.dependencyCount;
      cacheImportCount = validated.importCount;
      dirty = false;
      loaded = true;
      logger.debug("Import lockfile loaded", { entryCount: cacheImportCount });
    })();
    loadPromise = pendingLoad;
    try {
      await pendingLoad;
    } finally {
      if (loadPromise === pendingLoad) loadPromise = null;
    }
  }

  async function read(): Promise<LockfileData | null> {
    await mutationTail;
    await ensureLoaded();
    return cache ? cloneLockfile(cache) : null;
  }

  function serialize(data: LockfileData): string {
    const sorted: LockfileData = {
      version: LOCKFILE_VERSION,
      imports: Object.fromEntries(
        Object.entries(data.imports)
          .sort(([a], [b]) => compareCodeUnits(a, b))
          .map(([url, entry]) => [url, cloneEntry(entry)]),
      ),
    };
    const serialized = `${JSON.stringify(sorted, null, 2)}\n`;
    if (utf8ByteLength(serialized) > MAX_LOCKFILE_BYTES) {
      throw invalidArgument("Lockfile data exceeds the supported size limit");
    }
    return serialized;
  }

  async function replacePersistedLockfile(serialized: string): Promise<void> {
    try {
      if (fs.rename) {
        const temporaryPath = `${lockfilePath}.tmp-${generateUuid()}`;
        try {
          await fs.writeFile(temporaryPath, serialized);
          await fs.rename(temporaryPath, lockfilePath);
        } catch (error) {
          if (fs.remove) {
            try {
              await fs.remove(temporaryPath);
            } catch {
              logger.warn("Unable to remove a temporary import lockfile");
            }
          }
          throw error;
        }
      } else {
        await fs.writeFile(lockfilePath, serialized);
      }
    } catch {
      throw cacheOperationError("write");
    }
  }

  async function persist(): Promise<void> {
    if (!dirty || !cache) return;
    await replacePersistedLockfile(serialize(cache));
    dirty = false;
    logger.debug("Import lockfile written", { entryCount: cacheImportCount });
  }

  async function write(data: LockfileData): Promise<void> {
    const validated = snapshotLockfileArgument(data);
    await enqueueMutation(async () => {
      if (loadPromise) await loadPromise.catch(() => undefined);
      cache = validated.data;
      cacheContentBytes = validated.contentBytes;
      cacheDependencyCount = validated.dependencyCount;
      cacheImportCount = validated.importCount;
      loaded = true;
      dirty = true;
      await persist();
    });
  }

  async function get(url: string): Promise<LockfileEntry | null> {
    const safeUrl = snapshotUrlArgument(url);
    await mutationTail;
    await ensureLoaded();
    const entry = cache?.imports[safeUrl];
    return entry ? cloneEntry(entry) : null;
  }

  async function set(url: string, entry: LockfileEntry): Promise<void> {
    const safeUrl = snapshotUrlArgument(url);
    const safeEntry = snapshotEntryArgument(entry);
    await enqueueMutation(async () => {
      await ensureLoaded();
      if (!cache) {
        cache = createInternalEmptyLockfile();
        cacheContentBytes = 0;
        cacheDependencyCount = 0;
        cacheImportCount = 0;
      }

      const previous = cache.imports[safeUrl];
      const urlBytes = utf8ByteLength(safeUrl);
      const nextContentBytes = cacheContentBytes -
        (previous ? urlBytes + entryContentBytes(previous) : 0) +
        urlBytes + entryContentBytes(safeEntry);
      const nextDependencyCount = cacheDependencyCount -
        (previous?.dependencies?.length ?? 0) + (safeEntry.dependencies?.length ?? 0);
      const isNewEntry = previous === undefined;
      if (
        (isNewEntry && cacheImportCount >= MAX_IMPORT_COUNT) ||
        nextContentBytes > MAX_LOCKFILE_CONTENT_BYTES ||
        nextDependencyCount > MAX_TOTAL_DEPENDENCIES
      ) {
        throw invalidArgument("Lockfile data exceeds the supported size limit");
      }

      cache.imports[safeUrl] = safeEntry;
      cacheContentBytes = nextContentBytes;
      cacheDependencyCount = nextDependencyCount;
      if (isNewEntry) cacheImportCount += 1;
      dirty = true;
    });
  }

  async function has(url: string): Promise<boolean> {
    const safeUrl = snapshotUrlArgument(url);
    await mutationTail;
    await ensureLoaded();
    return cache ? Object.hasOwn(cache.imports, safeUrl) : false;
  }

  function clear(): Promise<void> {
    return enqueueMutation(async () => {
      if (loadPromise) await loadPromise.catch(() => undefined);
      if (!fs.remove) {
        const empty = createInternalEmptyLockfile();
        await replacePersistedLockfile(serialize(empty));
        cache = empty;
        cacheContentBytes = 0;
        cacheDependencyCount = 0;
        cacheImportCount = 0;
        loaded = true;
        dirty = false;
        return;
      }
      try {
        await fs.remove(lockfilePath);
      } catch (error) {
        if (!isNotFoundError(error)) throw cacheOperationError("clear");
      }
      cache = createInternalEmptyLockfile();
      cacheContentBytes = 0;
      cacheDependencyCount = 0;
      cacheImportCount = 0;
      loaded = true;
      dirty = false;
    });
  }

  function flush(): Promise<void> {
    return enqueueMutation(async () => {
      await persist();
    });
  }

  return { read, write, get, set, has, clear, flush };
}
