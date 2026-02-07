/**
 * Path Utilities
 *
 * Shared path resolution utilities for CLI commands.
 */

import { cwd } from "veryfront/platform";
import { join } from "veryfront/platform/path";

/**
 * Resolve a path relative to cwd if not absolute
 */
export function resolvePath(path: string): string {
  return path.startsWith("/") ? path : join(cwd(), path);
}
