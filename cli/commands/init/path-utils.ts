/**
 * Path Utilities
 *
 * Shared path resolution utilities for CLI commands.
 */

import { cwd } from "#veryfront/platform/compat/process.ts";
import { join } from "#veryfront/compat/path/index.ts";

/**
 * Resolve a path relative to cwd if not absolute
 */
export function resolvePath(path: string): string {
  return path.startsWith("/") ? path : join(cwd(), path);
}
