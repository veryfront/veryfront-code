/**
 * Project utilities for CLI
 *
 * @module cli/utils/project
 */

import { basename } from "#veryfront/compat/path/index.ts";

/**
 * Generate a default project ID from the project directory name.
 * Used for local filesystem mode when no project ID is available from API.
 */
export function generateDefaultProjectId(projectDir: string): string {
  const dirName = basename(projectDir);
  return `local-${dirName.replace(/[^a-zA-Z0-9-_]/g, "-").toLowerCase()}`;
}
