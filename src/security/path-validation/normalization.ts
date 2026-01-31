/**
 * Path Normalization Utilities
 * @module security/path-validation/normalization
 */

/**
 * Normalize path separators to forward slashes
 * Handles Windows backslashes and mixed separators
 */
export function normalizeSeparators(path: string): string {
  return path.replace(/\\+/g, "/");
}

/**
 * Check if path is absolute
 * Supports Unix (/path) and Windows (C:\path, \\UNC\path)
 */
export function isAbsolutePath(path: string): boolean {
  if (path.startsWith("/")) return true;
  if (/^[A-Za-z]:[\/\\]/.test(path)) return true;
  return /^\\\\[^\\]+\\[^\\]+/.test(path);
}

/**
 * Resolve .. and . in path without filesystem access
 * This is a pure string operation for initial validation
 */
export function resolvePathSegments(path: string): string {
  const normalized = normalizeSeparators(path);
  const parts = normalized.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === ".") continue;

    if (part === "..") {
      resolved.pop();
      continue;
    }

    resolved.push(part);
  }

  // Preserve leading slash for absolute paths
  return normalized.startsWith("/") ? `/${resolved.join("/")}` : resolved.join("/");
}

/**
 * Join two paths safely
 */
export function joinPaths(base: string, relative: string): string {
  const normalizedBase = normalizeSeparators(base).replace(/\/$/, "");
  const normalizedRelative = normalizeSeparators(relative).replace(/^\//, "");
  return `${normalizedBase}/${normalizedRelative}`;
}

/**
 * Check if target path is within base directory
 * Compares normalized paths (string comparison)
 */
export function isWithinDirectory(baseDir: string, targetPath: string): boolean {
  const normalizedBase = normalizeSeparators(baseDir).replace(/\/$/, "");
  const normalizedTarget = normalizeSeparators(targetPath).replace(/\/$/, "");

  return normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}/`);
}
