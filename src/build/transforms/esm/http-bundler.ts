/**
 * HTTP Import Handler for SSR.
 *
 * Strategy:
 * - Deno (temp files outside node_modules): Pass through HTTP imports as-is.
 *   Deno natively supports https:// imports when not in Node.js compat mode.
 * - Node/Bun (future): Use esbuild to bundle HTTP imports into local files.
 *
 * The key insight: files in node_modules/ use Node.js compat mode in Deno
 * (due to nodeModulesDir: "auto"), which doesn't support HTTP imports.
 * By placing temp files in .cache/ (outside node_modules), Deno uses its
 * native module resolution which handles HTTP imports directly.
 */

import { rendererLogger as logger } from "@veryfront/utils";

const LOG_PREFIX = "[HTTP-HANDLER]";

/** Check if code has HTTP imports */
export function hasHttpImports(code: string): boolean {
  return /['"]https?:\/\/[^'"]+['"]/.test(code);
}

/** Get React aliases for SSR (npm: specifiers work in Deno) */
export function getReactAliases(): Record<string, string> {
  return {
    "react": "npm:react@18.3.1",
    "react-dom": "npm:react-dom@18.3.1",
    "react/jsx-runtime": "npm:react@18.3.1/jsx-runtime",
    "react/jsx-dev-runtime": "npm:react@18.3.1/jsx-runtime",
    "react-dom/server": "npm:react-dom@18.3.1/server",
    "react-dom/client": "npm:react-dom@18.3.1/client",
  };
}

/** Strip Deno shim from esm.sh bundles */
export function stripDenoShim(code: string): string {
  const isDeno = typeof Deno !== "undefined";
  if (!isDeno) return code;
  return code.replace(
    /globalThis\.Deno\s*=\s*globalThis\.Deno\s*\|\|\s*\{[\s\S]*?env:\s*\{[\s\S]*?\}\s*\};?/g,
    "/* Deno shim stripped */",
  );
}

/** Placeholder for esbuild plugin (used by MDX loader) */
export function createHTTPPlugin(): { name: string; setup: () => void } {
  return { name: "vf-http-noop", setup: () => {} };
}

/**
 * Process HTTP imports for SSR.
 *
 * For Deno: Pass through as-is. HTTP imports work natively when temp files
 * are outside node_modules (in .cache/).
 *
 * For Node/Bun: Would need esbuild bundling (see cross-platform support issue).
 */
export function bundleHttpImports(
  code: string,
  _tempDir: string,
  hash: string,
): string {
  const has = hasHttpImports(code);
  logger.debug(`${LOG_PREFIX} Check: hasHttp=${has}, hash=${hash.slice(0, 8)}`);

  if (!has) return code;

  // Deno: Pass through - HTTP imports work natively
  // The temp files are now in .cache/ (outside node_modules), so Deno
  // uses native module resolution which supports https:// imports.
  const isDeno = typeof Deno !== "undefined";
  if (isDeno) {
    logger.debug(`${LOG_PREFIX} Deno detected - passing through HTTP imports`);
    return code;
  }

  // Node/Bun: Would need esbuild bundling here for cross-platform support
  logger.warn(`${LOG_PREFIX} Non-Deno runtime detected - HTTP imports may fail`);
  return code;
}
