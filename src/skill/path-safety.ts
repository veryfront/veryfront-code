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
import { createError, fromError, toError, VeryfrontError } from "#veryfront/errors";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import {
  SKILL_ALLOWED_SUBDIR_MAX_ENTRIES,
  SKILL_PATH_SEGMENT_MAX_LENGTH,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_ROOT_PATH_MAX_LENGTH,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "./limits.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "./string-safety.ts";
import type { SkillOperationBudget } from "./operation-budget.ts";
const SAFE_SKILL_PATH_SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/;

export interface SkillPathOperationOptions {
  budget?: SkillOperationBudget;
}

function isInsideDir(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  return rel === "" ||
    (
      !isAbsolute(rel) &&
      rel !== ".." &&
      !rel.startsWith("../") &&
      !rel.startsWith("..\\")
    );
}

function isFileNotFoundError(error: unknown): boolean {
  if (error instanceof VeryfrontError && error.slug === "file-not-found") {
    return true;
  }

  const veryfrontError = fromError(error);
  return veryfrontError?.type === "file" && veryfrontError.message.startsWith("File not found:");
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
  for await (const entry of fsAdapter.readDir(parentDir)) {
    entryCount += 1;
    if (entryCount > maxEntries) {
      throw new RangeError(
        `Skill directory may contain at most ${maxEntries} entries`,
      );
    }
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
  const resolvedRoot = resolve(skillRoot);
  const resolvedTarget = resolve(canonicalPath);
  const rel = relative(resolvedRoot, resolvedTarget).replaceAll("\\", "/");

  if (!isInsideDir(resolvedRoot, resolvedTarget)) return true;

  if (fsAdapter?.lstat) {
    if ((await fsAdapter.lstat(resolvedRoot)).isSymlink) return true;
  } else if (!fsAdapter && await isLocalSymlink(resolvedRoot)) {
    return true;
  }
  if (!rel) return false;

  let current = resolvedRoot;
  for (const segment of rel.split("/").filter(Boolean)) {
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
    !SAFE_SKILL_PATH_SEGMENT_REGEX.test(value)
  ) {
    throw toError(
      createError({
        type: "agent",
        message: `Invalid skill ${label}: "${value}"`,
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
    value.includes("/") ||
    value.includes("\\") ||
    !isWellFormedUtf16(value) ||
    hasControlCharacters(value)
  ) {
    throw toError(
      createError({
        type: "agent",
        message: `Invalid skill directory entry name: "${value}"`,
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

function normalizeAllowedSubdirs(
  value: unknown,
  maxEntries = SKILL_ALLOWED_SUBDIR_MAX_ENTRIES,
): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Skill allowed subdirectories must be an array");
  }
  if (value.length > maxEntries) {
    throw new RangeError(
      `Skill path validation accepts at most ${maxEntries} allowed subdirectories`,
    );
  }

  const subdirs: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      throw new TypeError(`Skill allowed subdirectory ${index} must be a data string`);
    }
    assertSafePathSegment(descriptor.value, "allowed subdirectory");
    if (!seen.has(descriptor.value)) {
      seen.add(descriptor.value);
      subdirs.push(descriptor.value);
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

  const relativePath = relative(resolve(skillRoot), resolve(result.canonicalPath))
    .replaceAll("\\", "/");
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length <= 1 || allowedSubdirs.includes(segments[0]!)) {
    return result;
  }

  return {
    valid: false,
    error: allowedSubdirs.length === 0
      ? `Access to directory '${segments[0]}' not allowed: directory allowlist is empty`
      : `Access to directory '${segments[0]}' not allowed. Allowed: ${allowedSubdirs.join(", ")}`,
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

/**
 * Validate that a requested path is safe within a skill's root directory.
 *
 * @param skillRoot - Absolute path to the skill directory
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
  const boundedRoot = requireBoundedPath(
    skillRoot,
    "root",
    SKILL_ROOT_PATH_MAX_LENGTH,
    true,
  );
  const boundedRequestedPath = requireBoundedPath(
    requestedPath,
    "relative path",
    SKILL_ROOT_PATH_MAX_LENGTH,
    false,
  );
  const normalizedAllowedSubdirs = normalizeAllowedSubdirs(
    allowedSubdirs,
    Number.POSITIVE_INFINITY,
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

  if (!(await pathExists(canonicalPath, fsAdapter))) {
    throw toError(
      createError({
        type: "agent",
        message: `File not found: "${boundedRequestedPath}" in skill directory`,
      }),
    );
  }
  await assertIsFile(canonicalPath, fsAdapter);

  if (
    await hasSymlinkInPath(
      boundedRoot,
      canonicalPath,
      fsAdapter,
      Number.POSITIVE_INFINITY,
    )
  ) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill path contains a symlink and is not allowed: "${boundedRequestedPath}"`,
      }),
    );
  }

  await assertRealPathContained(
    boundedRoot,
    canonicalPath,
    boundedRequestedPath,
    "path",
    fsAdapter,
  );

  return canonicalPath;
}

/** Validate a skill path with runtime filesystem resource ceilings. */
export async function validateStrictSkillPath(
  skillRoot: string,
  requestedPath: string,
  allowedSubdirs: readonly string[],
  fsAdapter?: FileSystemAdapter,
  options: SkillPathOperationOptions = {},
): Promise<string> {
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
  const boundedRoot = requireBoundedPath(
    skillRoot,
    "root",
    SKILL_ROOT_PATH_MAX_LENGTH,
    true,
  );
  const boundedRequestedPath = requireBoundedPath(
    requestedPath,
    "relative path",
    SKILL_RELATIVE_PATH_MAX_LENGTH,
    false,
  );
  const normalizedAllowedSubdirs = normalizeAllowedSubdirs(allowedSubdirs);

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
  await assertIsFile(canonicalPath, fsAdapter);

  // Enforce strict no-symlink policy for skill files.
  if (await hasSymlinkInPath(boundedRoot, canonicalPath, fsAdapter)) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill path contains a symlink and is not allowed: "${boundedRequestedPath}"`,
      }),
    );
  }

  await assertRealPathContained(
    boundedRoot,
    canonicalPath,
    boundedRequestedPath,
    "path",
    fsAdapter,
  );

  return canonicalPath;
}

/**
 * List files in a skill subdirectory.
 *
 * @param skillRoot - Absolute path to the skill directory
 * @param subdir - Subdirectory name (e.g. "references", "scripts")
 * @param fsAdapter - Optional file system adapter for VFS/cloud-backed projects
 * @returns Array of relative paths like "references/filename.md"
 */
export async function listSkillSubdir(
  skillRoot: string,
  subdir: string,
  fsAdapter?: FileSystemAdapter,
): Promise<string[]> {
  const boundedRoot = requireBoundedPath(
    skillRoot,
    "root",
    SKILL_ROOT_PATH_MAX_LENGTH,
    true,
  );
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
    Number.POSITIVE_INFINITY,
  );

  const files: string[] = [];
  const entries = fsAdapter ? fsAdapter.readDir(dirPath) : readDir(dirPath);

  for await (const entry of entries) {
    assertSafeDirectoryEntryName(entry.name);
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
      files.push(`${subdir}/${entry.name}`);
    }
  }

  return files;
}

/** List skill files with runtime filesystem resource ceilings and deterministic order. */
export async function listStrictSkillSubdir(
  skillRoot: string,
  subdir: string,
  fsAdapter?: FileSystemAdapter,
  options: SkillPathOperationOptions = {},
): Promise<string[]> {
  if (options.budget) {
    return await options.budget.run(() => listStrictSkillSubdir(skillRoot, subdir, fsAdapter));
  }
  const boundedRoot = requireBoundedPath(
    skillRoot,
    "root",
    SKILL_ROOT_PATH_MAX_LENGTH,
    true,
  );
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

  await assertSafeSkillDirectory(boundedRoot, dirPath, subdir, fsAdapter);

  const files: string[] = [];
  const entries = fsAdapter ? fsAdapter.readDir(dirPath) : readDir(dirPath);
  let entryCount = 0;

  for await (const entry of entries) {
    entryCount += 1;
    if (entryCount > SKILL_SUBDIR_MAX_ENTRIES) {
      throw new RangeError(
        `Skill subdirectory may contain at most ${SKILL_SUBDIR_MAX_ENTRIES} entries`,
      );
    }
    assertSafeDirectoryEntryName(entry.name);
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
      files.push(`${subdir}/${entry.name}`);
    }
  }

  return files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}
