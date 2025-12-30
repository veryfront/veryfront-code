/**
 * Register HTTP Module Loader for Node.js
 *
 * NOTE: Node.js ESM loaders require experimental flags or special setup.
 * This module provides a stub that logs when JIT loading would be used.
 *
 * For true JIT HTTP imports in Node.js, use:
 *   node --experimental-loader=./http-loader.mjs app.js
 *
 * @module platform/compat/register-http-loader
 */

import { isNode, isDeno } from "./runtime.ts";

let registered = false;
let httpLoaderAvailable = false;

/**
 * Register the HTTP loader for Node.js
 *
 * Note: Full JIT HTTP imports require Node.js experimental loader flags.
 * This function checks capability and logs status.
 *
 * @returns true if loader was registered, false otherwise
 */
export async function registerHttpLoader(): Promise<boolean> {
  // Skip if already registered
  if (registered) {
    return httpLoaderAvailable;
  }

  registered = true;

  // Skip in Deno - native HTTP import support
  if (isDeno) {
    httpLoaderAvailable = true;
    return true;
  }

  // Only register in Node.js
  if (!isNode) {
    return false;
  }

  // Check Node.js version for loader support
  try {
    const nodeVersion = process.versions?.node;
    if (nodeVersion) {
      const [major] = nodeVersion.split(".").map(Number);
      if (major >= 20) {
        // Node 20.6+ supports module.register() but loaders need special handling
        // For now, we rely on build-time fetching which works reliably
        httpLoaderAvailable = false;
      }
    }
  } catch {
    // Continue without loader
  }

  return httpLoaderAvailable;
}

/**
 * Check if HTTP loader is available
 */
export function isHttpLoaderAvailable(): boolean {
  return httpLoaderAvailable || isDeno;
}
