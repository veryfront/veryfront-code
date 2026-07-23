/**
 * Skill path safety
 *
 * Validates file paths within skill directories to prevent traversal attacks.
 * Uses centralized validatePath() from #veryfront/security.
 *
 * @module
 */

import { validatePath, type ValidationResult } from "#veryfront/security";
import { isAbsolute, join, relative, resolve } from "#veryfront/compat/path";
import { exists, readDir, stat } from "#veryfront/platform/compat/fs.ts";
import { createError, fromError, toError, VeryfrontError } from "#veryfront/errors";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { SKILL_MD_FILENAME } from "./types.ts";

const MAX_ALLOWED_SUBDIRS = 16;
const MAX_DIRECTORY_ENTRIES_SCANNED = 10_000;
const MAX_FILES_PER_SUBDIR = 1_000;
const MAX_ENTRY_NAME_LENGTH = 255;
const MAX_SKILL_PATH_LENGTH = 4_096;
const MAX_SKILL_PATH_SEGMENTS = 64;
const MAX_SKILL_SUBDIR_DEPTH = 16;

type SafeDirectoryEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

const SAFE_PATH_POLICY_ERRORS = new WeakSet<object>();

function pathPolicyError(message: string): never {
  const error = toError(createError({ type: "agent", message }));
  SAFE_PATH_POLICY_ERRORS.add(error);
  throw error;
}

function isSafePathPolicyError(error: unknown): boolean {
  return typeof error === "object" && error !== null && SAFE_PATH_POLICY_ERRORS.has(error);
}

function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

function isBoundedPathText(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > MAX_SKILL_PATH_LENGTH) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0 || code === 10 || code === 13) return false;
  }
  return true;
}

function isSafeDirectorySegment(value: string): boolean {
  if (
    !value || value === "." || value === ".." || value.length > MAX_ENTRY_NAME_LENGTH ||
    value.includes("/") || value.includes("\\")
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return false;
  }
  return true;
}

function snapshotAllowedSubdirs(allowedSubdirs: readonly string[]): string[] {
  let isArray = false;
  let entryCount: number | undefined;
  try {
    isArray = Array.isArray(allowedSubdirs);
    if (isArray) {
      const lengthDescriptor = Reflect.getOwnPropertyDescriptor(allowedSubdirs, "length");
      const lengthValue = lengthDescriptor && "value" in lengthDescriptor
        ? lengthDescriptor.value
        : undefined;
      if (
        typeof lengthValue === "number" && Number.isSafeInteger(lengthValue) && lengthValue >= 0
      ) {
        entryCount = lengthValue;
      }
    }
  } catch {
    pathPolicyError("Skill path directory allowlist must be readable.");
  }
  if (
    !isArray || entryCount === undefined || entryCount === 0 || entryCount > MAX_ALLOWED_SUBDIRS
  ) {
    pathPolicyError("Skill path validation requires a bounded, non-empty directory allowlist.");
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(allowedSubdirs, String(index));
    } catch {
      pathPolicyError("Skill path directory allowlist must be readable.");
    }
    if (!descriptor) {
      pathPolicyError("Skill path directory allowlist must be dense.");
    }
    if (!("value" in descriptor)) {
      pathPolicyError("Skill path directory allowlist must contain data entries.");
    }
    const subdir = descriptor.value;
    if (typeof subdir !== "string" || !isSafeDirectorySegment(subdir)) {
      pathPolicyError("Skill path directory allowlist contains an invalid entry.");
    }
    if (!seen.has(subdir)) {
      seen.add(subdir);
      result.push(subdir);
    }
  }
  return result;
}

function readEntryProperty(
  entry: object,
  property: keyof SafeDirectoryEntry,
): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(entry, property);
  } catch {
    pathPolicyError("Skill directory returned an unreadable entry.");
  }
  if (!descriptor || !("value" in descriptor)) {
    pathPolicyError("Skill directory entries must contain data properties only.");
  }
  return descriptor.value;
}

function snapshotDirectoryEntry(entry: unknown): SafeDirectoryEntry {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    pathPolicyError("Skill directory returned an invalid entry.");
  }
  const name = readEntryProperty(entry, "name");
  const isFile = readEntryProperty(entry, "isFile");
  const isDirectory = readEntryProperty(entry, "isDirectory");
  const isSymlink = readEntryProperty(entry, "isSymlink");
  if (
    typeof name !== "string" || typeof isFile !== "boolean" ||
    typeof isDirectory !== "boolean" || typeof isSymlink !== "boolean" ||
    (Number(isFile) + Number(isDirectory) + Number(isSymlink) > 1)
  ) {
    pathPolicyError("Skill directory returned an invalid entry.");
  }
  return { name, isFile, isDirectory, isSymlink };
}

function isInsideDir(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
    pathPolicyError("Skill path must point to a file.");
  }
}

