
import {
  FORBIDDEN_PATH_PATTERNS,
  MAX_PATH_LENGTH,
  MAX_PATH_TRAVERSAL_DEPTH,
} from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";

export type ValidationLevel = "strict" | "normal" | "permissive";

export interface ValidationResult {
  valid: boolean;
  canonicalPath?: string;
  error?: string;
  code?: string;
}

export interface ValidationOptions {
  level?: ValidationLevel;

  baseDir: string;

  allowedDirs?: string[];

  followSymlinks?: boolean;

  checkExists?: boolean;

  adapter?: RuntimeAdapter;

  allowAbsolute?: boolean;
}

export const PathValidationError = {
  NULL_BYTE: "NULL_BYTE",
  PATH_TOO_LONG: "PATH_TOO_LONG",
  EXCESSIVE_TRAVERSAL: "EXCESSIVE_TRAVERSAL",
  FORBIDDEN_PATTERN: "FORBIDDEN_PATTERN",
  OUTSIDE_BASE: "OUTSIDE_BASE",
  NOT_IN_ALLOWLIST: "NOT_IN_ALLOWLIST",
  FILE_NOT_FOUND: "FILE_NOT_FOUND",
  SYMLINK_DETECTED: "SYMLINK_DETECTED",
  INVALID_PATH: "INVALID_PATH",
  ABSOLUTE_PATH_DENIED: "ABSOLUTE_PATH_DENIED",
} as const;

function normalizeSeparators(path: string): string {
  return path.replace(/\\+/g, "/");
}

function isAbsolutePath(path: string): boolean {
  if (path.startsWith("/")) return true;

  if (/^[A-Za-z]:[\/\\]/.test(path)) return true;

  if (/^\\\\[^\\]+\\[^\\]+/.test(path)) return true;

  return false;
}

function resolvePathSegments(path: string): string {
  const normalized = normalizeSeparators(path);
  const parts = normalized.split("/").filter((p) => p.length > 0);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === ".") {
      continue;
    } else if (part === "..") {
      if (resolved.length > 0) {
        resolved.pop();
      }
    } else {
      resolved.push(part);
    }
  }

  const isAbs = normalized.startsWith("/");
  return isAbs ? `/${resolved.join("/")}` : resolved.join("/");
}

