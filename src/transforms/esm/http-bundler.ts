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
 * Ensure esm.sh URLs have ?external=react for SSR.
 * This makes them import React as a bare specifier, which deno.json resolves.
 *
 * Uses two esm.sh features:
 * - `external=react` - Don't bundle React, let import map resolve it
 * - `deps=react@X,react-dom@X` - Pin dependency versions to prevent mismatches
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
    const isEsmSh = specifier.startsWith("https://esm.sh/") ||
      specifier.startsWith("http://esm.sh/");
    const isVfEsm = specifier.startsWith("https://esm.veryfront.com/");
    if (!isEsmSh && !isVfEsm) return null;

    const isReactPackage = /\/react(-dom)?(@|\/|$)/.test(specifier);

    const params: string[] = [];

    if (!specifier.includes("target=")) {
      params.push("target=es2022");
    }

    // Only add external and deps to non-React packages
    // Use external=react to not bundle React (let import map resolve it)
    // Use deps=react@X,react-dom@X to pin dependency versions
    if (!isReactPackage) {
      if (!specifier.includes("external=react")) {
        params.push("external=react");
      }
      if (!specifier.includes("deps=")) {
        params.push(`deps=react@${REACT_VERSION},react-dom@${REACT_VERSION}`);
      }
    }

    if (params.length === 0) return null;

    const joiner = specifier.includes("?") ? "&" : "?";
    const newSpec = `${specifier}${joiner}${params.join("&")}`;

    logger.debug(`${LOG_PREFIX} ${specifier} -> ${newSpec}`);
    return newSpec;
  });
}
