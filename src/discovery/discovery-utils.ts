/**
 * Discovery Utilities
 *
 * Helper functions for ID generation, path manipulation, and agent tracking.
 */

import type { DiscoveryResult } from "./types.ts";

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
 * Clear tracked agent paths
 */
export function clearTrackedAgents(): void {
  discoveredAgentPaths.clear();
}

/**
 * Build a DiscoveryResult with no discovered primitives. Useful as a neutral
 * return value for discovery stubs in tests and no-op discovery paths.
 */
export function createEmptyDiscoveryResult(): DiscoveryResult {
  return {
    tools: new Map(),
    agents: new Map(),
    skills: new Map(),
    resources: new Map(),
    prompts: new Map(),
    workflows: new Map(),
    tasks: new Map(),
    schedules: new Map(),
    webhooks: new Map(),
    evals: new Map(),
    errors: [],
  };
}
