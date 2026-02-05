/**
 * HTTP Import Handler for SSR.
 *
 * Ensures esm.sh URLs use ?external=react so they all share
 * the same React instance from deno.json import map.
 */

import { rendererLogger as logger } from "#veryfront/utils";
import type { Plugin } from "esbuild";
import { replaceSpecifiers } from "./lexer.ts";
import { DEFAULT_REACT_VERSION, getReactUrls } from "./package-registry.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getEnvironmentConfig, type EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { isReactSpecifier } from "#veryfront/platform/compat/react-paths.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";

const LOG_PREFIX = "[HTTP-HANDLER]";

/**
 * User agent string for HTTP fetches.
 */
const HTTP_USER_AGENT = "Mozilla/5.0 Veryfront/1.0";

/**
 * Get the HTTP fetch timeout from environment or default.
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
function getHttpTimeout(env: EnvironmentConfig = getEnvironmentConfig()): number {
  const timeout = env.httpFetchTimeoutMs;
  if (timeout !== undefined && timeout > 0) return timeout;
  return HTTP_FETCH_TIMEOUT_MS;
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
          // Veryfront module paths are served locally, not via esm.sh
          if (path.startsWith("/_vf_modules/") || path.startsWith("/_veryfront/")) {
            return { path, external: true };
          }
          try {
            return { path: new URL(path, args.importer).toString(), namespace: "http-url" };
          } catch {
            return undefined;
          }
        }

        if (isReactSpecifier(path)) return { path, external: true };

        if (/^(node:|bun:|data:|file:)/.test(path)) {
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
          const url = new URL(args.path);
          if (url.hostname === "esm.sh") {
            if (url.pathname.includes("/denonext/")) {
              url.pathname = url.pathname.replace("/denonext/", "/");
            }
            if (!url.searchParams.has("target")) {
              url.searchParams.set("target", "es2022");
            }
            requestUrl = url.toString();
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

          // Validate response is JavaScript, not an HTML error page.
          // esm.sh can return HTTP 200 with HTML error pages when packages fail to build.
          const contentType = res.headers.get("content-type") || "";
          const trimmed = contents.trimStart();
          const isHtmlContent = contentType.includes("text/html") ||
            trimmed.startsWith("<!DOCTYPE") ||
            trimmed.startsWith("<html") ||
            trimmed.startsWith("<HTML") ||
            /<title>ESM[^<]*<\/title>/i.test(contents.slice(0, 500));

          if (isHtmlContent) {
            logger.warn(`${LOG_PREFIX} Received HTML instead of JS for ${args.path}`);
            return {
              errors: [{
                text:
                  `Received HTML instead of JavaScript from ${args.path}. Package may not exist or failed to build on esm.sh.`,
              }],
            };
          }

          return { contents, loader: "js" };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(`${LOG_PREFIX} Network error fetching ${args.path}: ${errorMessage}`);
          return { errors: [{ text: `Network error fetching ${args.path}: ${errorMessage}` }] };
        } finally {
          clearTimeout(timeout);
        }
      });
    },
  };
}

function ensureEsmTarget(specifier: string): string | null {
  if (specifier.includes("target=")) return null;
  const joiner = specifier.includes("?") ? "&" : "?";
  return `${specifier}${joiner}target=es2022`;
}

function ensureEsmExternalAndDeps(specifier: string, version: string): string | null {
  const needsTarget = !specifier.includes("target=");
  const needsDeps = !specifier.includes("deps=");

  const hasExternal = specifier.includes("external=");
  const hasReactExternal = specifier.includes("external=react") ||
    /external=[^&]*\breact\b/.test(specifier);
  const hasReactDomExternal = /external=[^&]*react-dom/.test(specifier);

  if (hasExternal && (!hasReactExternal || !hasReactDomExternal)) {
    try {
      const url = new URL(specifier);
      const existing = url.searchParams.get("external") || "";

      if (!hasReactExternal) {
        url.searchParams.set("external", `${existing},react,react-dom`);
      } else if (!hasReactDomExternal) {
        url.searchParams.set("external", `${existing},react-dom`);
      }

      if (needsTarget) url.searchParams.set("target", "es2022");
      if (needsDeps) url.searchParams.set("deps", `react@${version},react-dom@${version}`);

      const out = url.toString();
      logger.debug(`${LOG_PREFIX} ${specifier} -> ${out}`);
      return out;
    } catch {
      // Fallback: add as new param (may create duplicate)
    }
  }

  const params: string[] = [];
  if (needsTarget) params.push("target=es2022");

  if (!hasExternal) {
    params.push("external=react,react-dom");
  } else if (!hasReactExternal) {
    params.push("external=react,react-dom");
  } else if (!hasReactDomExternal) {
    params.push("external=react-dom");
  }

  if (needsDeps) params.push(`deps=react@${version},react-dom@${version}`);

  if (params.length === 0) return null;

  const joiner = specifier.includes("?") ? "&" : "?";
  const out = `${specifier}${joiner}${params.join("&")}`;
  logger.debug(`${LOG_PREFIX} ${specifier} -> ${out}`);
  return out;
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
 * @param reactVersion - React version for deps param (defaults to DEFAULT_REACT_VERSION)
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

  const version = reactVersion ?? DEFAULT_REACT_VERSION;

  return replaceSpecifiers(code, (specifier) => {
    // Skip Veryfront internal module paths - they're served locally, not via esm.sh
    // Check both with and without leading slash (import rewriter may strip it)
    if (
      specifier.startsWith("/_vf_modules/") ||
      specifier.startsWith("/_veryfront/") ||
      specifier.startsWith("_vf_modules/") ||
      specifier.startsWith("_veryfront/")
    ) {
      logger.debug(`${LOG_PREFIX} Skipping veryfront path: ${specifier}`);
      return null;
    }

    // Handle relative esm.sh paths like "/react-dom?target=es2022" or "/hoist-non-react-statics@..."
    // These are returned by esm.sh stub modules and need to be converted to full URLs
    if (
      specifier.startsWith("/") &&
      !specifier.startsWith("//")
    ) {
      const fullUrl = `https://esm.sh${specifier}`;
      const isReactPackage = /^\/react(-dom)?(@|\/|\?|$)/.test(specifier);

      if (isReactPackage) {
        if (specifier.includes("target=")) return fullUrl;
        const joiner = specifier.includes("?") ? "&" : "?";
        return `${fullUrl}${joiner}target=es2022`;
      }

      const params: string[] = [];
      if (!specifier.includes("target=")) params.push("target=es2022");
      if (!specifier.includes("external=")) params.push("external=react,react-dom");
      if (!specifier.includes("deps=")) params.push(`deps=react@${version},react-dom@${version}`);

      if (params.length === 0) return fullUrl;

      const joiner = specifier.includes("?") ? "&" : "?";
      return `${fullUrl}${joiner}${params.join("&")}`;
    }

    const isEsmSh = specifier.startsWith("https://esm.sh/") ||
      specifier.startsWith("http://esm.sh/");
    const isVfEsm = specifier.startsWith("https://esm.veryfront.com/");
    if (!isEsmSh && !isVfEsm) return null;

    // Don't modify React/ReactDOM package URLs themselves
    const isReactPackage = /\/react(-dom)?(@|\/|$)/.test(specifier);
    if (isReactPackage) return ensureEsmTarget(specifier);

    return ensureEsmExternalAndDeps(specifier, version);
  });
}
