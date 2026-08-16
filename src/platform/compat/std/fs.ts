/**
 * Dependency-free filesystem helpers for Deno, Node.js, and Bun.
 *
 * Async operations use Veryfront's runtime-selected filesystem contract. The
 * only Node.js module loaded directly by this helper is runtime-gated and
 * dynamic because `existsSync` cannot use an asynchronous adapter.
 *
 * @module
 */

import {
  createFileSystem,
  getPathIdentity,
  isAlreadyExistsError,
  isNotFoundError,
  type PathIdentity,
  realPath,
} from "../fs.ts";
import {
  portableBasename,
  portableExtname,
  portableJoin,
  portableNormalize,
} from "../path/portable.ts";
import { posix } from "../path/posix.ts";
import { getDenoRuntime, isBun, isNode } from "../runtime.ts";

export interface WalkEntry {
  path: string;
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
}

export interface WalkOptions {
  maxDepth?: number;
  includeFiles?: boolean;
  includeDirs?: boolean;
  includeSymlinks?: boolean;
  followSymlinks?: boolean;
  canonicalize?: boolean;
  exts?: string[];
  match?: RegExp[];
  skip?: RegExp[];
}

export interface ExistsOptions {
  isReadable?: boolean;
  isDirectory?: boolean;
  isFile?: boolean;
}

type PathLike = string | URL;

interface NodeFileSystemModule {
  readonly constants: { readonly R_OK: number };
  readonly promises: {
    access(path: string, mode?: number): Promise<void>;
  };
  accessSync(path: string, mode?: number): void;
  statSync(path: string): {
    isFile(): boolean;
    isDirectory(): boolean;
  };
}

// Keep Node built-ins outside the browser's static import graph. A synchronous
// API cannot lazily await its implementation at call time, so load it once only
// in runtimes that actually provide Node-compatible filesystem APIs.
const nodeFileSystem = isNode || isBun
  ? await import("node:fs") as NodeFileSystemModule
  : undefined;

const denoRuntime = getDenoRuntime();
const windowsHost = denoRuntime?.build.os === "windows" ||
  (globalThis as { process?: { platform?: string } }).process?.platform === "win32";

function validateExistsOptions(options: ExistsOptions | undefined): void {
  if (options?.isDirectory && options.isFile) {
    throw new TypeError(
      "ExistsOptions.isDirectory and ExistsOptions.isFile must not both be true",
    );
  }
}

function validateWalkOptions(options: WalkOptions): void {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Walk options must be an object");
  }
  if (options.maxDepth !== undefined && typeof options.maxDepth !== "number") {
    throw new TypeError("WalkOptions.maxDepth must be a number");
  }
  for (
    const [name, value] of [
      ["includeFiles", options.includeFiles],
      ["includeDirs", options.includeDirs],
      ["includeSymlinks", options.includeSymlinks],
      ["followSymlinks", options.followSymlinks],
      ["canonicalize", options.canonicalize],
    ] as const
  ) {
    if (value !== undefined && typeof value !== "boolean") {
      throw new TypeError(`WalkOptions.${name} must be a boolean`);
    }
  }
  if (
    options.exts !== undefined &&
    (!Array.isArray(options.exts) ||
      !options.exts.every((extension) => typeof extension === "string"))
  ) {
    throw new TypeError("WalkOptions.exts must be an array of strings");
  }
  for (
    const [name, patterns] of [
      ["match", options.match],
      ["skip", options.skip],
    ] as const
  ) {
    if (
      patterns !== undefined &&
      (!Array.isArray(patterns) || !patterns.every((pattern) => pattern instanceof RegExp))
    ) {
      throw new TypeError(`WalkOptions.${name} must be an array of regular expressions`);
    }
  }
}

function isPermissionError(error: unknown): boolean {
  try {
    if (typeof error !== "object" || error === null) return false;
    const code = Reflect.get(error, "code");
    return code === "EACCES" || code === "EPERM";
  } catch {
    return false;
  }
}

