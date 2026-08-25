/**
 * Skill path safety
 *
 * Validates file paths within skill directories to prevent traversal attacks.
 * Uses centralized lexical admission from #veryfront/security before applying
 * descriptor-aware filesystem checks.
 *
 * @module
 */

import {
  PathValidationError,
  validateLexicalPath,
  type ValidationResult,
} from "#veryfront/security";
import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path";
import { exists, readDir, stat } from "#veryfront/platform/compat/fs.ts";
import { createError, fromError, toError } from "#veryfront/errors";
import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  SKILL_ALLOWED_SUBDIR_MAX_ENTRIES,
  SKILL_PATH_SEGMENT_MAX_LENGTH,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_ROOT_PATH_MAX_LENGTH,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "./limits.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "./string-safety.ts";
import { isCanonicalAdapterRelativeSkillRoot } from "./types.ts";
import type { SkillOperationBudget } from "./operation-budget.ts";
const SAFE_SKILL_PATH_SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/;
const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const arrayJoin = Array.prototype.join;
const arraySort = Array.prototype.sort;
const defineProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const numberIsSafeInteger = Number.isSafeInteger;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const regExpExec = RegExp.prototype.exec;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const stringIncludes = String.prototype.includes;
const stringReplaceAll = String.prototype.replaceAll;
const stringSplit = String.prototype.split;
const stringStartsWith = String.prototype.startsWith;

function hasOwn(value: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, value, [key]) as boolean;
}

function appendOwnArrayElement<T>(values: T[], value: T): void {
  defineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

export interface SkillPathOperationOptions {
  budget?: SkillOperationBudget;
}

function assertStrictSymlinkCapabilities(fsAdapter: FileSystemAdapter | undefined): void {
  if (!fsAdapter) return;
  const semantics = getOwnPropertyDescriptor(fsAdapter, "symlinkSemantics");
  if (semantics && hasOwn(semantics, "value") && semantics.value === "none") return;
  if (typeof fsAdapter.lstat === "function" && typeof fsAdapter.realPath === "function") return;
  throw new TypeError(
    "Strict skill filesystem requires own symlinkSemantics:'none' authority or lstat and realPath capabilities",
  );
}

function isInsideDir(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  return rel === "" ||
    (
      !isAbsolute(rel) &&
      rel !== ".." &&
      !(apply(stringStartsWith, rel, ["../"]) as boolean) &&
      !(apply(stringStartsWith, rel, ["..\\"]) as boolean)
    );
}

function isFileNotFoundError(error: unknown): boolean {
  if (snapshotVeryfrontError(error)?.slug === "file-not-found") {
    return true;
  }

  const veryfrontError = fromError(error);
  return veryfrontError?.type === "file" &&
    (apply(stringStartsWith, veryfrontError.message, ["File not found:"]) as boolean);
}

interface CapturedDirectoryEntry {
  readonly name: string;
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly isSymlink: boolean;
}

function captureDirectoryEntry(value: unknown): CapturedDirectoryEntry {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError("Skill directory entry must be an object");
  }
  if (isProxyWithoutHooks(value)) {
    throw new TypeError("Skill directory entry must not be a proxy");
  }

  const readData = (property: keyof CapturedDirectoryEntry): unknown => {
    const descriptor = getOwnPropertyDescriptor(value, property);
    if (!descriptor || !hasOwn(descriptor, "value")) {
      throw new TypeError(`Skill directory entry ${property} must be a data property`);
    }
    return descriptor.value;
  };
  const name = readData("name");
  const isFile = readData("isFile");
  const isDirectory = readData("isDirectory");
  const isSymlink = readData("isSymlink");
  if (typeof name !== "string") {
    throw new TypeError("Skill directory entry name must be a data string");
  }
  if (
    typeof isFile !== "boolean" ||
    typeof isDirectory !== "boolean" ||
    typeof isSymlink !== "boolean"
  ) {
    throw new TypeError("Skill directory entry type flags must be data booleans");
  }
  return { name, isFile, isDirectory, isSymlink };
}

function splitNonEmpty(value: string, separator: string): string[] {
  const raw = apply(stringSplit, value, [separator]) as string[];
  const result: string[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const segment = raw[index];
    if (segment) appendOwnArrayElement(result, segment);
  }
  return result;
}

function containsExactString(values: readonly string[], candidate: string): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === candidate) return true;
  }
  return false;
}