async function assertIsDirectory(path: string, fsAdapter?: FileSystemAdapter): Promise<void> {
  const info = fsAdapter ? await fsAdapter.stat(path) : await stat(path);
  if (!info.isDirectory) {
    pathPolicyError("Skill subdirectory must point to a directory.");
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
  try {
    if (typeof Deno !== "undefined") {
      const info = await Deno.lstat(path);
      return info.isSymlink;
    }
    const fs = await import("node:fs/promises");
    const info = await fs.lstat(path);
    return info.isSymbolicLink();
  } catch (error) {
    if (isFileNotFoundError(error)) return false;
    throw error;
  }
}

async function isAdapterSymlink(
  fsAdapter: FileSystemAdapter,
  parentDir: string,
  segment: string,
): Promise<boolean> {
  if (fsAdapter.lstat) {
    try {
      return (await fsAdapter.lstat(join(parentDir, segment))).isSymlink;
    } catch (error) {
      if (isFileNotFoundError(error)) return false;
      throw error;
    }
  }

  let scanned = 0;
  let matchedSymlink = false;
  const seenNames = new Set<string>();
  for await (const entry of fsAdapter.readDir(parentDir)) {
    scanned += 1;
    if (scanned > MAX_DIRECTORY_ENTRIES_SCANNED) {
      pathPolicyError("Skill directory entry scan limit exceeded.");
    }
    const snapshot = snapshotDirectoryEntry(entry);
    if (!isSafeDirectorySegment(snapshot.name)) {
      pathPolicyError("Skill directory contains an invalid entry name.");
    }
    if (seenNames.has(snapshot.name)) {
      pathPolicyError("Skill directory contains a duplicate entry.");
    }
    seenNames.add(snapshot.name);
    if (snapshot.name !== segment) continue;
    matchedSymlink = snapshot.isSymlink;
  }
  return matchedSymlink;
}

async function hasSymlinkInPath(
  skillRoot: string,
  canonicalPath: string,
  fsAdapter?: FileSystemAdapter,
): Promise<boolean> {
  const resolvedRoot = resolve(skillRoot);
  const resolvedTarget = resolve(canonicalPath);
  const rel = relative(resolvedRoot, resolvedTarget).replaceAll("\\", "/");

  if (!rel) return false;
  if (rel.startsWith("..") || isAbsolute(rel)) return true;

  const segments = rel.split("/").filter(Boolean);
  if (segments.length > MAX_SKILL_PATH_SEGMENTS) {
    pathPolicyError("Skill path contains too many segments.");
  }

  let current = resolvedRoot;
  for (const segment of segments) {
    if (fsAdapter) {
      if (await isAdapterSymlink(fsAdapter, current, segment)) return true;
    } else if (await isLocalSymlink(join(current, segment))) {
      return true;
    }
    current = join(current, segment);
  }
  return false;
}

async function assertSafeExistingSkillFile(
  skillRoot: string,
  canonicalPath: string,
  fsAdapter?: FileSystemAdapter,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!(await pathExists(canonicalPath, fsAdapter))) {
    pathPolicyError("Skill file was not found.");
  }
  await assertIsFile(canonicalPath, fsAdapter);
  throwIfAborted(signal);

  if (await hasSymlinkInPath(skillRoot, canonicalPath, fsAdapter)) {
    pathPolicyError("Skill path contains a symlink and is not allowed.");
  }

  if (fsAdapter?.realPath) {
    const [realRoot, realTarget] = await Promise.all([
      fsAdapter.realPath(skillRoot),
      fsAdapter.realPath(canonicalPath),
    ]);
    if (!isInsideDir(realRoot, realTarget)) {
      pathPolicyError("Skill path escapes its root directory via a symlink.");
    }
  } else if (!fsAdapter) {
    const [realRoot, realTarget] = await Promise.all([
      resolveLocalRealPath(skillRoot),
      resolveLocalRealPath(canonicalPath),
    ]);
    if (!isInsideDir(realRoot, realTarget)) {
      pathPolicyError("Skill path escapes its root directory via a symlink.");
    }
  }
  throwIfAborted(signal);
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
  allowedSubdirs: readonly string[],
  fsAdapter?: FileSystemAdapter,
  signal?: AbortSignal,
): Promise<string> {
  try {
    throwIfAborted(signal);
    if (!isBoundedPathText(skillRoot) || !isBoundedPathText(requestedPath)) {
      pathPolicyError("Skill path must be a bounded path string.");
    }
    const validatedSubdirs = snapshotAllowedSubdirs(allowedSubdirs);
    const result: ValidationResult = await validatePath(requestedPath, {
      baseDir: skillRoot,
      allowedDirs: validatedSubdirs,
      level: "strict",
      allowAbsolute: false,
    });

    if (!result.valid) {
      pathPolicyError(`Skill path validation failed: ${result.error ?? "access denied"}.`);
    }

    if (!result.canonicalPath) {
      pathPolicyError("Skill path validation did not produce a canonical path.");
    }
    const canonicalPath = result.canonicalPath;
    throwIfAborted(signal);

    await assertSafeExistingSkillFile(skillRoot, canonicalPath, fsAdapter, signal);
    return canonicalPath;
  } catch (error) {
    throwIfAborted(signal);
    if (isSafePathPolicyError(error)) throw error;
    pathPolicyError("Unable to inspect the requested skill path.");
  }
}

