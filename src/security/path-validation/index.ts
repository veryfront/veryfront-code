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
  type LexicalPathValidationOptions,
  PathValidationError,
  type PathValidationPolicyOptions,
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

export {
  getCanonicalBaseDir,
  getCanonicalPath,
  pathTraversesSymlink,
  validateAllowedDirs,
} from "./canonical.ts";

export { ValidationPresets } from "./presets.ts";

import {
  getCanonicalBaseDir,
  getCanonicalPath,
  pathTraversesSymlink,
  validateAllowedDirs,
} from "./canonical.ts";
import {
  isAbsolutePath,
  isWithinDirectory,
  joinPaths,
  normalizeSeparators,
  resolvePathSegments,
} from "./normalization.ts";
import { validatePathBasics } from "./rules.ts";
import {
  type LexicalPathValidationOptions,
  PathValidationError,
  type PathValidationPolicyOptions,
  type ValidationOptions,
  type ValidationResult,
} from "./types.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";

const VALIDATION_OPTION_KEYS = new Set([
  "level",
  "baseDir",
  "allowedDirs",
  "followSymlinks",
  "checkExists",
  "adapter",
  "allowAbsolute",
]);
const LEXICAL_OPTION_KEYS = new Set([
  "baseDir",
  "allowedDirs",
  "allowAbsolute",
]);
const MAX_ALLOWED_DIRECTORY_ENTRIES = 1_024;

interface NormalizedValidationOptions {
  level: "strict" | "normal";
  baseDir: string;
  allowedDirs: string[] | undefined;
  followSymlinks: boolean;
  checkExists: boolean;
  adapter?: ValidationOptions["adapter"];
  allowAbsolute: boolean;
}

type NormalizedPhysicalValidationOptions =
  & Omit<NormalizedValidationOptions, "adapter">
  & { readonly adapter: NonNullable<ValidationOptions["adapter"]> };

interface NormalizedLexicalOptions {
  baseDir: string;
  allowedDirs: string[] | undefined;
  allowAbsolute: boolean;
}

function invalidOptionsResult(): ValidationResult {
  return {
    valid: false,
    error: "Invalid path validation options",
    code: PathValidationError.INVALID_PATH,
  };
}

function snapshotOptionValues(
  input: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> | null {
  if (typeof input !== "object" || input === null) return null;

  try {
    if (Array.isArray(input)) return null;
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) return null;

    const values: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(input)) {
      if (typeof key !== "string" || !allowedKeys.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      values[key] = descriptor.value;
    }
    return values;
  } catch {
    return null;
  }
}

function snapshotAllowedDirs(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;

  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor && "value" in lengthDescriptor
      ? lengthDescriptor.value
      : undefined;
    if (
      typeof length !== "number" ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > MAX_ALLOWED_DIRECTORY_ENTRIES
    ) {
      return null;
    }

    const snapshot = new Array<string>(length);
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) return null;
      const directory = descriptor.value;
      if (
        typeof directory !== "string" ||
        directory.length === 0 ||
        directory === "." ||
        directory === ".." ||
        directory.includes("/") ||
        directory.includes("\\") ||
        !validatePathBasics(directory).valid
      ) {
        return null;
      }
      snapshot[index] = directory;
    }
    return Object.freeze(snapshot) as string[];
  } catch {
    return null;
  }
}