async function pathExists(path: string, fsAdapter?: FileSystemAdapter): Promise<boolean> {
  return fsAdapter ? await fsAdapter.exists(path) : await exists(path);
}

async function assertIsFile(path: string, fsAdapter?: FileSystemAdapter): Promise<void> {
  const info = fsAdapter ? await fsAdapter.stat(path) : await stat(path);
  if (!info.isFile) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill path must point to a file: "${path}"`,
      }),
    );
  }
}

async function assertIsDirectory(path: string, fsAdapter?: FileSystemAdapter): Promise<void> {
  const info = fsAdapter ? await fsAdapter.stat(path) : await stat(path);
  if (!info.isDirectory) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill path must point to a directory: "${path}"`,
      }),
    );
  }
}

async function resolveLocalRealPath(path: string): Promise<string> {
  if (typeof Deno !== "undefined") {
    return await Deno.realPath(path);
  }
  const fs = await import("node:fs/promises");
  return await fs.realpath(path);
}

async function isLocalSymlink(path: string): Promise<boolean> {
  if (typeof Deno !== "undefined") {
    const info = await Deno.lstat(path);
    return info.isSymlink;
  }
  const fs = await import("node:fs/promises");
  const info = await fs.lstat(path);
  return info.isSymbolicLink();
}

async function isAdapterSymlink(
  fsAdapter: FileSystemAdapter,
  parentDir: string,
  segment: string,
  maxEntries = SKILL_SUBDIR_MAX_ENTRIES,
): Promise<boolean> {
  let entryCount = 0;
  for await (const rawEntry of fsAdapter.readDir(parentDir)) {
    entryCount += 1;
    if (entryCount > maxEntries) {
      throw new RangeError(
        `Skill directory may contain at most ${maxEntries} entries`,
      );
    }
    const entry = captureDirectoryEntry(rawEntry);
    if (entry.name === segment && entry.isSymlink) return true;
  }
  return false;
}

async function hasSymlinkInPath(
  skillRoot: string,
  canonicalPath: string,
  fsAdapter?: FileSystemAdapter,
  maxDirectoryEntries = SKILL_SUBDIR_MAX_ENTRIES,
): Promise<boolean> {
  // Adapter paths belong to the adapter's namespace. Resolving an
  // adapter-relative path against the host cwd would both change its meaning
  // and send a path the adapter never advertised back into the adapter.
  const resolvedRoot = fsAdapter ? skillRoot : resolve(skillRoot);
  const resolvedTarget = fsAdapter ? canonicalPath : resolve(canonicalPath);
  const rel = apply(
    stringReplaceAll,
    relative(resolvedRoot, resolvedTarget),
    ["\\", "/"],
  ) as string;

  if (!isInsideDir(resolvedRoot, resolvedTarget)) return true;

  if (fsAdapter?.lstat) {
    if ((await fsAdapter.lstat(resolvedRoot)).isSymlink) return true;
  } else if (!fsAdapter && await isLocalSymlink(resolvedRoot)) {
    return true;
  }
  if (!rel) return false;

  let current = resolvedRoot;
  for (const segment of splitNonEmpty(rel, "/")) {
    if (fsAdapter) {
      if (fsAdapter.lstat) {
        if ((await fsAdapter.lstat(join(current, segment))).isSymlink) return true;
      } else if (
        await isAdapterSymlink(fsAdapter, current, segment, maxDirectoryEntries)
      ) {
        return true;
      }
    } else if (await isLocalSymlink(join(current, segment))) {
      return true;
    }
    current = join(current, segment);
  }
  return false;
}

function assertSafePathSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value.length > SKILL_PATH_SEGMENT_MAX_LENGTH ||
    value === "." ||
    value === ".." ||
    apply(regExpExec, SAFE_SKILL_PATH_SEGMENT_REGEX, [value]) === null
  ) {
    throw toError(
      createError({
        type: "agent",
        message: `Invalid skill ${label}`,
      }),
    );
  }
}

function assertSafeDirectoryEntryName(value: string): void {
  if (
    value.length === 0 ||
    value.length > SKILL_PATH_SEGMENT_MAX_LENGTH ||
    value === "." ||
    value === ".." ||
    (apply(stringIncludes, value, ["/"]) as boolean) ||
    (apply(stringIncludes, value, ["\\"]) as boolean) ||
    !isWellFormedUtf16(value) ||
    hasControlCharacters(value)
  ) {
    throw toError(
      createError({
        type: "agent",
        message: "Invalid skill directory entry name",
      }),
    );
  }
}

