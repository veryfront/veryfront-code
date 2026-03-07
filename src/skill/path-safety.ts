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
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";

function isInsideDir(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
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
  } catch (_) {
    // expected: path may not exist or not be accessible
    return false;
  }
}

async function isAdapterSymlink(
  fsAdapter: FileSystemAdapter,
  parentDir: string,
  segment: string,
): Promise<boolean> {
  for await (const entry of fsAdapter.readDir(parentDir)) {
    if (entry.name !== segment) continue;
    return entry.isSymlink;
  }
  return false;
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

  let current = resolvedRoot;
  for (const segment of rel.split("/").filter(Boolean)) {
    if (fsAdapter) {
      if (await isAdapterSymlink(fsAdapter, current, segment)) return true;
    } else if (await isLocalSymlink(join(current, segment))) {
      return true;
    }
    current = join(current, segment);
  }
  return false;
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
  const result: ValidationResult = await validatePath(requestedPath, {
    baseDir: skillRoot,
    allowedDirs: allowedSubdirs,
    level: "strict",
    allowAbsolute: false,
  });

  if (!result.valid) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill path validation failed for "${requestedPath}": ${
          result.error ?? "access denied"
        }`,
      }),
    );
  }

  if (!result.canonicalPath) {
    throw toError(
      createError({
        type: "agent",
        message: `Path validation succeeded but canonical path is undefined for: ${requestedPath}`,
      }),
    );
  }
  const canonicalPath = result.canonicalPath;

  // Verify the path exists and points to a file.
  if (!(await pathExists(canonicalPath, fsAdapter))) {
    throw toError(
      createError({
        type: "agent",
        message: `File not found: "${requestedPath}" in skill directory`,
      }),
    );
  }
  await assertIsFile(canonicalPath, fsAdapter);

  // Enforce strict no-symlink policy for skill files.
  if (await hasSymlinkInPath(skillRoot, canonicalPath, fsAdapter)) {
    throw toError(
      createError({
        type: "agent",
        message: `Skill path contains a symlink and is not allowed: "${requestedPath}"`,
      }),
    );
  }

  // Defense-in-depth: local realpath check to block symlink escapes.
  if (!fsAdapter) {
    const [realRoot, realTarget] = await Promise.all([
      resolveLocalRealPath(skillRoot),
      resolveLocalRealPath(canonicalPath),
    ]);
    if (!isInsideDir(realRoot, realTarget)) {
      throw toError(
        createError({
          type: "agent",
          message: `Skill path escapes root directory via symlink: "${requestedPath}"`,
        }),
      );
    }
  }

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
  const dirPath = join(skillRoot, subdir);

  const dirExists = fsAdapter ? await fsAdapter.exists(dirPath) : await exists(dirPath);
  if (!dirExists) {
    return [];
  }

  const files: string[] = [];
  const entries = fsAdapter ? fsAdapter.readDir(dirPath) : readDir(dirPath);

  for await (const entry of entries) {
    if (entry.isFile) {
      files.push(`${subdir}/${entry.name}`);
    }
  }

  return files;
}
