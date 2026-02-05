/**
 * Discovery Utilities
 *
 * Helper functions for ID generation, path manipulation, and agent tracking.
 */

/**
 * Convert a file path to a camelCase ID
 */
export function filenameToId(filePath: string): string {
  const filename = filePath.split("/").pop()?.replace(/\.(ts|tsx|js|jsx)$/, "") ?? "";
  return filename
    .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
    .replace(/^[A-Z]/, (char) => char.toLowerCase());
}

/**
 * Convert a file path to a URL-style pattern for resources
 */
export function filePathToPattern(filePath: string, baseDir: string): string {
  const cleanPath = filePath.replace("file://", "");

  let pattern = cleanPath.replace(baseDir, "").replace(/\.(ts|tsx|js|jsx)$/, "");
  pattern = pattern.replace(/\[(\w+)\]/g, ":$1").replace(/^\/+/, "");

  return "/" + pattern;
}

// Track discovered agent paths for index generation
const discoveredAgentPaths = new Map<string, string>();

/**
 * Track an agent's file path for index generation
 */
export function trackAgentPath(id: string, filePath: string): void {
  discoveredAgentPaths.set(id, filePath);
}

/**
 * Get all tracked agent paths
 */
export function getTrackedAgentPaths(): Map<string, string> {
  return discoveredAgentPaths;
}

/**
 * Clear tracked agent paths
 */
export function clearTrackedAgents(): void {
  discoveredAgentPaths.clear();
}
