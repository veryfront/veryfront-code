/**
 * HTTP Import Handler for SSR.
 *
 * Ensures esm.sh URLs use ?external=react so they all share
 * the same React instance from deno.json import map.
 */

import { rendererLogger as logger } from "#veryfront/utils";
import type { Plugin } from "esbuild";
import { replaceSpecifiers } from "./lexer.ts";
import { getReactUrls, REACT_VERSION } from "./package-registry.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getRuntimeEnv, type RuntimeEnv } from "#veryfront/config/runtime-env.ts";
import { isReactSpecifier } from "#veryfront/platform/compat/react-paths.ts";

const LOG_PREFIX = "[HTTP-HANDLER]";

/**
 * HTTP fetch timeout in milliseconds.
 * Can be overridden via VF_HTTP_FETCH_TIMEOUT environment variable.
 */
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

/**
 * User agent string for HTTP fetches.
 */
const HTTP_USER_AGENT = "Mozilla/5.0 Veryfront/1.0";

/**
 * Get the HTTP fetch timeout from environment or default.
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
function getHttpTimeout(env: RuntimeEnv = getRuntimeEnv()): number {
  const timeout = env.httpFetchTimeoutMs;
  if (timeout !== undefined && timeout > 0) return timeout;
  return DEFAULT_HTTP_TIMEOUT_MS;
}

/** Check if code has HTTP imports */
export function hasHttpImports(code: string): boolean {
  return /['"]https?:\/\/[^'"]+['"]/.test(code);
}

/** Strip Deno shim from esm.sh bundles (if present) */
export function stripDenoShim(code: string): string {
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
export function createHTTPPlugin(): Plugin {
  return {
    name: "vf-http-fetch",
    setup(build: Parameters<Plugin["setup"]>[0]) {
      build.onResolve({ filter: /^https?:\/\// }, (args) => ({
        path: args.path,
        namespace: "http-url",
      }));

      build.onResolve({ filter: /.*/, namespace: "http-url" }, (args) => {
        const path = args.path;

        if (path.startsWith("http://") || path.startsWith("https://")) {
          return { path, namespace: "http-url" };
        }

        if (path.startsWith("./") || path.startsWith("../") || path.startsWith("/")) {
          try {
            return { path: new URL(path, args.importer).toString(), namespace: "http-url" };
          } catch {
            return undefined;
          }
        }

        if (isReactSpecifier(path)) return { path, external: true };

        if (
          path.startsWith("node:") ||
          path.startsWith("bun:") ||
          path.startsWith("data:") ||
          path.startsWith("file:")
        ) {
          return { path, external: true };
        }

        try {
          return { path: new URL(path, args.importer).toString(), namespace: "http-url" };
        } catch {
          return { path: `https://esm.sh/${path}`, namespace: "http-url" };
        }
      });

      build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
        let requestUrl = args.path;

        try {
          const u = new URL(args.path);
          if (u.hostname === "esm.sh") {
            if (u.pathname.includes("/denonext/")) {
              u.pathname = u.pathname.replace("/denonext/", "/");
            }
            if (!u.searchParams.has("target")) {
              u.searchParams.set("target", "es2022");
            }
            requestUrl = u.toString();
          }
        } catch (urlError) {
          logger.debug(`${LOG_PREFIX} URL parse error for ${args.path}:`, urlError);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), getHttpTimeout());

        try {
          const res = await fetch(requestUrl, {
            headers: { "user-agent": HTTP_USER_AGENT },
            signal: controller.signal,
            redirect: "follow",
          });

          if (!res.ok) {
            logger.warn(`${LOG_PREFIX} HTTP ${res.status} fetching ${args.path}`);
            return { errors: [{ text: `Failed to fetch ${args.path}: ${res.status}` }] };
          }

          const contents = await res.text();
          return { contents, loader: "js" };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(`${LOG_PREFIX} Network error fetching ${args.path}: ${errorMessage}`);
          return {
            errors: [{ text: `Network error fetching ${args.path}: ${errorMessage}` }],
          };
        } finally {
          clearTimeout(timeout);
        }
      });
    },
  };
}