function isDenoPermissionDenied(error: unknown, deno: typeof Deno): boolean {
  return error instanceof deno.errors.PermissionDenied;
}

function fileIsReadable(info: Deno.FileInfo, deno: typeof Deno): boolean {
  if (info.mode === null) return true;
  if (deno.uid() === info.uid) return (info.mode & 0o400) === 0o400;
  if (deno.gid() === info.gid) return (info.mode & 0o040) === 0o040;
  return (info.mode & 0o004) === 0o004;
}

async function pathIsReadable(path: string): Promise<boolean> {
  const deno = getDenoRuntime();
  if (deno) return fileIsReadable(await deno.stat(path), deno);
  if (!nodeFileSystem) {
    throw new TypeError("Readable filesystem checks are unavailable in this runtime");
  }

  try {
    await nodeFileSystem.promises.access(path, nodeFileSystem.constants.R_OK);
    return true;
  } catch (error) {
    if (isNotFoundError(error) || isPermissionError(error)) return false;
    throw error;
  }
}

function pathIsReadableSync(path: string, info?: Deno.FileInfo): boolean {
  const deno = getDenoRuntime();
  if (deno) return fileIsReadable(info ?? deno.statSync(path), deno);
  if (!nodeFileSystem) {
    throw new TypeError("Synchronous filesystem checks are unavailable in this runtime");
  }

  try {
    nodeFileSystem.accessSync(path, nodeFileSystem.constants.R_OK);
    return true;
  } catch (error) {
    if (isNotFoundError(error) || isPermissionError(error)) return false;
    throw error;
  }
}

function pathToString(path: PathLike): string {
  if (typeof path === "string") return path;
  if (path.protocol !== "file:") {
    throw new TypeError(`Expected a file URL, received ${path.protocol}`);
  }
  if (/%2f/i.test(path.pathname) || (windowsHost && /%5c/i.test(path.pathname))) {
    throw new TypeError("File URL path must not contain encoded path separators");
  }

  const decodedPath = decodeURIComponent(path.pathname);
  const deno = getDenoRuntime();
  const processPlatform = (globalThis as { process?: { platform?: string } }).process?.platform;
  const isWindows = deno?.build.os === "windows" || processPlatform === "win32";
  const host = path.hostname;

  if (isWindows) {
    if (host && host !== "localhost") return `//${host}${decodedPath}`;
    return /^\/[A-Za-z]:\//.test(decodedPath) ? decodedPath.slice(1) : decodedPath;
  }
  if (host && host !== "localhost") {
    throw new TypeError(`File URL host must be empty or localhost on this platform: ${host}`);
  }
  return decodedPath;
}

function pathBasename(path: string): string {
  return windowsHost ? portableBasename(path, undefined, true) : posix.basename(path);
}

function pathExtname(path: string): string {
  return windowsHost ? portableExtname(path, true) : posix.extname(path);
}

function joinPath(...paths: string[]): string {
  return windowsHost ? portableJoin(paths, true) : posix.join(...paths);
}

function normalizePath(path: string): string {
  return windowsHost ? portableNormalize(path, true) : posix.normalize(path);
}

function canonicalPathKey(path: string): string {
  let normalized = path.replaceAll("\\", "/");
  if (normalized.length > 1 && !/^[A-Za-z]:\/$/.test(normalized)) {
    normalized = normalized.replace(/\/+$/, "");
  }
  return windowsHost ? normalized.toLowerCase() : normalized;
}

function isWithinCanonicalRoot(root: string, candidate: string): boolean {
  const rootKey = canonicalPathKey(root);
  const candidateKey = canonicalPathKey(candidate);
  if (candidateKey === rootKey) return true;
  const prefix = rootKey.endsWith("/") ? rootKey : `${rootKey}/`;
  return candidateKey.startsWith(prefix);
}

function pathIdentityKey(identity: PathIdentity | undefined, canonicalPath: string): string {
  return identity
    ? `native:${identity.device}:${identity.inode}`
    : `canonical:${canonicalPathKey(canonicalPath)}`;
}

