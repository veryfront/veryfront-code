/**
 * Path Helper Utilities
 */

import * as pathMod from 'node:path';

// Helper for Cross-Platform CWD
function getCwd(): string {
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') {
    // @ts-ignore - Deno global
    return Deno.cwd();
  }
  return process.cwd();
}

const projectDir = getCwd();

/**
 * Resolve a relative or absolute path
 */
export function resolvePath(relativePath: string): string {
  return pathMod.isAbsolute(relativePath) ? relativePath : pathMod.resolve(projectDir, relativePath);
}