function isBooleanOrUndefined(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function hasValidationAdapter(
  options: NormalizedValidationOptions,
): options is NormalizedPhysicalValidationOptions {
  return typeof options.adapter === "object" && options.adapter !== null;
}

function snapshotValidationOptions(
  input: unknown,
  requireBaseDir: boolean,
  requireAdapter: boolean,
): NormalizedValidationOptions | null {
  const values = snapshotOptionValues(input, VALIDATION_OPTION_KEYS);
  if (!values) return null;

  const baseDir = values.baseDir;
  if (
    (requireBaseDir && typeof baseDir !== "string") ||
    (baseDir !== undefined && (typeof baseDir !== "string" || baseDir.length === 0))
  ) {
    return null;
  }

  const level = values.level;
  if (level !== undefined && level !== "normal" && level !== "strict") return null;

  const allowedDirs = snapshotAllowedDirs(values.allowedDirs);
  if (allowedDirs === null) return null;
  if (
    !isBooleanOrUndefined(values.followSymlinks) ||
    !isBooleanOrUndefined(values.checkExists) ||
    !isBooleanOrUndefined(values.allowAbsolute)
  ) {
    return null;
  }
  if (
    (requireAdapter && (typeof values.adapter !== "object" || values.adapter === null)) ||
    (values.adapter !== undefined &&
      (typeof values.adapter !== "object" || values.adapter === null))
  ) {
    return null;
  }

  return Object.freeze({
    level: level ?? "normal",
    baseDir: typeof baseDir === "string" ? baseDir : "",
    allowedDirs,
    followSymlinks: values.followSymlinks ?? false,
    checkExists: values.checkExists ?? false,
    adapter: values.adapter as ValidationOptions["adapter"],
    allowAbsolute: values.allowAbsolute ?? false,
  });
}

function snapshotLexicalOptions(input: unknown): NormalizedLexicalOptions | null {
  const values = snapshotOptionValues(input, LEXICAL_OPTION_KEYS);
  if (!values || typeof values.baseDir !== "string" || values.baseDir.length === 0) return null;
  const allowedDirs = snapshotAllowedDirs(values.allowedDirs);
  if (allowedDirs === null || !isBooleanOrUndefined(values.allowAbsolute)) return null;

  return Object.freeze({
    baseDir: values.baseDir,
    allowedDirs,
    allowAbsolute: values.allowAbsolute ?? false,
  });
}

function mergeValidationOptions(
  defaults: NormalizedValidationOptions,
  overrides: NormalizedValidationOptions,
  rawOverrides: unknown,
): NormalizedValidationOptions {
  const values = rawOverrides as Record<string, unknown>;
  const has = (key: string): boolean => Object.hasOwn(values, key) && values[key] !== undefined;
  return Object.freeze({
    level: has("level") ? overrides.level : defaults.level,
    baseDir: has("baseDir") ? overrides.baseDir : defaults.baseDir,
    allowedDirs: has("allowedDirs") ? overrides.allowedDirs : defaults.allowedDirs,
    followSymlinks: has("followSymlinks") ? overrides.followSymlinks : defaults.followSymlinks,
    checkExists: has("checkExists") ? overrides.checkExists : defaults.checkExists,
    adapter: has("adapter") ? overrides.adapter : defaults.adapter,
    allowAbsolute: has("allowAbsolute") ? overrides.allowAbsolute : defaults.allowAbsolute,
  });
}

function invalidSymlinkCapability(error: string): ValidationResult {
  return {
    valid: false,
    error,
    code: PathValidationError.SYMLINK_CAPABILITY_REQUIRED,
  };
}

function validateSymlinkCapabilities(
  adapter: ValidationOptions["adapter"],
  level: ValidationOptions["level"],
  followSymlinks: boolean,
): ValidationResult | null {
  try {
    const fs = adapter.fs;
    const semantics = Object.getOwnPropertyDescriptor(fs, "symlinkSemantics");
    if (semantics && "value" in semantics && semantics.value === "none") return null;

    if (level === "strict" || !followSymlinks) {
      return typeof fs.lstat === "function" ? null : invalidSymlinkCapability(
        "Filesystem adapter must provide lstat for a no-symlink path policy",
      );
    }

    return typeof fs.realPath === "function" ? null : invalidSymlinkCapability(
      "Filesystem adapter must provide realPath before symlinks can be followed safely",
    );
  } catch {
    return invalidSymlinkCapability(
      "Filesystem adapter symlink capabilities could not be inspected safely",
    );
  }
}

function getTargetPath(
  inputPath: string,
  baseDir: string,
  allowAbsolute: boolean,
): ValidationResult | { targetPath: string } {
  const normalized = normalizeSeparators(inputPath);

  if (!isAbsolutePath(normalized)) {
    return { targetPath: joinPaths(baseDir, normalized) };
  }

  if (!allowAbsolute) {
    return {
      valid: false,
      error: "Absolute paths are not allowed by this path policy",
      code: PathValidationError.ABSOLUTE_PATH_DENIED,
    };
  }

  return { targetPath: normalized };
}

/**
 * Admit a path against the physical semantics of a runtime filesystem.
 *
 * A runtime adapter is mandatory: callers that only need normalized lexical
 * containment must use `validateLexicalPath` instead. `ValidationPresets`
 * provide policy fields and must be combined with the target adapter before
 * being passed here.
 */
export async function validatePath(
  path: string,
  options: ValidationOptions,
): Promise<ValidationResult> {
  if (typeof path !== "string") return invalidOptionsResult();
  const normalizedOptions = snapshotValidationOptions(options, true, true);
  if (!normalizedOptions || !hasValidationAdapter(normalizedOptions)) {
    return invalidOptionsResult();
  }
  const {
    level,
    baseDir,
    allowedDirs,
    followSymlinks,
    checkExists,
    adapter,
    allowAbsolute,
  } = normalizedOptions;

  const basicResult = validatePathBasics(path);
  if (!basicResult.valid) return basicResult;

  const targetResult = getTargetPath(path, baseDir, allowAbsolute);
  if ("valid" in targetResult) return targetResult;

  const capabilityResult = validateSymlinkCapabilities(adapter, level, followSymlinks);
  if (capabilityResult) return capabilityResult;

  const { path: canonicalPath, isSymlink } = await getCanonicalPath(
    targetResult.targetPath,
    adapter,
  );

  // Compare the physically-resolved candidate against a physically-resolved base
  // so a symlink escape is caught while a symlinked base prefix does not cause a
  // false OUTSIDE_BASE rejection.
  const canonicalBaseDir = await getCanonicalBaseDir(baseDir, adapter);
  const allowResult = validateAllowedDirs(canonicalPath, canonicalBaseDir, allowedDirs);
  if (!allowResult.valid) return allowResult;

  const traversesSymlink = isSymlink ||
    await pathTraversesSymlink(targetResult.targetPath, baseDir, adapter);
  if (traversesSymlink && (level === "strict" || !followSymlinks)) {
    return {
      valid: false,
      error: "Symlinks are not allowed by this path policy",
      code: PathValidationError.SYMLINK_DETECTED,
    };
  }

  if (checkExists) {
    try {
      await adapter.fs.stat(canonicalPath);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      return {
        valid: false,
        error: "Path does not exist",
        code: PathValidationError.FILE_NOT_FOUND,
      };
    }
  }

  return { valid: true, canonicalPath };
}

/**
 * Validate lexical path containment without consulting a filesystem.
 *
 * This is suitable only when the backing store cannot resolve symbolic links,
 * or when the caller performs its own descriptor-relative filesystem checks.
 * Use `validatePath()` for filesystem admission.
 */
export function validateLexicalPath(
  path: string,
  options: LexicalPathValidationOptions,
): ValidationResult {
  if (typeof path !== "string") return invalidOptionsResult();
  const normalizedOptions = snapshotLexicalOptions(options);
  if (!normalizedOptions) return invalidOptionsResult();
  const { baseDir, allowedDirs, allowAbsolute } = normalizedOptions;

  const basicResult = validatePathBasics(path);
  if (!basicResult.valid) return basicResult;

  const targetResult = getTargetPath(path, baseDir, allowAbsolute);
  if ("valid" in targetResult) return targetResult;

  const canonicalPath = resolvePathSegments(targetResult.targetPath);
  return validateAllowedDirs(canonicalPath, baseDir, allowedDirs);
}

/**
 * Validate lexical path containment without consulting a filesystem.
 *
 * The legacy physical-policy fields are accepted for source compatibility but
 * do not weaken lexical containment. Filesystem admission must use
 * `validatePath()` with the target runtime adapter.
 *
 * @deprecated Use `validateLexicalPath()` and pass only lexical policy fields.
 */
export function validatePathSync(
  path: string,
  options: PathValidationPolicyOptions & { adapter?: ValidationOptions["adapter"] },
): ValidationResult {
  if (typeof path !== "string") return invalidOptionsResult();
  const normalizedOptions = snapshotValidationOptions(options, true, false);
  if (!normalizedOptions) return invalidOptionsResult();

  return validateLexicalPath(path, {
    baseDir: normalizedOptions.baseDir,
    allowedDirs: normalizedOptions.allowedDirs,
    allowAbsolute: normalizedOptions.allowAbsolute,
  });
}

export function createValidator(
  defaultOptions: ValidationOptions,
): (path: string, overrides?: Partial<ValidationOptions>) => Promise<ValidationResult> {
  const defaults = snapshotValidationOptions(defaultOptions, true, true);
  return (path: string, overrides?: Partial<ValidationOptions>): Promise<ValidationResult> => {
    if (!defaults || !hasValidationAdapter(defaults)) {
      return Promise.resolve(invalidOptionsResult());
    }
    if (overrides === undefined) return validatePath(path, defaults);

    const overrideValues = snapshotOptionValues(overrides, VALIDATION_OPTION_KEYS);
    const normalizedOverrides = overrideValues
      ? snapshotValidationOptions(overrideValues, false, false)
      : null;
    if (!normalizedOverrides) return Promise.resolve(invalidOptionsResult());
    const merged = mergeValidationOptions(defaults, normalizedOverrides, overrideValues);
    return hasValidationAdapter(merged)
      ? validatePath(path, merged)
      : Promise.resolve(invalidOptionsResult());
  };
}

export function sanitizePathForDisplay(path: string, baseDir: string): string {
  const normalized = resolvePathSegments(normalizeSeparators(path));
  const normalizedBase = resolvePathSegments(normalizeSeparators(baseDir));

  if (isWithinDirectory(normalizedBase, normalized)) {
    if (normalized === normalizedBase) return "";
    return normalized.slice(normalizedBase === "/" ? 1 : normalizedBase.length + 1);
  }

  return normalized.split("/").at(-1) ?? normalized;
}