function requireBoundedPath(
  value: unknown,
  label: string,
  maxLength: number,
  requireAbsolute: boolean,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    !isWellFormedUtf16(value) ||
    hasControlCharacters(value)
  ) {
    throw new TypeError(
      `Skill ${label} must be a non-empty bounded path without control characters`,
    );
  }
  if (requireAbsolute && !isAbsolute(value)) {
    throw new TypeError(`Skill ${label} must be an absolute path`);
  }
  return value;
}

function requireBoundedSkillRoot(
  value: unknown,
  fsAdapter: FileSystemAdapter | undefined,
): string {
  const root = requireBoundedPath(
    value,
    "root",
    SKILL_ROOT_PATH_MAX_LENGTH,
    fsAdapter === undefined,
  );
  if (!fsAdapter || isAbsolute(root)) return root;
  if (!isCanonicalAdapterRelativeSkillRoot(root)) {
    throw new TypeError("Skill adapter-relative root must be a canonical relative path");
  }
  return root;
}

function normalizeAllowedSubdirs(
  value: unknown,
  maxEntries = SKILL_ALLOWED_SUBDIR_MAX_ENTRIES,
): string[] {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    throw new TypeError("Skill allowed subdirectories must be an array");
  }
  if (isProxyWithoutHooks(value)) {
    throw new TypeError("Skill allowed subdirectories must not be a proxy");
  }
  if (!arrayIsArray(value)) {
    throw new TypeError("Skill allowed subdirectories must be an array");
  }
  const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor && hasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value
    : undefined;
  if (!numberIsSafeInteger(length) || length < 0) {
    throw new TypeError("Skill allowed subdirectories length must be a data property");
  }
  if (length > maxEntries) {
    throw new RangeError(
      `Skill path validation accepts at most ${maxEntries} allowed subdirectories`,
    );
  }

  const subdirs: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const descriptor = getOwnPropertyDescriptor(value, index);
    if (!descriptor || !hasOwn(descriptor, "value") || typeof descriptor.value !== "string") {
      throw new TypeError(`Skill allowed subdirectory ${index} must be a data string`);
    }
    assertSafePathSegment(descriptor.value, "allowed subdirectory");
    if (!(apply(setHas, seen, [descriptor.value]) as boolean)) {
      apply(setAdd, seen, [descriptor.value]);
      appendOwnArrayElement(subdirs, descriptor.value);
    }
  }
  return subdirs;
}

/**
 * Apply the skill-specific allowlist contract after generic containment.
 *
 * Root files such as SKILL.md are always eligible. Only paths that descend
 * into a top-level directory are governed by `allowedSubdirs`. Passing an
 * empty array therefore means "root files only", not "deny the skill root"
 * and not the generic path validator's unrestricted `undefined` policy.
 */
function validateSkillLexicalPath(
  requestedPath: string,
  skillRoot: string,
  allowedSubdirs: readonly string[],
): ValidationResult {
  const result = validateLexicalPath(requestedPath, {
    baseDir: skillRoot,
    allowAbsolute: false,
  });
  if (!result.valid || !result.canonicalPath) return result;

  const relativePath = apply(
    stringReplaceAll,
    relative(resolve(skillRoot), resolve(result.canonicalPath)),
    ["\\", "/"],
  ) as string;
  const segments = splitNonEmpty(relativePath, "/");
  if (segments.length <= 1 || containsExactString(allowedSubdirs, segments[0]!)) {
    return result;
  }

  return {
    valid: false,
    error: allowedSubdirs.length === 0
      ? `Access to directory '${segments[0]}' not allowed: directory allowlist is empty`
      : `Access to directory '${segments[0]}' not allowed. Allowed: ${apply(
        arrayJoin,
        allowedSubdirs,
        [", "],
      ) as string}`,
    code: PathValidationError.NOT_IN_ALLOWLIST,
  };
}

