/**
 * Path Helper Utilities
 */

import { isAbsolute, resolve } from "std/path/mod.ts";

const projectDir = Deno.cwd();

/**
 * Resolve a relative or absolute path
 */
export function resolvePath(relativePath: string): string {
  return isAbsolute(relativePath) ? relativePath : resolve(projectDir, relativePath);
}