/** Validate the root SKILL.md again at activation time before it is read. */
export async function validateSkillDefinitionPath(
  skillRoot: string,
  fsAdapter?: FileSystemAdapter,
  signal?: AbortSignal,
): Promise<string> {
  try {
    throwIfAborted(signal);
    if (!isBoundedPathText(skillRoot)) {
      pathPolicyError("Skill root must be a bounded path string.");
    }
    const definitionPath = join(skillRoot, SKILL_MD_FILENAME);
    if (!isInsideDir(resolve(skillRoot), resolve(definitionPath))) {
      pathPolicyError("Skill definition path escapes its root directory.");
    }
    await assertSafeExistingSkillFile(skillRoot, definitionPath, fsAdapter, signal);
    return definitionPath;
  } catch (error) {
    throwIfAborted(signal);
    if (isSafePathPolicyError(error)) throw error;
    pathPolicyError("Unable to inspect the requested skill definition.");
  }
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
  signal?: AbortSignal,
): Promise<string[]> {
  try {
    if (!isBoundedPathText(skillRoot)) {
      pathPolicyError("Skill root must be a bounded path string.");
    }
    if (typeof subdir !== "string" || !isSafeDirectorySegment(subdir)) {
      pathPolicyError("Skill subdirectory must be a safe directory name.");
    }
    throwIfAborted(signal);
    const dirPath = join(skillRoot, subdir);

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

    await assertIsDirectory(dirPath, fsAdapter);
    if (await hasSymlinkInPath(skillRoot, dirPath, fsAdapter)) {
      pathPolicyError("Skill subdirectory contains a symlink and is not allowed.");
    }
    throwIfAborted(signal);

    const files: string[] = [];
    let scanned = 0;

    const walk = async (
      currentDir: string,
      relativeDir: string,
      depth: number,
    ): Promise<void> => {
      if (depth > MAX_SKILL_SUBDIR_DEPTH) {
        pathPolicyError("Skill subdirectory nesting limit exceeded.");
      }

      const entries = fsAdapter ? fsAdapter.readDir(currentDir) : readDir(currentDir);
      const snapshots: SafeDirectoryEntry[] = [];
      const seenNames = new Set<string>();
      for await (const rawEntry of entries) {
        scanned += 1;
        if (scanned > MAX_DIRECTORY_ENTRIES_SCANNED) {
          pathPolicyError("Skill directory entry scan limit exceeded.");
        }
        const entry = snapshotDirectoryEntry(rawEntry);
        if (!isSafeDirectorySegment(entry.name)) {
          pathPolicyError("Skill directory contains an invalid entry name.");
        }
        if (seenNames.has(entry.name)) {
          pathPolicyError("Skill directory contains a duplicate entry.");
        }
        seenNames.add(entry.name);
        snapshots.push(entry);
        throwIfAborted(signal);
      }

      snapshots.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of snapshots) {
        if (entry.isSymlink) {
          pathPolicyError("Skill directory contains a symlink and is not allowed.");
        }
        if (!entry.isFile && !entry.isDirectory) {
          pathPolicyError("Skill directory returned an invalid entry.");
        }

        const relativePath = `${relativeDir}/${entry.name}`;
        if (
          relativePath.length > MAX_SKILL_PATH_LENGTH ||
          relativePath.split("/").length > MAX_SKILL_PATH_SEGMENTS
        ) {
          pathPolicyError("Skill path contains too many segments.");
        }
        const childPath = join(currentDir, entry.name);

        if (entry.isFile) {
          if (files.length >= MAX_FILES_PER_SUBDIR) {
            pathPolicyError("Skill subdirectory file limit exceeded.");
          }
          files.push(relativePath);
          continue;
        }

        await assertIsDirectory(childPath, fsAdapter);
        if (await hasSymlinkInPath(skillRoot, childPath, fsAdapter)) {
          pathPolicyError("Skill subdirectory contains a symlink and is not allowed.");
        }
        throwIfAborted(signal);
        await walk(childPath, relativePath, depth + 1);
      }
    };

    await walk(dirPath, subdir, 0);

    return files.sort();
  } catch (error) {
    throwIfAborted(signal);
    if (isSafePathPolicyError(error)) throw error;
    pathPolicyError("Unable to inspect the requested skill directory.");
  }
}
