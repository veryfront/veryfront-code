import type {
  DirEntry,
  FileChangeEvent,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "../../base.ts";
import { createFileWatcher, createWatcherIterator, setupNodeFsWatcher } from "./shared-watcher.ts";
import { makeNodeTempDir } from "./temp-dir.ts";
import { isProxyWithoutHooks } from "../../../compat/error-introspection.ts";
import { isCanonicalNotFoundError } from "../../../compat/not-found-error.ts";
import {
  readBoundedFilePrefix,
  readFileWithinLimit,
  withFileHandle,
} from "../../bounded-file-read.ts";
import {
  isDirectConstruction,
  markNativeFileSystemAdapter,
} from "../../native-file-system-provenance.ts";
import { constants as nodeFsConstants } from "node:fs";
import { resolve } from "../../../compat/path/index.ts";
import { runtimeUsesWindowsPaths } from "../../../compat/path/portable.ts";
import { FileSnapshotChangedError, FileSnapshotPathError } from "../../file-snapshot-error.ts";
import {
  hasUsableNativeFileIdentity,
  type NativeSnapshotPlatform,
} from "./native-snapshot-identity.ts";
import { isPathContainedBy } from "../../path-containment.ts";

export interface NodeFileSystemLogger {
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

const silentLogger: NodeFileSystemLogger = {
  error: () => {},
  debug: () => {},
};
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const reflectApply = Reflect.apply;

interface NodeFileSnapshotStat {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface NodeFileHandle {
  stat(): Promise<NodeFileSnapshotStat>;
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ bytesRead: number }>;
  writeFile(content: Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface NodeFileSystemOperations {
  realpath(path: string): Promise<string>;
  lstat(path: string): Promise<NodeFileSnapshotStat>;
  open(path: string, flags: number | string): Promise<NodeFileHandle>;
}

export interface NodeFileSystemCapabilityOptions {
  /** Test seam for runtime constants. An own undefined value means unavailable. */
  readonly noFollow?: number;
  /** Test seam for native open and path semantics. */
  readonly platform?: NativeSnapshotPlatform;
  /** Test seam for create-new primitive availability. */
  readonly exclusiveCreate?: boolean;
  /** Test seam for deterministic filesystem races and write failures. */
  readonly operations?: Partial<NodeFileSystemOperations>;
}

/** Runtime whose Node-compatible filesystem implementation backs the adapter. */
export type NodeCompatibleRuntimeProvenance = "node" | "bun" | "deno" | "unknown";

function toSnapshotStat(stats: import("node:fs").BigIntStats): NodeFileSnapshotStat {
  return {
    dev: stats.dev,
    ino: stats.ino,
    size: stats.size,
    mtimeNs: stats.mtimeNs,
    ctimeNs: stats.ctimeNs,
    isFile: () => stats.isFile(),
    isSymbolicLink: () => stats.isSymbolicLink(),
  };
}

const nodeFileSystemOperations: NodeFileSystemOperations = {
  async realpath(path) {
    const fs = await import("node:fs/promises");
    return await fs.realpath(path);
  },
  async lstat(path) {
    const fs = await import("node:fs/promises");
    return toSnapshotStat(await fs.lstat(path, { bigint: true }));
  },
  async open(path, flags) {
    const fs = await import("node:fs/promises");
    const handle = await fs.open(path, flags);
    return {
      async stat() {
        return toSnapshotStat(await handle.stat({ bigint: true }));
      },
      read(buffer, offset, length, position) {
        return handle.read(buffer, offset, length, position);
      },
      writeFile(content) {
        return handle.writeFile(content);
      },
      close() {
        return handle.close();
      },
    };
  },
};

function hasOwn(value: object, property: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function detectNodeCompatibleRuntime(): NodeCompatibleRuntimeProvenance {
  const runtime = globalThis as typeof globalThis & {
    Bun?: unknown;
    Deno?: unknown;
    process?: {
      release?: { name?: string };
      versions?: { bun?: string; deno?: string; node?: string };
    };
  };
  const versions = runtime.process?.versions;
  if (typeof versions?.deno === "string" || runtime.Deno !== undefined) return "deno";
  if (typeof versions?.bun === "string" || runtime.Bun !== undefined) return "bun";
  if (
    runtime.process?.release?.name === "node" &&
    typeof versions?.node === "string"
  ) {
    return "node";
  }
  return "unknown";
}

export function hasUsableWindowsSnapshotIdentity(
  runtime: NodeCompatibleRuntimeProvenance,
): boolean {
  // Node exposes bigint file identity and generation fields on Windows. Each
  // snapshot still validates that the native identity is present and usable.
  // Bun and Deno do not currently document an equivalent contract, so their
  // Windows adapters must fail closed.
  return runtime === "node";
}

function requirePositiveSafeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Snapshot byte limit must be a positive safe integer");
  }
}

function sameIdentity(left: NodeFileSnapshotStat, right: NodeFileSnapshotStat): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameGeneration(left: NodeFileSnapshotStat, right: NodeFileSnapshotStat): boolean {
  return sameIdentity(left, right) &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

function requireUsableIdentity(stat: NodeFileSnapshotStat, message: string): void {
  if (!hasUsableNativeFileIdentity(stat)) {
    throw changed(message);
  }
}

function changed(message: string, cause?: unknown): FileSnapshotChangedError {
  const error = new FileSnapshotChangedError(message);
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", { value: cause, configurable: true });
  }
  return error;
}

function hasOwnDataErrorCode(error: unknown, expected: string): boolean {
  if (typeof error !== "object" || error === null || isProxyWithoutHooks(error)) {
    return false;
  }
  try {
    const descriptor = getOwnPropertyDescriptor(error, "code");
    return descriptor !== undefined &&
      reflectApply(hasOwnProperty, descriptor, ["value"]) === true &&
      descriptor.value === expected;
  } catch {
    return false;
  }
}

function throwSnapshotChangeForMissingPath(message: string, cause: unknown): never {
  if (isCanonicalNotFoundError(cause)) {
    throw changed(message, cause);
  }
  throw cause;
}

function throwSnapshotChangeForPathRace(message: string, cause: unknown): never {
  if (hasOwnDataErrorCode(cause, "ELOOP")) {
    throw changed(message, cause);
  }
  throwSnapshotChangeForMissingPath(message, cause);
}

export async function readNodeFileSnapshotWithinLimit(
  operations: NodeFileSystemOperations,
  platform: NativeSnapshotPlatform,
  noFollow: number | undefined,
  path: string,
  containmentRoot: string,
  byteLimit: number,
): Promise<Uint8Array> {
  requirePositiveSafeInteger(byteLimit);
  let openFlags: number | string;
  if (platform === "windows") {
    openFlags = "r";
  } else {
    if (typeof noFollow !== "number" || noFollow === 0) {
      throw new TypeError("This runtime cannot guarantee no-follow snapshot opens");
    }
    openFlags = nodeFsConstants.O_RDONLY | noFollow;
  }
  const lexicalRoot = resolve(containmentRoot);
  const candidate = resolve(path);
  const canonicalRoot = await operations.realpath(lexicalRoot);
  if (
    !isPathContainedBy(candidate, lexicalRoot) &&
    !isPathContainedBy(candidate, canonicalRoot)
  ) {
    throw new FileSnapshotPathError("Snapshot path must be contained by the requested root");
  }

  const pathnameBefore = await operations.lstat(candidate);
  if (pathnameBefore.isSymbolicLink()) {
    throw new FileSnapshotPathError("Snapshot path must not be a symbolic link");
  }
  if (!pathnameBefore.isFile()) {
    throw new FileSnapshotPathError("Snapshot path must identify a regular file");
  }
  requireUsableIdentity(
    pathnameBefore,
    "Stable native file identity is unavailable for the snapshot path",
  );

  return await withFileHandle(
    async () => {
      try {
        return await operations.open(candidate, openFlags);
      } catch (cause) {
        throwSnapshotChangeForPathRace(
          "File identity became uncertain while opening the snapshot",
          cause,
        );
      }
    },
    async (handle) => {
      let handleBefore: NodeFileSnapshotStat;
      try {
        handleBefore = await handle.stat();
      } catch (cause) {
        throwSnapshotChangeForMissingPath("Opened file identity could not be verified", cause);
      }
      requireUsableIdentity(
        handleBefore,
        "Stable native file identity is unavailable for the opened snapshot",
      );
      if (!handleBefore.isFile() || !sameGeneration(pathnameBefore, handleBefore)) {
        throw changed("File identity changed while opening the snapshot");
      }

      let canonicalTarget: string;
      let pathnameOpened: NodeFileSnapshotStat;
      try {
        [canonicalTarget, pathnameOpened] = await Promise.all([
          operations.realpath(candidate),
          operations.lstat(candidate),
        ]);
      } catch (cause) {
        throwSnapshotChangeForPathRace(
          "File target became uncertain while opening the snapshot",
          cause,
        );
      }
      if (
        pathnameOpened.isSymbolicLink() ||
        !pathnameOpened.isFile() ||
        !sameGeneration(handleBefore, pathnameOpened)
      ) {
        throw changed("File identity changed while opening the snapshot");
      }
      requireUsableIdentity(
        pathnameOpened,
        "Stable native file identity is unavailable while verifying the snapshot",
      );
      if (!isPathContainedBy(canonicalTarget, canonicalRoot)) {
        throw new FileSnapshotPathError(
          "Snapshot target must be contained by the canonical root",
        );
      }

      if (handleBefore.size < 0n) {
        throw changed("File size became uncertain while opening the snapshot");
      }
      if (handleBefore.size > BigInt(byteLimit)) {
        throw new RangeError(`File exceeds byte limit of ${byteLimit} bytes`);
      }

      const size = Number(handleBefore.size);
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(size);
      } catch (cause) {
        throw new Error("Unable to allocate the admitted snapshot buffer", { cause });
      }
      let offset = 0;
      while (offset < size) {
        const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
        if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > size - offset) {
          throw changed("File size changed while reading the snapshot");
        }
        offset += bytesRead;
      }

      let handleAfter: NodeFileSnapshotStat;
      let pathnameAfter: NodeFileSnapshotStat;
      let canonicalTargetAfter: string;
      try {
        handleAfter = await handle.stat();
      } catch (cause) {
        throwSnapshotChangeForMissingPath(
          "Opened file identity could not be verified after reading the snapshot",
          cause,
        );
      }
      try {
        [pathnameAfter, canonicalTargetAfter] = await Promise.all([
          operations.lstat(candidate),
          operations.realpath(candidate),
        ]);
      } catch (cause) {
        throwSnapshotChangeForPathRace(
          "File identity became uncertain after reading the snapshot",
          cause,
        );
      }
      requireUsableIdentity(
        handleAfter,
        "Stable native file identity is unavailable after reading the snapshot",
      );
      requireUsableIdentity(
        pathnameAfter,
        "Stable native file identity is unavailable after reading the snapshot path",
      );
      if (
        !pathnameAfter.isFile() ||
        pathnameAfter.isSymbolicLink() ||
        !sameGeneration(handleBefore, handleAfter) ||
        !sameGeneration(handleBefore, pathnameAfter) ||
        canonicalTargetAfter !== canonicalTarget ||
        !isPathContainedBy(canonicalTargetAfter, canonicalRoot)
      ) {
        throw changed("File snapshot changed during the read");
      }
      return bytes;
    },
    "Filesystem snapshot and handle cleanup both failed",
  );
}

async function createNodeFileBytesExclusive(
  operations: NodeFileSystemOperations,
  path: string,
  content: Uint8Array,
): Promise<void> {
  await withFileHandle(
    () => operations.open(path, "wx"),
    (handle) => handle.writeFile(content),
    "Filesystem exclusive create and handle cleanup both failed",
  );
}

/**
 * Filesystem implementation shared by runtimes that provide Node-compatible
 * `node:fs` APIs (currently Node.js and Bun).
 */
export class NodeCompatibleFileSystemAdapter implements FileSystemAdapter {
  constructor(
    private readonly logger: NodeFileSystemLogger = silentLogger,
    options: NodeFileSystemCapabilityOptions = {},
  ) {
    const operations = {
      ...nodeFileSystemOperations,
      ...options.operations,
    } as NodeFileSystemOperations;
    const noFollow = hasOwn(options, "noFollow") ? options.noFollow : nodeFsConstants.O_NOFOLLOW;
    const platform = options.platform ?? (runtimeUsesWindowsPaths() ? "windows" : "posix");
    const canOpenExactSnapshot = platform === "windows"
      ? hasUsableWindowsSnapshotIdentity(detectNodeCompatibleRuntime())
      : typeof noFollow === "number" && noFollow !== 0;
    if (canOpenExactSnapshot) {
      Object.defineProperty(this, "readFileSnapshotWithinLimit", {
        value: (path: string, containmentRoot: string, byteLimit: number) =>
          readNodeFileSnapshotWithinLimit(
            operations,
            platform,
            noFollow,
            path,
            containmentRoot,
            byteLimit,
          ),
        enumerable: true,
      });
    }
    if (options.exclusiveCreate !== false) {
      Object.defineProperty(this, "createFileBytesExclusive", {
        value: (path: string, content: Uint8Array) =>
          createNodeFileBytesExclusive(operations, path, content),
        enumerable: true,
      });
    }
    if (isDirectConstruction(this, NodeCompatibleFileSystemAdapter)) {
      markNativeFileSystemAdapter(this);
    }
  }

  async readFile(path: string): Promise<string> {
    const fs = await import("node:fs/promises");
    return fs.readFile(path, "utf-8");
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const fs = await import("node:fs/promises");
    const buffer = await fs.readFile(path);
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  async readFileBytesBounded(path: string, byteLimit: number): Promise<Uint8Array> {
    const fs = await import("node:fs/promises");
    return await readBoundedFilePrefix(async () => {
      const handle = await fs.open(path, "r");
      return {
        close: () => handle.close(),
        async read(buffer: Uint8Array) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.byteLength,
            null,
          );
          return bytesRead === 0 ? null : bytesRead;
        },
      };
    }, byteLimit);
  }

  async readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    const fs = await import("node:fs/promises");
    return await readFileWithinLimit(async () => {
      const handle = await fs.open(path, "r");
      return {
        close: () => handle.close(),
        async read(buffer: Uint8Array) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.byteLength,
            null,
          );
          return bytesRead === 0 ? null : bytesRead;
        },
      };
    }, byteLimit);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, content, "utf-8");
  }

  async writeFileBytes(path: string, content: Uint8Array): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, content);
  }

  async rename(from: string, to: string): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.rename(from, to);
  }

  async exists(path: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    try {
      await fs.access(path);
      return true;
    } catch (error) {
      if (isCanonicalNotFoundError(error)) return false;
      throw error;
    }
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(path, { withFileTypes: true });

    for (const entry of entries) {
      yield {
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
      };
    }
  }

  async stat(path: string): Promise<FileInfo> {
    const fs = await import("node:fs/promises");
    const stats = await fs.stat(path);
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      mtime: stats.mtime,
    };
  }

  async lstat(path: string): Promise<FileInfo> {
    const fs = await import("node:fs/promises");
    const stats = await fs.lstat(path);
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      mtime: stats.mtime,
    };
  }

  async realPath(path: string): Promise<string> {
    const fs = await import("node:fs/promises");
    return await fs.realpath(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const fs = await import("node:fs/promises");
    const recursive = options?.recursive ?? false;
    try {
      await fs.rm(path, { recursive, force: true });
    } catch (error) {
      // Same divergence as `platform/compat/fs.ts`: Deno removes an empty
      // directory without `recursive`, `node:fs` `rm` refuses one, and `force`
      // does not cover it -- it suppresses a missing path, not a directory.
      if (recursive) throw error;
      const info = await fs.lstat(path).catch(() => undefined);
      if (!info?.isDirectory()) throw error;
      await fs.rmdir(path);
    }
  }

  async makeTempDir(prefix: string): Promise<string> {
    return makeNodeTempDir(prefix);
  }

  protected setupWatcher(
    path: string,
    options: Parameters<typeof setupNodeFsWatcher>[1],
  ): Promise<void> {
    return setupNodeFsWatcher(path, options);
  }

  watch(paths: string | string[], options?: WatchOptions): FileWatcher {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    const recursive = options?.recursive ?? true;
    const signal = options?.signal;

    let closed = false;
    const watchers: Array<import("node:fs").FSWatcher> = [];
    const closedWatchers = new WeakSet<import("node:fs").FSWatcher>();
    const lifecycleFailures: Error[] = [];
    const pendingTasks = new Set<Promise<void>>();
    const eventQueue: FileChangeEvent[] = [];
    let resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null = null;
    let watcherFailure: Error | undefined;
    let closeWatcherGeneration: () => void = () => {};
    let resolveClosed!: () => void;
    const closedSignal = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const setResolver = (
      value: ((result: IteratorResult<FileChangeEvent>) => void) | null,
    ): void => {
      resolver = value;
    };
    const trackTask = (task: Promise<void>): void => {
      pendingTasks.add(task);
      void task.then(
        () => pendingTasks.delete(task),
        () => pendingTasks.delete(task),
      );
    };
    const recordLifecycleFailure = (failure: unknown): void => {
      const error = failure instanceof Error ? failure : new Error(String(failure));
      if (!lifecycleFailures.includes(error)) lifecycleFailures.push(error);
    };

    const setupTasks = pathArray.map((path) =>
      this.setupWatcher(path, {
        recursive,
        closed: () => closed,
        signal,
        eventQueue,
        getResolver: () => resolver,
        setResolver,
        watchers,
        trackTask,
        onError: (error, watchPath) => {
          this.logger.error(`File watcher error for ${watchPath}`, { error });
          watcherFailure ??= error;
          closeWatcherGeneration();
        },
      })
    );
    const setup = Promise.all(setupTasks).then(() => undefined).catch((error) => {
      closeWatcherGeneration();
      throw error;
    });

    const iterator = createWatcherIterator(
      eventQueue,
      setResolver,
      () => closed,
      () => signal?.aborted ?? false,
    );

    const closeNativeWatchers = (): void => {
      for (const watcher of watchers) {
        if (closedWatchers.has(watcher)) continue;
        try {
          watcher.close();
          closedWatchers.add(watcher);
        } catch (error) {
          recordLifecycleFailure(error);
          this.logger.debug("Error closing file watcher during cleanup", { error });
        }
      }
    };

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", cleanup);
      closeNativeWatchers();

      resolver?.({ done: true, value: undefined });
      resolver = null;
      resolveClosed();
    };
    closeWatcherGeneration = cleanup;

    if (signal?.aborted) cleanup();
    else signal?.addEventListener("abort", cleanup, { once: true });
    const watcher = createFileWatcher(iterator, cleanup);
    watcher.ready = setup;
    watcher.done = (async () => {
      const [setupResult] = await Promise.allSettled([setup, closedSignal]);
      if (setupResult.status === "rejected") {
        recordLifecycleFailure(setupResult.reason);
      }

      // ready remains fail-fast, but lifecycle completion must join every
      // root acquisition. Promise.all(setupTasks) can reject while a sibling
      // lstat/readdir is still in flight.
      const setupTaskResults = await Promise.allSettled(setupTasks);
      for (const result of setupTaskResults) {
        if (result.status === "rejected") recordLifecycleFailure(result.reason);
      }

      while (pendingTasks.size > 0) {
        const results = await Promise.allSettled([...pendingTasks]);
        for (const result of results) {
          if (result.status === "rejected") recordLifecycleFailure(result.reason);
        }
      }

      // cleanup() already attempts this once. Retry any resource whose close()
      // threw, but preserve every distinct failure so completion cannot be
      // reported as clean after a partial teardown.
      closeNativeWatchers();
      if (watcherFailure) recordLifecycleFailure(watcherFailure);

      if (lifecycleFailures.length === 1) throw lifecycleFailures[0];
      if (lifecycleFailures.length > 1) {
        throw new AggregateError(
          lifecycleFailures,
          "File watcher lifecycle did not complete cleanly",
        );
      }
    })();
    return watcher;
  }
}

export interface NodeCompatibleFileSystemAdapter {
  readFileSnapshotWithinLimit?(
    path: string,
    containmentRoot: string,
    byteLimit: number,
  ): Promise<Uint8Array>;
  createFileBytesExclusive?(path: string, content: Uint8Array): Promise<void>;
}