function joinPaths(base: string, relative: string): string {
  const normalizedBase = normalizeSeparators(base).replace(/\/$/, "");
  const normalizedRelative = normalizeSeparators(relative).replace(/^\
  return `${normalizedBase}/${normalizedRelative}`;
}

function isWithinDirectory(baseDir: string, targetPath: string): boolean {
  const normalizedBase = normalizeSeparators(baseDir).replace(/\/$/, "");
  const normalizedTarget = normalizeSeparators(targetPath).replace(/\/$/, "");

  return normalizedTarget === normalizedBase ||
    normalizedTarget.startsWith(`${normalizedBase}/`);
}

function validatePathBasics(path: string): ValidationResult {
  // deno-lint-ignore no-control-regex
  if (path.includes("\0") || /\x00/.test(path)) {
    return {
      valid: false,
      error: "Path contains null bytes",
      code: PathValidationError.NULL_BYTE,
    };
  }

  if (path.length > MAX_PATH_LENGTH) {
    return {
      valid: false,
      error: `Path exceeds maximum length of ${MAX_PATH_LENGTH}`,
      code: PathValidationError.PATH_TOO_LONG,
    };
  }

  for (const pattern of FORBIDDEN_PATH_PATTERNS) {
    if (pattern.test(path)) {
      return {
        valid: false,
        error: `Path contains forbidden pattern: ${pattern}`,
        code: PathValidationError.FORBIDDEN_PATTERN,
      };
    }
  }

  const parts = normalizeSeparators(path).split("/");
  let depth = 0;
  let maxDepth = 0;

  for (const part of parts) {
    if (part === "..") {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
    } else if (part !== "." && part !== "") {
      depth = 0;
    }
  }

  if (maxDepth > MAX_PATH_TRAVERSAL_DEPTH) {
    return {
      valid: false,
      error: `Path has excessive traversal depth (${maxDepth} > ${MAX_PATH_TRAVERSAL_DEPTH})`,
      code: PathValidationError.EXCESSIVE_TRAVERSAL,
    };
  }

  return { valid: true };
}

async function getCanonicalPath(
  path: string,
  adapter?: RuntimeAdapter,
  followSymlinks = false,
): Promise<{ path: string; isSymlink: boolean }> {
  if (!adapter || !followSymlinks) {
    return {
      path: resolvePathSegments(path),
      isSymlink: false,
    };
  }

  try {
    const stat = await adapter.fs.stat(path);

    if (stat.isSymlink) {
      return {
        path: resolvePathSegments(path),
        isSymlink: true,
      };
    }

    return {
      path: resolvePathSegments(path),
      isSymlink: false,
    };
  } catch {
    return {
      path: resolvePathSegments(path),
      isSymlink: false,
    };
  }
}

function validateAllowedDirs(
  canonicalPath: string,
  baseDir: string,
  allowedDirs: string[],
): ValidationResult {
  const normalizedBase = normalizeSeparators(baseDir).replace(/\/$/, "");
  const normalizedPath = normalizeSeparators(canonicalPath).replace(/\/$/, "");

  if (!isWithinDirectory(normalizedBase, normalizedPath)) {
    return {
      valid: false,
      error: `Path is outside base directory: ${baseDir}`,
      code: PathValidationError.OUTSIDE_BASE,
    };
  }

  if (!allowedDirs || allowedDirs.length === 0) {
    return { valid: true, canonicalPath };
  }

  const relativePath = normalizedPath === normalizedBase
    ? ""
    : normalizedPath.slice(normalizedBase.length + 1);

  if (!relativePath) {
    return { valid: true, canonicalPath };
  }

  const topLevelDir = relativePath.split("/")[0] ?? "";

  if (!topLevelDir || !allowedDirs.includes(topLevelDir)) {
    return {
      valid: false,
      error: `Access to directory '${topLevelDir}' not allowed. Allowed: ${allowedDirs.join(", ")}`,
      code: PathValidationError.NOT_IN_ALLOWLIST,
    };
  }

  return { valid: true, canonicalPath };
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
  if (!basicResult.valid) {
    return basicResult;
  }

  const normalized = normalizeSeparators(path);

  let targetPath: string;
  if (isAbsolutePath(normalized)) {
    if (!allowAbsolute && level === "strict") {
      return {
        valid: false,
        error: "Absolute paths not allowed in strict mode",
        code: PathValidationError.ABSOLUTE_PATH_DENIED,
      };
    }
    targetPath = normalized;
  } else {
    targetPath = joinPaths(baseDir, normalized);
  }

  const { path: canonicalPath, isSymlink } = await getCanonicalPath(
    targetPath,
    adapter,
    followSymlinks,
  );

  if (isSymlink && level === "strict") {
    return {
      valid: false,
      error: "Symlinks not allowed in strict mode",
      code: PathValidationError.SYMLINK_DETECTED,
    };
  }

  const allowResult = validateAllowedDirs(canonicalPath, baseDir, allowedDirs);
  if (!allowResult.valid) {
    return allowResult;
  }

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

  return {
    valid: true,
    canonicalPath,
  };
}

export function validatePathSync(
  path: string,
  options: ValidationOptions,
): ValidationResult {
  const {
    level = "normal",
    baseDir,
    allowedDirs = [],
    allowAbsolute = false,
  } = options;

  const basicResult = validatePathBasics(path);
  if (!basicResult.valid) {
    return basicResult;
  }

  const normalized = normalizeSeparators(path);

  let targetPath: string;
  if (isAbsolutePath(normalized)) {
    if (!allowAbsolute && level === "strict") {
      return {
        valid: false,
        error: "Absolute paths not allowed in strict mode",
        code: PathValidationError.ABSOLUTE_PATH_DENIED,
      };
    }
    targetPath = normalized;
  } else {
    targetPath = joinPaths(baseDir, normalized);
  }

  const canonicalPath = resolvePathSegments(targetPath);

  return validateAllowedDirs(canonicalPath, baseDir, allowedDirs);
}

export function createValidator(defaultOptions: ValidationOptions) {
  return (path: string, overrides?: Partial<ValidationOptions>): Promise<ValidationResult> => {
    return validatePath(path, { ...defaultOptions, ...overrides });
  };
}

export const ValidationPresets = {
  userInput: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "strict",
    allowedDirs: ["app", "pages", "public", "components", "lib"],
    followSymlinks: false,
    checkExists: true,
    allowAbsolute: false,
  }),

  internal: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "normal",
    followSymlinks: false,
    checkExists: false,
    allowAbsolute: false,
  }),

  build: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "permissive",
    followSymlinks: true,
    checkExists: false,
    allowAbsolute: true,
  }),

  static: (baseDir: string): ValidationOptions => ({
    baseDir,
    level: "normal",
    allowedDirs: ["dist", "public"],
    followSymlinks: false,
    checkExists: true,
    allowAbsolute: false,
  }),
};

export function sanitizePathForDisplay(path: string, baseDir: string): string {
  const normalized = normalizeSeparators(path);
  const normalizedBase = normalizeSeparators(baseDir);

  if (normalized.startsWith(normalizedBase)) {
    return normalized.slice(normalizedBase.length).replace(/^\
  }

  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}