/**
 * Ensure esm.sh URLs have external=react,react-dom for SSR.
 * This makes them import React as bare specifiers, which the import map resolves.
 *
 * Uses two esm.sh features:
 * - `external=react,react-dom` - Don't bundle React/ReactDOM, let import map resolve them
 * - `deps=react@X,react-dom@X` - Pin dependency versions to prevent mismatches
 *
 * Logic for external handling:
 * 1. If no `external=` param → add `external=react,react-dom`
 * 2. If `external=X` exists but no `react` → append `,react,react-dom`
 * 3. If has `react` but no `react-dom` → append `,react-dom`
 * 4. If has both `react` AND `react-dom` → leave alone
 *
 * @param code - Source code to process
 * @param _cacheDir - Unused (kept for API compatibility)
 * @param hash - Hash for logging
 * @param reactVersion - React version for deps param (defaults to REACT_VERSION)
 */
export function bundleHttpImports(
  code: string,
  _cacheDir: string,
  hash: string,
  reactVersion?: string,
): string | Promise<string> {
  const has = hasHttpImports(code);
  logger.debug(`${LOG_PREFIX} Check: hasHttp=${has}, hash=${hash.slice(0, 8)}`);
  if (!has) return code;

  const version = reactVersion ?? REACT_VERSION;

  return replaceSpecifiers(code, (specifier) => {
    const isEsmSh = specifier.startsWith("https://esm.sh/") ||
      specifier.startsWith("http://esm.sh/");
    const isVfEsm = specifier.startsWith("https://esm.veryfront.com/");
    if (!isEsmSh && !isVfEsm) return null;

    // Don't modify React/ReactDOM package URLs themselves
    const isReactPackage = /\/react(-dom)?(@|\/|$)/.test(specifier);
    if (isReactPackage) {
      // Just ensure target is set for React packages
      if (!specifier.includes("target=")) {
        const joiner = specifier.includes("?") ? "&" : "?";
        return `${specifier}${joiner}target=es2022`;
      }
      return null;
    }

    // For non-React packages: ensure external=react,react-dom and deps
    const params: string[] = [];

    if (!specifier.includes("target=")) {
      params.push("target=es2022");
    }

    // Handle external param - ensure both react AND react-dom are externalized
    const hasExternal = specifier.includes("external=");
    const hasReactExternal = specifier.includes("external=react") ||
      /external=[^&]*\breact\b/.test(specifier);
    const hasReactDomExternal = /external=[^&]*react-dom/.test(specifier);

    if (!hasExternal) {
      // No external param - add both
      params.push("external=react,react-dom");
    } else if (!hasReactExternal) {
      // Has external but no react - append react,react-dom
      // This requires modifying existing param, so we'll use URL parsing
      try {
        const url = new URL(specifier);
        const existing = url.searchParams.get("external") || "";
        url.searchParams.set("external", `${existing},react,react-dom`);
        // Return full modified URL and skip other param additions
        if (!specifier.includes("target=")) {
          url.searchParams.set("target", "es2022");
        }
        if (!specifier.includes("deps=")) {
          url.searchParams.set("deps", `react@${version},react-dom@${version}`);
        }
        logger.debug(`${LOG_PREFIX} ${specifier} -> ${url.toString()}`);
        return url.toString();
      } catch {
        // Fallback: just add as new param (may create duplicate)
        params.push("external=react,react-dom");
      }
    } else if (!hasReactDomExternal) {
      // Has react but not react-dom - append react-dom
      try {
        const url = new URL(specifier);
        const existing = url.searchParams.get("external") || "";
        url.searchParams.set("external", `${existing},react-dom`);
        if (!specifier.includes("target=")) {
          url.searchParams.set("target", "es2022");
        }
        if (!specifier.includes("deps=")) {
          url.searchParams.set("deps", `react@${version},react-dom@${version}`);
        }
        logger.debug(`${LOG_PREFIX} ${specifier} -> ${url.toString()}`);
        return url.toString();
      } catch {
        // Fallback
        params.push("external=react-dom");
      }
    }
    // else: has both react and react-dom - no external changes needed

    if (!specifier.includes("deps=")) {
      params.push(`deps=react@${version},react-dom@${version}`);
    }

    if (params.length === 0) return null;

    const joiner = specifier.includes("?") ? "&" : "?";
    const newSpec = `${specifier}${joiner}${params.join("&")}`;

    logger.debug(`${LOG_PREFIX} ${specifier} -> ${newSpec}`);
    return newSpec;
  });
}
