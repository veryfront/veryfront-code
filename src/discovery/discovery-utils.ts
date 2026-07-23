/**
 * Discovery Utilities
 *
 * Helper functions for ID generation, path manipulation, and agent tracking.
 */

/**
 * Convert a file path to a camelCase ID
 */
export function filenameToId(filePath: string): string {
  const filename = filePath.split(/[/\\]/).pop()?.replace(/\.(ts|tsx|js|jsx|mjs)$/, "") ?? "";
  return filename
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

/**
 * Convert a file path to a URL-style pattern for resources
 */
export function filePathToPattern(filePath: string, baseDir: string): string {
  const cleanPath = filePath.replace(/^file:\/\//, "").replaceAll("\\", "/");
  const cleanBase = baseDir.replace(/^file:\/\//, "").replaceAll("\\", "/")
    .replace(/\/+$/, "");
  const basePrefix = `${cleanBase}/`;
  if (cleanPath !== cleanBase && !cleanPath.startsWith(basePrefix)) {
    throw new TypeError("Resource discovery file is outside its discovery root");
  }

  let pattern = cleanPath.slice(cleanBase.length).replace(/\.(ts|tsx|js|jsx|mjs)$/, "");
  pattern = pattern.replace(/\[([A-Za-z0-9_-]+)\]/g, ":$1").replace(/^\/+/, "");

  return "/" + pattern;
}

/** Return a project-relative label suitable for diagnostics and logs. */
export function discoveryFileLabel(filePath: string, baseDir = ""): string {
  const normalizedFile = filePath.replace(/^file:\/\//, "").replaceAll("\\", "/");
  const normalizedBase = baseDir.replace(/^file:\/\//, "").replaceAll("\\", "/")
    .replace(/\/+$/, "");

  if (normalizedBase && normalizedFile.startsWith(`${normalizedBase}/`)) {
    return normalizedFile.slice(normalizedBase.length + 1);
  }
  if (!normalizedFile.startsWith("/") && !/^[A-Za-z]:\//.test(normalizedFile)) {
    return normalizedFile.replace(/^\.\//, "");
  }

  const segments = normalizedFile.split("/").filter(Boolean);
  return segments.slice(-2).join("/") || "unknown";
}

const SAFE_PATH_SEGMENT_REGEX = /^[A-Za-z0-9._-]+$/;

/** Return whether a capability name is a safe single filesystem segment. */
export function isSafePathSegment(name: string): boolean {
  return name !== "." && name !== ".." && SAFE_PATH_SEGMENT_REGEX.test(name);
}

/**
 * Retained for compatibility. Agent index generation no longer requires
 * process-wide path tracking.
 */
export function trackAgentPath(_id: string, _filePath: string): void {}

/**
 * Retained for compatibility. There is no process-wide path state to clear.
 */
export function clearTrackedAgents(): void {}
