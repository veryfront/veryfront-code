/**
 * Path Traversal Protection
 *
 * Centralized path validation to prevent directory traversal attacks.
 * Implements OWASP security guidelines and defense-in-depth principles.
 *
 * Features:
 * - Canonical path resolution (resolves .., symlinks)
 * - Whitelist-based validation
 * - Null byte and special character detection
 * - Cross-platform support (Windows, Unix)
 * - Multiple security levels
 *
 * @module security/path-validation
 */

export {
  PathValidationError,
  type ValidationLevel,
  type ValidationOptions,
  type ValidationResult,
} from "./types.ts";

export {
  isAbsolutePath,
  isWithinDirectory,
  joinPaths,
  normalizeSeparators,
  resolvePathSegments,
} from "./normalization.ts";

export { validatePathBasics } from "./rules.ts";

export { getCanonicalPath, validateAllowedDirs } from "./canonical.ts";

export { ValidationPresets } from "./presets.ts";

import { getCanonicalPath, validateAllowedDirs } from "./canonical.ts";
import {
  isAbsolutePath,
  joinPaths,
  normalizeSeparators,
  resolvePathSegments,
} from "./normalization.ts";
import { validatePathBasics } from "./rules.ts";
import { PathValidationError, type ValidationOptions, type ValidationResult } from "./types.ts";

function getTargetPath(
  inputPath: string,
  baseDir: string,
  level: ValidationOptions["level"] | undefined,
  allowAbsolute: boolean,
): ValidationResult | { targetPath: string } {
  const normalized = normalizeSeparators(inputPath);

  if (!isAbsolutePath(normalized)) {
    return { targetPath: joinPaths(baseDir, normalized) };
  }

  if (level === "strict" && !allowAbsolute) {
    return {
      valid: false,
      error: "Absolute paths not allowed in strict mode",
      code: PathValidationError.ABSOLUTE_PATH_DENIED,
    };
  }

  return { targetPath: normalized };
}

export async function validatePath(
  path: string,
  options: ValidationOptions,
): Promise<ValidationResult> {
  const {
    level = "normal",
    baseDir,
    allowedDirs = [],
    followSymlinks = false,
    checkExists = false,
    adapter,
    allowAbsolute = false,
  } = options;

  const basicResult = validatePathBasics(path);
  if (!basicResult.valid) return basicResult;

  const targetResult = getTargetPath(path, baseDir, level, allowAbsolute);
  if ("valid" in targetResult) return targetResult;

  const { path: canonicalPath, isSymlink } = await getCanonicalPath(
    targetResult.targetPath,
    adapter,
    followSymlinks,
  );

  if (level === "strict" && isSymlink) {
    return {
      valid: false,
      error: "Symlinks not allowed in strict mode",
      code: PathValidationError.SYMLINK_DETECTED,
    };
  }

  const allowResult = validateAllowedDirs(canonicalPath, baseDir, allowedDirs);
  if (!allowResult.valid) return allowResult;

  if (checkExists && adapter) {
    try {
      await adapter.fs.stat(canonicalPath);
    } catch {
      return {
        valid: false,
        error: `File not found: ${canonicalPath}`,
        code: PathValidationError.FILE_NOT_FOUND,
      };
    }
  }

  return { valid: true, canonicalPath };
}

export function validatePathSync(
  path: string,
  options: ValidationOptions,
): ValidationResult {
  const { level = "normal", baseDir, allowedDirs = [], allowAbsolute = false } = options;

  const basicResult = validatePathBasics(path);
  if (!basicResult.valid) return basicResult;

  const targetResult = getTargetPath(path, baseDir, level, allowAbsolute);
  if ("valid" in targetResult) return targetResult;

  const canonicalPath = resolvePathSegments(targetResult.targetPath);
  return validateAllowedDirs(canonicalPath, baseDir, allowedDirs);
}

export function createValidator(
  defaultOptions: ValidationOptions,
): (path: string, overrides?: Partial<ValidationOptions>) => Promise<ValidationResult> {
  return (path: string, overrides?: Partial<ValidationOptions>): Promise<ValidationResult> =>
    validatePath(path, { ...defaultOptions, ...overrides });
}

export function sanitizePathForDisplay(path: string, baseDir: string): string {
  const normalized = normalizeSeparators(path);
  const normalizedBase = normalizeSeparators(baseDir);

  if (normalized.startsWith(normalizedBase)) {
    return normalized.slice(normalizedBase.length).replace(/^\//, "");
  }

  return normalized.split("/").at(-1) ?? normalized;
}