async function assertRealPathContained(
  skillRoot: string,
  targetPath: string,
  displayPath: string,
  kind: "directory" | "path",
  fsAdapter?: FileSystemAdapter,
): Promise<void> {
  let realRoot: string;
  let realTarget: string;
  if (fsAdapter?.realPath) {
    [realRoot, realTarget] = await Promise.all([
      fsAdapter.realPath(skillRoot),
      fsAdapter.realPath(targetPath),
    ]);
  } else if (!fsAdapter) {
    [realRoot, realTarget] = await Promise.all([
      resolveLocalRealPath(skillRoot),
      resolveLocalRealPath(targetPath),
    ]);
  } else {
    return;
  }

  if (!isInsideDir(realRoot, realTarget)) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill ${kind} escapes root via symlink: "${displayPath}"`,
      }),
    );
  }
}

async function assertSafeSkillDirectory(
  skillRoot: string,
  dirPath: string,
  displayPath: string,
  fsAdapter?: FileSystemAdapter,
  maxDirectoryEntries = SKILL_SUBDIR_MAX_ENTRIES,
): Promise<void> {
  await assertIsDirectory(dirPath, fsAdapter);
  if (
    await hasSymlinkInPath(
      skillRoot,
      dirPath,
      fsAdapter,
      maxDirectoryEntries,
    )
  ) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill directory contains a symlink and is not allowed: "${displayPath}"`,
      }),
    );
  }

  await assertRealPathContained(
    skillRoot,
    dirPath,
    displayPath,
    "directory",
    fsAdapter,
  );
}

async function assertSafeSkillFile(
  skillRoot: string,
  filePath: string,
  displayPath: string,
  fsAdapter?: FileSystemAdapter,
  maxDirectoryEntries = SKILL_SUBDIR_MAX_ENTRIES,
): Promise<void> {
  await assertIsFile(filePath, fsAdapter);
  if (
    await hasSymlinkInPath(
      skillRoot,
      filePath,
      fsAdapter,
      maxDirectoryEntries,
    )
  ) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill path contains a symlink and is not allowed: "${displayPath}"`,
      }),
    );
  }
  await assertRealPathContained(
    skillRoot,
    filePath,
    displayPath,
    "path",
    fsAdapter,
  );
}

/**
 * Validate a requested path with the public compatibility resource policy.
 * Relative paths may contain up to 4096 characters and filesystem directory
 * enumeration is not entry-capped. {@link validateStrictSkillPath} applies
 * the runtime filesystem ceilings.
 *
 * @param skillRoot - Absolute local path, or an adapter-relative path when an fsAdapter is supplied
 * @param requestedPath - Relative path requested (e.g. "references/CLAUSES.md")
 * @param allowedSubdirs - Allowed top-level subdirectories (e.g. ["references", "assets"])
 * @param fsAdapter - Optional file system adapter for VFS/cloud-backed projects
 * @returns The validated canonical path
 * @throws If the path is invalid, escapes the skill root, or the file doesn't exist
 */
export async function validateSkillPath(
  skillRoot: string,
  requestedPath: string,
  allowedSubdirs: string[],
  fsAdapter?: FileSystemAdapter,
): Promise<string> {
  return await validateSkillPathWithLimits(
    skillRoot,
    requestedPath,
    allowedSubdirs,
    fsAdapter,
    SKILL_ROOT_PATH_MAX_LENGTH,
    Infinity,
    Infinity,
  );
}

/**
 * Validate a skill path with runtime filesystem resource ceilings.
 * Relative paths are limited to 1024 characters and each inspected directory
 * is limited to 1000 entries.
 */
export async function validateStrictSkillPath(
  skillRoot: string,
  requestedPath: string,
  allowedSubdirs: readonly string[],
  fsAdapter?: FileSystemAdapter,
  options: SkillPathOperationOptions = {},
): Promise<string> {
  assertStrictSymlinkCapabilities(fsAdapter);
  if (options.budget) {
    return await options.budget.run(() =>
      validateStrictSkillPath(
        skillRoot,
        requestedPath,
        allowedSubdirs,
        fsAdapter,
      )
    );
  }
  return await validateSkillPathWithLimits(
    skillRoot,
    requestedPath,
    allowedSubdirs,
    fsAdapter,
    SKILL_RELATIVE_PATH_MAX_LENGTH,
    SKILL_ALLOWED_SUBDIR_MAX_ENTRIES,
    SKILL_SUBDIR_MAX_ENTRIES,
  );
}

async function validateSkillPathWithLimits(
  skillRoot: string,
  requestedPath: string,
  allowedSubdirs: readonly string[],
  fsAdapter: FileSystemAdapter | undefined,
  relativePathMaxLength: number,
  allowedSubdirMaxEntries: number,
  directoryMaxEntries: number,
): Promise<string> {
  const boundedRoot = requireBoundedSkillRoot(skillRoot, fsAdapter);
  const boundedRequestedPath = requireBoundedPath(
    requestedPath,
    "relative path",
    relativePathMaxLength,
    false,
  );
  const normalizedAllowedSubdirs = normalizeAllowedSubdirs(
    allowedSubdirs,
    allowedSubdirMaxEntries,
  );

  const result = validateSkillLexicalPath(
    boundedRequestedPath,
    boundedRoot,
    normalizedAllowedSubdirs,
  );

  if (!result.valid) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill path validation failed for "${boundedRequestedPath}": ${
          result.error ?? "access denied"
        }`,
      }),
    );
  }

  if (!result.canonicalPath) {
    throw toError(
      createError({
        type: "agent",
        message:
          `Path validation succeeded but canonical path is undefined for: ${boundedRequestedPath}`,
      }),
    );
  }
  const canonicalPath = result.canonicalPath;

  // Verify the path exists and points to a file.
  if (!(await pathExists(canonicalPath, fsAdapter))) {
    throw toError(
      createError({
        type: "agent",
        message: `File not found: "${boundedRequestedPath}" in skill directory`,
      }),
    );
  }
  await assertSafeSkillFile(
    boundedRoot,
    canonicalPath,
    boundedRequestedPath,
    fsAdapter,
    directoryMaxEntries,
  );

  return canonicalPath;
}

