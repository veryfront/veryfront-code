/**
 * HTTP Import Handler for SSR.
 *
 * Ensures esm.sh URLs use ?external=react so they all share
 * the same React instance from deno.json import map.
 */

import { rendererLogger as logger } from "@veryfront/utils";
import { replaceSpecifiers } from "./lexer.ts";
import { getReactUrls } from "./package-registry.ts";

const LOG_PREFIX = "[HTTP-HANDLER]";

/** Check if code has HTTP imports */
export function hasHttpImports(code: string): boolean {
  return /['"]https?:\/\/[^'"]+['"]/.test(code);
}

/** Strip Deno shim from esm.sh bundles (if present) */
export function stripDenoShim(code: string): string {
  const isDeno = typeof Deno !== "undefined";
  if (!isDeno) return code;
  return code.replace(
    /globalThis\.Deno\s*=\s*globalThis\.Deno\s*\|\|\s*\{[\s\S]*?env:\s*\{[\s\S]*?\}\s*\};?/g,
    "/* Deno shim stripped */",
  );
}

/** Re-export getReactUrls for backwards compatibility */
export { getReactUrls };

/** Alias for getReactUrls - used by esbuild bundling */
export function getReactAliases(): Record<string, string> {
  return getReactUrls();
}

/**
 * NOOP plugin for esbuild.
 */
export function createHTTPPlugin(): { name: string; setup: () => void } {
  return { name: "vf-http-noop", setup: () => {} };
}

/**
 * Ensure esm.sh URLs have ?external=react for SSR.
 * This makes them import React as a bare specifier, which deno.json resolves.
 */
export function bundleHttpImports(
  code: string,
  _cacheDir: string,
  hash: string,
): string | Promise<string> {
  const has = hasHttpImports(code);
  logger.debug(`${LOG_PREFIX} Check: hasHttp=${has}, hash=${hash.slice(0, 8)}`);

  if (!has) return code;

  return replaceSpecifiers(code, (specifier) => {
    // Handle esm.sh and veryfront esm proxies
    const isEsmSh = specifier.startsWith("https://esm.sh/") ||
      specifier.startsWith("http://esm.sh/");
    const isVfEsm = specifier.startsWith("https://esm.veryfront.com/");
    if (!isEsmSh && !isVfEsm) {
      return null;
    }

    // Check if this is a React package - never add external=react to React itself
    // Matches: react@, react/, react-dom@, react-dom/
    const isReactPackage = /\/react(@|\/|$)/.test(specifier) ||
      /\/react-dom(@|\/|$)/.test(specifier);

    // Skip if already has both external and target params
    if (specifier.includes("external=react") && specifier.includes("target=es2022")) {
      return null;
    }

    // Build query params to add
    const params: string[] = [];
    if (!specifier.includes("target=")) {
      params.push("target=es2022");
    }
    // Only add external=react to non-React packages
    if (!isReactPackage && !specifier.includes("external=react")) {
      params.push("external=react");
    }
    if (params.length === 0) {
      return null;
    }

    // Add params
    const hasQuery = specifier.includes("?");
    const newSpec = hasQuery
      ? `${specifier}&${params.join("&")}`
      : `${specifier}?${params.join("&")}`;

    logger.debug(`${LOG_PREFIX} ${specifier} -> ${newSpec}`);
    return newSpec;
  });
}
