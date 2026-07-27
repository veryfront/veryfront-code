/**
 * File Discovery
 *
 * Bounded, adapter-aware utilities for finding project-authored source files.
 */

import { collectFiles } from "#veryfront/utils/file-discovery.ts";
import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path";
import type {
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "#veryfront/platform/adapters/base.ts";
import { readBoundedFileHandlePrefix } from "#veryfront/platform/adapters/bounded-file-read.ts";
import { isNativeFileSystemAdapter } from "#veryfront/platform/adapters/native-file-system-provenance.ts";
import { isWellFormedUtf16 } from "#veryfront/skill/string-safety.ts";
import type { FileDiscoveryContext } from "./types.ts";

const MAX_DISCOVERY_DEPTH = 64;
export const MAX_PROJECT_DISCOVERY_ENTRIES = 100_000;
const DISCOVERY_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const DISCOVERY_UTF8_ENCODER = new TextEncoder();
const COMMON_DISCOVERY_IGNORE_PATTERNS = [
  "node_modules",
  ".git",
  "__tests__",
] as const;
const TYPESCRIPT_DISCOVERY_IGNORE_PATTERNS = [
  ...COMMON_DISCOVERY_IGNORE_PATTERNS,
  "*.test.*",
  "*.spec.*",
  "*.bench.*",
  "*.d.ts",
] as const;

function relativePathInside(root: string, candidate: string): string | undefined {
  const path = relative(root, candidate);
  if (path === ".") return "";
  if (
    isAbsolute(path) ||
    path === ".." ||
    path.startsWith("../") ||
    path.startsWith("..\\")
  ) {
    return undefined;
  }
  return path;
}

/**
 * Present one relative, opaque adapter subtree through an absolute runtime
 * namespace. Runtime path validation receives absolute paths while the source
 * adapter continues to receive exactly the key form used during discovery.
 */
function createRootRebasingAdapter(
  source: FileSystemAdapter,
  sourceRoot: string,
  runtimeRoot: string,
): FileSystemAdapter {
  const toSourcePath = (path: string): string => {
    if (!isAbsolute(path)) return path;
    const suffix = relativePathInside(runtimeRoot, path);
    if (suffix === undefined) return path;
    return suffix === "" ? sourceRoot : join(sourceRoot, suffix);
  };

  const toRuntimePath = (path: string): string => {
    if (isAbsolute(path)) return path;
    const suffix = relativePathInside(sourceRoot, path);
    if (suffix === undefined) return path;
    return suffix === "" ? runtimeRoot : join(runtimeRoot, suffix);
  };

  const wrapWatcher = (watcher: FileWatcher): FileWatcher => ({
    close: () => watcher.close(),
    ...(watcher.ready === undefined ? {} : { ready: watcher.ready }),
    ...(watcher.done === undefined ? {} : { done: watcher.done }),
    async *[Symbol.asyncIterator]() {
      for await (const event of watcher) {
        yield {
          kind: event.kind,
          paths: event.paths.map(toRuntimePath),
        };
      }
    },
  });

  const pathInputMethods = new Set<PropertyKey>([
    "readFile",
    "readFileBytes",
    "readFileBytesBounded",
    "readTextFile",
    "readOptionalTextFile",
    "writeFile",
    "exists",
    "readDir",
    "readdir",
    "stat",
    "lstat",
    "mkdir",
    "remove",
  ]);
  const methodViews = new Map<PropertyKey, (...args: unknown[]) => unknown>();
  const getMethodView = (
    property: PropertyKey,
    create: () => (...args: unknown[]) => unknown,
  ): (...args: unknown[]) => unknown => {
    const existing = methodViews.get(property);
    if (existing) return existing;
    const method = create();
    methodViews.set(property, method);
    return method;
  };
  const callSourceMethod = (property: PropertyKey, args: unknown[]): unknown => {
    const method = Reflect.get(source, property, source);
    if (typeof method !== "function") {
      throw new TypeError(`Filesystem adapter method "${String(property)}" is unavailable`);
    }
    return Reflect.apply(method, source, args);
  };

  // Proxying preserves hosted-adapter provenance and any extension methods
  // while rebasing only the standard filesystem operations that carry paths.
  // The proxy uses a fresh target with the same prototype: using `source`
  // directly would violate Proxy invariants when an adapter freezes its own
  // method properties.
  const viewTarget = Object.create(
    Reflect.getPrototypeOf(source),
  ) as FileSystemAdapter;
  return new Proxy(viewTarget, {
    has(_target, property) {
      return Reflect.has(source, property);
    },
    get(_target, property) {
      const value = Reflect.get(source, property, source);
      if (typeof value !== "function" || property === "constructor") return value;

      if (pathInputMethods.has(property)) {
        return getMethodView(property, () => (...args: unknown[]) =>
          callSourceMethod(property, [
            toSourcePath(args[0] as string),
            ...args.slice(1),
          ]));
      }

      if (property === "rename") {
        return getMethodView(property, () => (...args: unknown[]) =>
          callSourceMethod(property, [
            toSourcePath(args[0] as string),
            toSourcePath(args[1] as string),
            ...args.slice(2),
          ]));
      }

      if (property === "realPath") {
        return getMethodView(property, () => async (...args: unknown[]) =>
          toRuntimePath(
            await callSourceMethod(property, [
              toSourcePath(args[0] as string),
              ...args.slice(1),
            ]) as string,
          ));
      }

      if (property === "resolveFile") {
        return getMethodView(property, () => async (...args: unknown[]) => {
          const resolved = await callSourceMethod(property, [
            toSourcePath(args[0] as string),
            ...args.slice(1),
          ]) as string | null;
          return resolved === null ? null : toRuntimePath(resolved);
        });
      }

      if (property === "watch") {
        return getMethodView(property, () => (...args: unknown[]) => {
          const paths = args[0] as string | string[];
          const watcher = callSourceMethod(property, [
            Array.isArray(paths) ? paths.map(toSourcePath) : toSourcePath(paths),
            args[1] as WatchOptions | undefined,
          ]) as FileWatcher;
          return wrapWatcher(watcher);
        });
      }

      return getMethodView(
        property,
        () => (...args: unknown[]) => callSourceMethod(property, args),
      );
    },
  });
}

export interface RuntimeDiscoveryRoot {
  rootPath: string;
  fsAdapter?: FileSystemAdapter;
}

/**
 * Resolve a discovered directory into the absolute root required by runtime
 * path validation.
 *
 * Native roots are anchored against the runtime cwd. Adapter keys remain
 * opaque: a relative key gets an isolated rebasing view that translates only
 * paths inside this discovered subtree back to the original key namespace.
 */
export function resolveRuntimeDiscoveryRoot(
  discoveredRoot: string,
  context: FileDiscoveryContext,
): RuntimeDiscoveryRoot {
  if (isAbsolute(discoveredRoot)) {
    return {
      rootPath: discoveredRoot,
      ...(context.fsAdapter === undefined ? {} : { fsAdapter: context.fsAdapter }),
    };
  }

  const rootPath = resolve(discoveredRoot);
  if (context.fsAdapter === undefined) return { rootPath };

  return {
    rootPath,
    fsAdapter: createRootRebasingAdapter(
      context.fsAdapter,
      discoveredRoot,
      rootPath,
    ),
  };
}

/**
 * Find files with one of the requested extensions under a discovery root.
 *
 * Adapter paths remain opaque keys. Native paths are emitted as canonical file
 * URLs so spaces and literal percent signs round-trip through dynamic import.
 */
async function findFilesByExtension(
  dir: string,
  context: FileDiscoveryContext,
  extensions: readonly string[],
  ignorePatterns: readonly string[],
): Promise<string[]> {
  if (!(await discoveryFileExists(dir, context))) return [];

  const files = await collectFiles({
    baseDir: dir,
    extensions: [...extensions],
    recursive: true,
    maxDepth: MAX_DISCOVERY_DEPTH,
    maxEntries: MAX_PROJECT_DISCOVERY_ENTRIES,
    ignorePatterns: [...ignorePatterns],
    fsAdapter: context.fsAdapter,
    entryBudget: context.entryBudget,
  });

  if (context.fsAdapter) {
    // Adapter paths are opaque adapter keys, not native file URLs. Keeping
    // them raw also preserves literal percent signs and relative VFS roots.
    return files.map((file) => file.path);
  }

  const { path, url } = await getNodeDeps(context);
  return files.map((file) => url.pathToFileURL(path.resolve(file.path)).href);
}

/**
 * Get Node.js fs and path modules (cached on context).
 *
 * Only called for native filesystem operations.
 */
async function getNodeDeps(
  context: FileDiscoveryContext,
): Promise<{
  fs: typeof import("node:fs");
  path: typeof import("node:path");
  url: typeof import("node:url");
}> {
  if (context.nodeDeps) return context.nodeDeps;

  const [fsModule, pathModule, urlModule] = await Promise.all([
    import("node:fs"),
    import("node:path"),
    import("node:url"),
  ]);
  context.nodeDeps = { fs: fsModule, path: pathModule, url: urlModule };
  return context.nodeDeps;
}

/** Find runtime TypeScript modules, excluding conventional test-only sources. */
export function findTypeScriptFiles(
  dir: string,
  context: FileDiscoveryContext,
): Promise<string[]> {
  return findFilesByExtension(
    dir,
    context,
    [".ts", ".tsx"],
    TYPESCRIPT_DISCOVERY_IGNORE_PATTERNS,
  );
}

type DiscoveryFileInfo = Readonly<{
  isFile: boolean;
  isSymlink: boolean;
  size: number;
}>;

async function readBoundedAdapterDiscoveryText(
  file: string,
  path: string,
  fsAdapter: FileSystemAdapter,
  maxBytes: number,
): Promise<string> {
  const readInfo = async (): Promise<DiscoveryFileInfo> => {
    const info = fsAdapter.lstat ? await fsAdapter.lstat(path) : await fsAdapter.stat(path);
    assertBoundedDiscoveryFileInfo(
      path,
      info.isFile,
      info.isSymlink,
      info.size,
      maxBytes,
    );
    return info;
  };
  const assertUnchangedSize = (
    expected: DiscoveryFileInfo,
    current: DiscoveryFileInfo,
  ): void => {
    if (current.size !== expected.size) {
      throw new TypeError(`Discovery file changed during reading: "${file}"`);
    }
  };

  const before = await readInfo();
  const boundedReader = fsAdapter.readFileBytesBounded;
  if (typeof boundedReader === "function") {
    const readSnapshot = async (): Promise<Uint8Array> => {
      const bytes = await boundedReader.call(
        fsAdapter,
        path,
        maxBytes + 1,
      );
      if (!(bytes instanceof Uint8Array)) {
        throw new TypeError(
          `Discovery filesystem adapter returned invalid bytes for "${path}"`,
        );
      }
      if (bytes.byteLength > maxBytes) {
        throw new RangeError(`Discovery file "${file}" exceeds ${maxBytes} bytes`);
      }
      if (bytes.byteLength !== before.size) {
        throw new TypeError(`Discovery file changed during reading: "${file}"`);
      }
      return bytes;
    };

    const first = await readSnapshot();
    assertUnchangedSize(before, await readInfo());
    const confirmation = await readSnapshot();
    assertUnchangedSize(before, await readInfo());
    if (!discoveryBytesEqual(first, confirmation)) {
      throw new TypeError(`Discovery file changed during reading: "${file}"`);
    }
    return decodeDiscoveryUtf8(file, first);
  }

  // Compatibility path for adapters that predate allocation-bounded reads.
  // The second snapshot catches an ordinary swap-back, but the adapter can
  // still allocate an oversized object before this caller validates it.
  const readLegacySnapshot = async (): Promise<string> => {
    const content = await fsAdapter.readFile(path);
    if (typeof content !== "string") {
      throw new TypeError(
        `Discovery filesystem adapter returned non-text content for "${path}"`,
      );
    }
    if (!isWellFormedUtf16(content)) {
      throw new TypeError(
        `Discovery file "${file}" must contain valid Unicode text`,
      );
    }
    const byteLength = DISCOVERY_UTF8_ENCODER.encode(content).byteLength;
    if (byteLength > maxBytes) {
      throw new RangeError(`Discovery file "${file}" exceeds ${maxBytes} bytes`);
    }
    if (byteLength !== before.size) {
      throw new TypeError(`Discovery file changed during reading: "${file}"`);
    }
    return content;
  };

  const first = await readLegacySnapshot();
  assertUnchangedSize(before, await readInfo());
  const confirmation = await readLegacySnapshot();
  assertUnchangedSize(before, await readInfo());
  if (confirmation !== first) {
    throw new TypeError(`Discovery file changed during reading: "${file}"`);
  }
  return first;
}

interface NativeDiscoveryFileInfo {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

type NativeDiscoveryIdentity = Readonly<{
  dev: bigint;
  ino: bigint;
  size: number;
}>;

function inspectNativeDiscoveryFile(
  path: string,
  info: NativeDiscoveryFileInfo,
  maxBytes: number,
): NativeDiscoveryIdentity {
  if (info.isSymbolicLink()) {
    throw new TypeError(`Discovery file must not be a symlink: "${path}"`);
  }
  if (!info.isFile()) {
    throw new TypeError(`Discovery path must point to a file: "${path}"`);
  }
  if (info.size < 0n) {
    throw new TypeError(`Discovery file size is invalid for "${path}"`);
  }
  if (info.size > BigInt(maxBytes)) {
    throw new RangeError(`Discovery file "${path}" exceeds ${maxBytes} bytes`);
  }
  return {
    dev: info.dev,
    ino: info.ino,
    size: Number(info.size),
  };
}

function assertSameNativeDiscoveryFile(
  file: string,
  expected: NativeDiscoveryIdentity,
  current: NativeDiscoveryIdentity,
): void {
  if (
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.size !== expected.size
  ) {
    throw new TypeError(`Discovery file changed during reading: "${file}"`);
  }
}

async function readBoundedNativeDiscoveryText(
  file: string,
  path: string,
  fs: typeof import("node:fs"),
  maxBytes: number,
): Promise<string> {
  const before = inspectNativeDiscoveryFile(
    path,
    await fs.promises.lstat(path, { bigint: true }),
    maxBytes,
  );
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  const handle = await fs.promises.open(
    path,
    fs.constants.O_RDONLY | noFollow,
  );
  try {
    const opened = inspectNativeDiscoveryFile(
      path,
      await handle.stat({ bigint: true }),
      maxBytes,
    );
    assertSameNativeDiscoveryFile(file, before, opened);

    const bytes = await readBoundedFileHandlePrefix(
      {
        async read(buffer: Uint8Array) {
          const { bytesRead } = await handle.read(
            buffer,
            0,
            buffer.byteLength,
            null,
          );
          return bytesRead === 0 ? null : bytesRead;
        },
      },
      maxBytes + 1,
    );
    if (bytes.byteLength > maxBytes) {
      throw new RangeError(`Discovery file "${file}" exceeds ${maxBytes} bytes`);
    }
    if (bytes.byteLength !== opened.size) {
      throw new TypeError(`Discovery file changed during reading: "${file}"`);
    }

    const after = inspectNativeDiscoveryFile(
      path,
      await handle.stat({ bigint: true }),
      maxBytes,
    );
    assertSameNativeDiscoveryFile(file, opened, after);
    const current = inspectNativeDiscoveryFile(
      path,
      await fs.promises.lstat(path, { bigint: true }),
      maxBytes,
    );
    assertSameNativeDiscoveryFile(file, opened, current);
    return decodeDiscoveryUtf8(file, bytes);
  } finally {
    await handle.close();
  }
}

export async function readDiscoveryTextFile(
  file: string,
  context: FileDiscoveryContext,
  options: { maxBytes?: number } = {},
): Promise<string> {
  const maxBytes = options.maxBytes;
  if (
    maxBytes !== undefined &&
    (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0 ||
      maxBytes >= Number.MAX_SAFE_INTEGER
    )
  ) {
    throw new RangeError(
      "Discovery text-file maxBytes must be a positive safe integer below Number.MAX_SAFE_INTEGER",
    );
  }

  if (context.fsAdapter) {
    const path = file.startsWith("file://")
      ? decodeURIComponent(file.slice("file://".length))
      : file;
    if (maxBytes !== undefined) {
      if (isNativeFileSystemAdapter(context.fsAdapter)) {
        const { fs } = await getNodeDeps(context);
        return await readBoundedNativeDiscoveryText(
          file,
          path,
          fs,
          maxBytes,
        );
      }
      return await readBoundedAdapterDiscoveryText(
        file,
        path,
        context.fsAdapter,
        maxBytes,
      );
    }
    return await context.fsAdapter.readFile(path);
  }

  const { fs, url } = await getNodeDeps(context);
  const path = file.startsWith("file://") ? url.fileURLToPath(file) : file;
  if (maxBytes !== undefined) {
    return await readBoundedNativeDiscoveryText(
      file,
      path,
      fs,
      maxBytes,
    );
  }
  return await fs.promises.readFile(path, "utf-8");
}

function discoveryBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function decodeDiscoveryUtf8(file: string, bytes: Uint8Array): string {
  try {
    return DISCOVERY_UTF8_DECODER.decode(bytes);
  } catch (error) {
    throw new TypeError(`Discovery file "${file}" must contain valid UTF-8`, {
      cause: error,
    });
  }
}

function assertBoundedDiscoveryFileInfo(
  path: string,
  isFile: boolean,
  isSymlink: boolean,
  size: number,
  maxBytes: number,
): void {
  if (isSymlink) {
    throw new TypeError(`Discovery file must not be a symlink: "${path}"`);
  }
  if (!isFile) {
    throw new TypeError(`Discovery path must point to a file: "${path}"`);
  }
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new TypeError(`Discovery file size is invalid for "${path}"`);
  }
  if (size > maxBytes) {
    throw new RangeError(`Discovery file "${path}" exceeds ${maxBytes} bytes`);
  }
}

/** A single top-level entry inside a discovery directory. */
export type DiscoveryDirectoryEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
};

/** Lists immediate entries, rejecting unsafe adapter names and source failures. */
export async function listDiscoveryDirectoryEntries(
  dir: string,
  context: FileDiscoveryContext,
): Promise<DiscoveryDirectoryEntry[]> {
  if (!(await discoveryFileExists(dir, context))) return [];

  const entries = await collectFiles({
    baseDir: dir,
    recursive: false,
    maxDepth: 0,
    maxEntries: MAX_PROJECT_DISCOVERY_ENTRIES,
    includeDirs: true,
    fsAdapter: context.fsAdapter,
    entryBudget: context.entryBudget,
  });
  return entries.map((entry) => ({
    name: entry.name,
    isFile: entry.isFile,
    isDirectory: entry.isDirectory,
  }));
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT" || code === "ENOTDIR") return true;
  }
  if (!(error instanceof Error)) return false;
  return error.name === "NotFound" || error.name === "NotFoundError";
}

/** Return true when a discovery path exists; operational failures propagate. */
export async function discoveryFileExists(
  path: string,
  context: FileDiscoveryContext,
): Promise<boolean> {
  if (context.fsAdapter) {
    return await context.fsAdapter.exists(path);
  }

  const { fs } = await getNodeDeps(context);
  try {
    await fs.promises.stat(path);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}