/**
 * List files with the public compatibility resource policy.
 * Enumeration is not entry-capped and preserves the filesystem adapter's
 * iteration order. {@link listStrictSkillSubdir} applies the runtime
 * filesystem ceilings and deterministic ordering.
 *
 * @param skillRoot - Absolute local path, or an adapter-relative path when an fsAdapter is supplied
 * @param subdir - Subdirectory name (e.g. "references", "scripts")
 * @param fsAdapter - Optional file system adapter for VFS/cloud-backed projects
 * @returns Array of relative paths like "references/filename.md"
 */
export async function listSkillSubdir(
  skillRoot: string,
  subdir: string,
  fsAdapter?: FileSystemAdapter,
): Promise<string[]> {
  return await listSkillSubdirWithLimits(
    skillRoot,
    subdir,
    fsAdapter,
    Infinity,
    false,
  );
}

/**
 * List at most 1000 skill directory entries in deterministic filename order.
 */
export async function listStrictSkillSubdir(
  skillRoot: string,
  subdir: string,
  fsAdapter?: FileSystemAdapter,
  options: SkillPathOperationOptions = {},
): Promise<string[]> {
  assertStrictSymlinkCapabilities(fsAdapter);
  if (options.budget) {
    return await options.budget.run(() => listStrictSkillSubdir(skillRoot, subdir, fsAdapter));
  }
  return await listSkillSubdirWithLimits(
    skillRoot,
    subdir,
    fsAdapter,
    SKILL_SUBDIR_MAX_ENTRIES,
    true,
  );
}

/**
 * Recursively list a strict skill subdirectory in deterministic path order.
 *
 * The shared 1000-entry ceiling covers files and directories across the whole
 * tree, not each directory independently. Every traversed directory and file
 * is revalidated for type, root containment, and no-symlink semantics.
 */
export async function listStrictSkillTree(
  skillRoot: string,
  subdir: string,
  fsAdapter?: FileSystemAdapter,
  options: SkillPathOperationOptions = {},
): Promise<string[]> {
  assertStrictSymlinkCapabilities(fsAdapter);
  if (options.budget) {
    return await options.budget.run(() => listStrictSkillTree(skillRoot, subdir, fsAdapter));
  }
  return await listStrictSkillTreeWithLimits(
    skillRoot,
    subdir,
    fsAdapter,
    SKILL_SUBDIR_MAX_ENTRIES,
  );
}

