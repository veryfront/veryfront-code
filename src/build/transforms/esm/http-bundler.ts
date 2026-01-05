/**
 * HTTP Import Handler for SSR.
 *
 * UNIFIED APPROACH: Both SSR and browser use esm.sh URLs for React.
 * This ensures identical module instances, preventing hydration mismatches.
 * Works across Deno, Node, and Bun since esm.sh URLs are standard HTTPS imports.
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { getReactUrls, REACT_VERSION } from "./package-registry.ts";

const LOG_PREFIX = "[HTTP-HANDLER]";

/** Check if code has HTTP imports */
export function hasHttpImports(code: string): boolean {
  return /['"]https?:\/\/[^'"]+['"]/.test(code);
}

/**
 * Get React aliases for SSR bundling.
 *
 * UNIFIED APPROACH: Uses esm.sh URLs (same as browser) to ensure
 * SSR and browser use identical React instances, preventing hydration errors.
 *
 * Includes aliases for npm: specifiers (from Deno import map resolution)
 * so esbuild can resolve them to esm.sh URLs.
 */
export function getReactAliases(): Record<string, string> {
  const urls = getReactUrls();
  return {
    // Bare specifiers
    "react": urls.react,
    "react-dom": urls["react-dom"],
    "react/jsx-runtime": urls["react/jsx-runtime"],
    "react/jsx-dev-runtime": urls["react/jsx-dev-runtime"],
    "react-dom/server": urls["react-dom/server"],
    "react-dom/client": urls["react-dom/client"],
    // npm: specifiers (Deno import map resolution produces these)
    "npm:react": urls.react,
    [`npm:react@${REACT_VERSION}`]: urls.react,
    [`npm:react@${REACT_VERSION}/jsx-runtime`]: urls["react/jsx-runtime"],
    [`npm:react@${REACT_VERSION}/jsx-dev-runtime`]: urls["react/jsx-dev-runtime"],
    "npm:react-dom": urls["react-dom"],
    [`npm:react-dom@${REACT_VERSION}`]: urls["react-dom"],
    [`npm:react-dom@${REACT_VERSION}/server`]: urls["react-dom/server"],
    [`npm:react-dom@${REACT_VERSION}/client`]: urls["react-dom/client"],
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