function pathIdentitiesMatch(left: PathIdentity, right: PathIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function fileInfoType(info: {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink?: boolean;
}): string {
  if (info.isFile) return "file";
  if (info.isDirectory) return "dir";
  if (info.isSymlink) return "symlink";
  return "unknown";
}

function assertDirectory(info: {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink?: boolean;
}): void {
  if (!info.isDirectory) {
    throw new Error(
      `Failed to ensure directory exists: expected 'dir', got '${fileInfoType(info)}'`,
    );
  }
}

/** Ensure that a directory exists, rejecting existing non-directory paths. */
export async function ensureDir(directory: PathLike): Promise<void> {
  const path = pathToString(directory);
  const fileSystem = createFileSystem();

  try {
    assertDirectory(await fileSystem.stat(path));
    return;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
  }

  try {
    await fileSystem.mkdir(path, { recursive: true });
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
    assertDirectory(await fileSystem.stat(path));
  }
}

/** Return whether a path exists and satisfies the requested classification. */
export async function exists(
  path: PathLike,
  options?: ExistsOptions,
): Promise<boolean> {
  validateExistsOptions(options);
  const nativePath = pathToString(path);

  try {
    const info = await createFileSystem().stat(nativePath);
    if (options?.isDirectory && !info.isDirectory) return false;
    if (options?.isFile && !info.isFile) return false;
    if (options?.isReadable && !await pathIsReadable(nativePath)) return false;
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    const deno = getDenoRuntime();
    if (deno && isDenoPermissionDenied(error, deno)) {
      const permission = await deno.permissions.query({ name: "read", path: nativePath });
      if (permission.state === "granted") return !options?.isReadable;
      throw error;
    }
    if (isPermissionError(error)) return false;
    throw error;
  }
}

/** Synchronous counterpart to {@link exists}. */
export function existsSync(
  path: PathLike,
  options?: ExistsOptions,
): boolean {
  validateExistsOptions(options);
  const nativePath = pathToString(path);

  try {
    const deno = getDenoRuntime();
    if (deno) {
      const info = deno.statSync(nativePath);
      if (options?.isDirectory && !info.isDirectory) return false;
      if (options?.isFile && !info.isFile) return false;
      if (options?.isReadable && !pathIsReadableSync(nativePath, info)) return false;
      return true;
    }
    if (!nodeFileSystem) {
      throw new TypeError("Synchronous filesystem checks are unavailable in this runtime");
    }

    const info = nodeFileSystem.statSync(nativePath);
    if (options?.isDirectory && !info.isDirectory()) return false;
    if (options?.isFile && !info.isFile()) return false;
    if (options?.isReadable && !pathIsReadableSync(nativePath)) return false;
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    const deno = getDenoRuntime();
    if (deno && isDenoPermissionDenied(error, deno)) {
      const permission = deno.permissions.querySync({ name: "read", path: nativePath });
      if (permission.state === "granted") return !options?.isReadable;
      throw error;
    }
    if (isPermissionError(error)) return false;
    throw error;
  }
}

/**
 * Walk a directory in stable lexical order.
 *
 * Symbolic links are never traversed unless `followSymlinks` is true. When
 * links are followed, canonical directory identities prevent cycles and
 * repeated traversal through aliases.
 */
export async function* walk(
  root: PathLike,
  options: WalkOptions = {},
): AsyncIterableIterator<WalkEntry> {
  validateWalkOptions(options);
  const rootPath = normalizePath(pathToString(root));
  const maxDepth = options.maxDepth ?? Infinity;
  const includeFiles = options.includeFiles ?? true;
  const includeDirs = options.includeDirs ?? true;
  const includeSymlinks = options.includeSymlinks ?? true;
  const followSymlinks = options.followSymlinks ?? false;
  const canonicalize = options.canonicalize ?? true;
  const extensions = options.exts?.map((extension) =>
    extension.startsWith(".") ? extension : `.${extension}`
  );

  if (Number.isNaN(maxDepth)) {
    throw new RangeError("WalkOptions.maxDepth must not be NaN");
  }
  if (maxDepth < 0) return;

  const rootMatchesFilters = includeDirs &&
    shouldInclude(rootPath, extensions, options.match, options.skip);
  const traverseRoot = maxDepth >= 1 && !matchesAny(rootPath, options.skip);
  if (!rootMatchesFilters && !traverseRoot) return;

  const fileSystem = createFileSystem();
  const lstatOperation = fileSystem.lstat?.bind(fileSystem);
  if (!lstatOperation) {
    throw new TypeError("The active filesystem does not support safe symbolic-link walking");
  }
  const safeLstat = lstatOperation;

  const unresolvedRootInfo = await safeLstat(rootPath);
  const canonicalRoot = await realPath(rootPath);
  const rootIdentity = await getPathIdentity(canonicalRoot);
  let rootInfo = unresolvedRootInfo;
  let rootOutputPath = rootPath;
  let rootTraversalPath = rootPath;

  if (unresolvedRootInfo.isSymlink) {
    if (!followSymlinks) {
      throw new TypeError(`Walk root is a symbolic link: ${rootPath}`);
    }
    const targetInfo = await safeLstat(canonicalRoot);
    if (targetInfo.isSymlink) {
      throw new TypeError(`Walk root changed while resolving its symbolic link: ${rootPath}`);
    }
    rootInfo = { ...targetInfo, isSymlink: true };
    if (canonicalize) {
      rootOutputPath = canonicalRoot;
      rootTraversalPath = canonicalRoot;
    }
  }

  if (!rootInfo.isDirectory) {
    throw new TypeError(`Walk root is not a directory: ${rootPath}`);
  }

  const rootEntry: WalkEntry = {
    path: rootOutputPath,
    name: pathBasename(rootPath),
    isFile: rootInfo.isFile,
    isDirectory: rootInfo.isDirectory,
    isSymlink: unresolvedRootInfo.isSymlink,
  };
  if (
    rootMatchesFilters &&
    shouldInclude(rootOutputPath, extensions, options.match, options.skip)
  ) {
    yield rootEntry;
  }
  if (!traverseRoot || matchesAny(rootOutputPath, options.skip)) return;

  const visitedDirectories = new Set<string>([
    pathIdentityKey(rootIdentity, canonicalRoot),
  ]);
  yield* walkDirectory(rootTraversalPath, 1, canonicalRoot, rootIdentity);

  async function* walkDirectory(
    directory: string,
    depth: number,
    expectedCanonicalDirectory: string,
    expectedIdentity: PathIdentity | undefined,
  ): AsyncIterableIterator<WalkEntry> {
    await assertStableDirectory(directory, expectedCanonicalDirectory, expectedIdentity);
    const entries: Array<{
      name: string;
      isFile: boolean;
      isDirectory: boolean;
      isSymlink?: boolean;
    }> = [];
    for await (const entry of fileSystem.readDir(directory)) entries.push(entry);
    await assertStableDirectory(directory, expectedCanonicalDirectory, expectedIdentity);
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

    for (const dirEntry of entries) {
      const unresolvedPath = joinPath(directory, dirEntry.name);
      if (matchesAny(unresolvedPath, options.skip)) continue;

      let outputPath = unresolvedPath;
      const currentInfo = await safeLstat(unresolvedPath);
      let isFile = currentInfo.isFile;
      let isDirectory = currentInfo.isDirectory;
      const isSymlink = currentInfo.isSymlink;
      let canonicalDirectory: string | null = null;

      if (isSymlink && followSymlinks) {
        const resolvedPath = await realPath(unresolvedPath);
        if (matchesAny(resolvedPath, options.skip)) continue;
        const targetInfo = await safeLstat(resolvedPath);
        if (targetInfo.isSymlink) {
          throw new TypeError(`Path changed while resolving its symbolic link: ${unresolvedPath}`);
        }
        isFile = targetInfo.isFile;
        isDirectory = targetInfo.isDirectory;
        canonicalDirectory = isDirectory ? resolvedPath : null;
        if (canonicalize) outputPath = resolvedPath;
      }

      const entry: WalkEntry = {
        path: outputPath,
        name: dirEntry.name,
        isFile,
        isDirectory,
        isSymlink,
      };

      if (isSymlink && !followSymlinks) {
        if (
          includeSymlinks &&
          shouldInclude(outputPath, extensions, options.match, options.skip)
        ) {
          yield entry;
        }
        continue;
      }

      if (isDirectory) {
        if (
          includeDirs &&
          shouldInclude(outputPath, extensions, options.match, options.skip)
        ) {
          yield entry;
        }
        // Standard-library parity for fractional limits: depth-1 directories
        // are included at maxDepth 1.5, while depth-2 children are not.
        if (depth + 1 > maxDepth) continue;

        canonicalDirectory ??= await realPath(unresolvedPath);
        if (!followSymlinks && !isWithinCanonicalRoot(canonicalRoot, canonicalDirectory)) {
          throw new TypeError(`Directory escaped the walk root: ${unresolvedPath}`);
        }
        const directoryIdentity = await getPathIdentity(canonicalDirectory);
        const identityKey = pathIdentityKey(directoryIdentity, canonicalDirectory);
        if (visitedDirectories.has(identityKey)) continue;
        visitedDirectories.add(identityKey);
        const traversalPath = isSymlink && canonicalize ? outputPath : unresolvedPath;
        yield* walkDirectory(
          traversalPath,
          depth + 1,
          canonicalDirectory,
          directoryIdentity,
        );
        continue;
      }

      if (
        isFile &&
        includeFiles &&
        shouldInclude(outputPath, extensions, options.match, options.skip)
      ) {
        yield entry;
      }
    }
  }

  async function assertStableDirectory(
    path: string,
    expectedCanonicalPath: string,
    expectedIdentity: PathIdentity | undefined,
  ): Promise<void> {
    const before = await safeLstat(path);
    if (before.isSymlink && !followSymlinks) {
      throw new TypeError(`Refusing to traverse a symbolic link: ${path}`);
    }
    if (!before.isDirectory && !(before.isSymlink && followSymlinks)) {
      throw new TypeError(`Walk directory changed type before traversal: ${path}`);
    }

    const actualCanonicalPath = await realPath(path);
    if (canonicalPathKey(actualCanonicalPath) !== canonicalPathKey(expectedCanonicalPath)) {
      throw new TypeError(`Walk directory changed identity before traversal: ${path}`);
    }
    if (!followSymlinks && !isWithinCanonicalRoot(canonicalRoot, actualCanonicalPath)) {
      throw new TypeError(`Directory escaped the walk root: ${path}`);
    }
    if (expectedIdentity) {
      const actualIdentity = await getPathIdentity(actualCanonicalPath);
      if (!actualIdentity || !pathIdentitiesMatch(actualIdentity, expectedIdentity)) {
        throw new TypeError(`Walk directory changed identity before traversal: ${path}`);
      }
    }
  }
}

function shouldInclude(
  path: string,
  acceptedExtensions: readonly string[] | undefined,
  match: readonly RegExp[] | undefined,
  skip: readonly RegExp[] | undefined,
): boolean {
  if (
    acceptedExtensions &&
    !acceptedExtensions.some((extension) =>
      path.endsWith(extension) || pathExtname(path) === extension
    )
  ) {
    return false;
  }
  if (match && !matchesAny(path, match)) return false;
  return !matchesAny(path, skip);
}

function matchesAny(
  value: string,
  patterns: readonly RegExp[] | undefined,
): boolean {
  if (!patterns) return false;
  return patterns.some((pattern) => {
    const previousLastIndex = pattern.lastIndex;
    pattern.lastIndex = 0;
    try {
      return pattern.test(value);
    } finally {
      pattern.lastIndex = previousLastIndex;
    }
  });
}