async function listStrictSkillTreeWithLimits(
  skillRoot: string,
  subdir: string,
  fsAdapter: FileSystemAdapter | undefined,
  maxTreeEntries: number,
): Promise<string[]> {
  const boundedRoot = requireBoundedSkillRoot(skillRoot, fsAdapter);
  assertSafePathSegment(subdir, "subdirectory");
  const rootDirPath = join(boundedRoot, subdir);

  let rootExists: boolean;
  try {
    rootExists = fsAdapter ? await fsAdapter.exists(rootDirPath) : await exists(rootDirPath);
  } catch (error) {
    if (isFileNotFoundError(error)) return [];
    throw error;
  }
  if (!rootExists) return [];

  const pendingDirectories: string[] = [];
  const files: string[] = [];
  appendOwnArrayElement(pendingDirectories, subdir);
  let pendingIndex = 0;
  let treeEntryCount = 0;

  while (pendingIndex < pendingDirectories.length) {
    const relativeDirectory = pendingDirectories[pendingIndex++]!;
    const directoryPath = join(boundedRoot, relativeDirectory);
    await assertSafeSkillDirectory(
      boundedRoot,
      directoryPath,
      relativeDirectory,
      fsAdapter,
      maxTreeEntries,
    );

    const names = new Set<string>();
    const entries = fsAdapter ? fsAdapter.readDir(directoryPath) : readDir(directoryPath);
    for await (const rawEntry of entries) {
      treeEntryCount += 1;
      if (treeEntryCount > maxTreeEntries) {
        throw new RangeError(
          `Skill subdirectory tree may contain at most ${maxTreeEntries} entries`,
        );
      }
      const entry = captureDirectoryEntry(rawEntry);
      assertSafeDirectoryEntryName(entry.name);
      if (apply(setHas, names, [entry.name]) as boolean) {
        throw new TypeError("Skill subdirectory contains a duplicate entry name");
      }
      apply(setAdd, names, [entry.name]);
      const relativePath = `${relativeDirectory}/${entry.name}`;
      if (relativePath.length > SKILL_RELATIVE_PATH_MAX_LENGTH) {
        throw new RangeError(
          `Skill relative paths may contain at most ${SKILL_RELATIVE_PATH_MAX_LENGTH} characters`,
        );
      }
      if (entry.isSymlink) {
        throw toError(
          createError({
            type: "agent",
            message: `Skill directory entry is a symlink and is not allowed: "${relativePath}"`,
          }),
        );
      }
      if (entry.isFile === entry.isDirectory) {
        throw new TypeError("Skill directory entry must identify exactly one file or directory");
      }

      const canonicalPath = join(boundedRoot, relativePath);
      if (entry.isDirectory) {
        appendOwnArrayElement(pendingDirectories, relativePath);
        continue;
      }
      await assertSafeSkillFile(
        boundedRoot,
        canonicalPath,
        relativePath,
        fsAdapter,
        maxTreeEntries,
      );
      appendOwnArrayElement(files, relativePath);
    }
  }

  return apply(arraySort, files, [
    (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0,
  ]) as string[];
}

async function listSkillSubdirWithLimits(
  skillRoot: string,
  subdir: string,
  fsAdapter: FileSystemAdapter | undefined,
  maxDirectoryEntries: number,
  sortDeterministically: boolean,
): Promise<string[]> {
  const boundedRoot = requireBoundedSkillRoot(skillRoot, fsAdapter);
  assertSafePathSegment(subdir, "subdirectory");
  const dirPath = join(boundedRoot, subdir);

  let dirExists: boolean;
  try {
    dirExists = fsAdapter ? await fsAdapter.exists(dirPath) : await exists(dirPath);
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  if (!dirExists) {
    return [];
  }

  await assertSafeSkillDirectory(
    boundedRoot,
    dirPath,
    subdir,
    fsAdapter,
    maxDirectoryEntries,
  );

  const files: string[] = [];
  const names = new Set<string>();
  const entries = fsAdapter ? fsAdapter.readDir(dirPath) : readDir(dirPath);
  let entryCount = 0;

  for await (const rawEntry of entries) {
    entryCount += 1;
    if (entryCount > maxDirectoryEntries) {
      throw new RangeError(
        `Skill subdirectory may contain at most ${maxDirectoryEntries} entries`,
      );
    }
    const entry = captureDirectoryEntry(rawEntry);
    assertSafeDirectoryEntryName(entry.name);
    if (apply(setHas, names, [entry.name]) as boolean) {
      throw new TypeError("Skill subdirectory contains a duplicate entry name");
    }
    apply(setAdd, names, [entry.name]);
    if (entry.isSymlink) {
      throw toError(
        createError({
          type: "agent",
          message:
            `Skill directory entry is a symlink and is not allowed: "${subdir}/${entry.name}"`,
        }),
      );
    }
    if (entry.isFile) {
      appendOwnArrayElement(files, `${subdir}/${entry.name}`);
    }
  }

  if (!sortDeterministically) return files;
  return apply(arraySort, files, [
    (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0,
  ]) as string[];
}
