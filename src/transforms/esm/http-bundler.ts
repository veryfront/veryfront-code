/**
 * HTTP Import Handler for SSR.
 *
 * Ensures esm.sh URLs use ?external=react so they all share
 * the same React instance from deno.json import map.
 */

import { rendererLogger as logger } from "#veryfront/utils";
import type { Plugin } from "veryfront/extensions/bundler";
import { replaceSpecifiers } from "./lexer.ts";
import { describeHtmlModuleResponse } from "./http-cache-helpers.ts";
import { DEFAULT_REACT_VERSION, getReactUrls } from "./react-cdn.ts";
import {
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { isReactSpecifier } from "#veryfront/platform/compat/react-paths.ts";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { MAX_BUNDLE_CHUNK_SIZE_BYTES } from "#veryfront/utils/constants/buffers.ts";
import { readHttpModuleText } from "../shared/http-module-response.ts";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/constants/limits.ts";

const LOG_PREFIX = "[HTTP-HANDLER]";

/**
 * User agent string for HTTP fetches.
 */
const HTTP_USER_AGENT = "Mozilla/5.0 Veryfront/1.0";

/**
 * Get the HTTP fetch timeout from environment or default.
 *
 * @param env - Optional EnvironmentConfig for test isolation
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

/** Re-export getReactUrls for backwards compatibility */
export { getReactUrls };

export interface HttpPluginOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function requireHttpTimeout(timeoutMs: number): number {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `HTTP plugin timeout must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return timeoutMs;
}

/**
 * esbuild plugin that fetches HTTP imports and rewrites esm.sh URLs.
 */
export function createHTTPPlugin(options: HttpPluginOptions = {}): Plugin {
  const configuredTimeoutMs = options.timeoutMs === undefined
    ? undefined
    : requireHttpTimeout(options.timeoutMs);

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
          } catch (_) {
            /* expected: relative path may not resolve against importer URL */
            return undefined;
          }
        }

        if (isReactSpecifier(path)) return { path, external: true };

        if (/^(node:|bun:|data:|file:)/.test(path)) {
          return { path, external: true };
        }

        try {
          return { path: new URL(path, args.importer).toString(), namespace: "http-url" };
        } catch (_) {
          /* expected: bare specifier may not resolve as URL */
          return { path: `https://esm.sh/${path}`, namespace: "http-url" };
        }
      });

      build.onLoad({ filter: /.*/, namespace: "http-url" }, async (args) => {
        let requestUrl = args.path;
        const safeUrl = sanitizeUrlForSpan(args.path);

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
          logger.debug(`${LOG_PREFIX} URL parse error for ${safeUrl}:`, urlError);
        }

        const controller = new AbortController();
        const timeoutMs = configuredTimeoutMs ?? requireHttpTimeout(getHttpTimeout());
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const res = await (options.fetchFn ?? fetch)(requestUrl, {
            headers: { "user-agent": HTTP_USER_AGENT },
            signal: controller.signal,
            redirect: "follow",
          });

          if (!res.ok) {
            try {
              const cancellation = res.body?.cancel();
              if (cancellation) void cancellation.catch(() => undefined);
            } catch {
              /* cancellation is best-effort cleanup */
            }
            logger.warn(`${LOG_PREFIX} HTTP ${res.status} fetching ${safeUrl}`);
            return { errors: [{ text: `Failed to fetch ${safeUrl}: ${res.status}` }] };
          }

          const contents = await readHttpModuleText(
            res,
            MAX_BUNDLE_CHUNK_SIZE_BYTES,
            controller.signal,
          );

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
            logger.warn(`${LOG_PREFIX} Received HTML instead of JS for ${safeUrl}`);
            // Blaming esm.sh for every host that answers HTML sends the reader
            // to a registry that was never involved. The shared helper reports
            // the real cause, including an unresolved "@/" alias that fell
            // through to the site origin (VERYFRONT-SERVER-G).
            return { errors: [{ text: describeHtmlModuleResponse(safeUrl) }] };
          }

          return { contents, loader: "js" };
        } catch (error) {
          const errorMessage = snapshotThrowableDiagnostic(error);
          logger.warn(`${LOG_PREFIX} Network error fetching ${safeUrl}: ${errorMessage}`);
          return { errors: [{ text: `Network error fetching ${safeUrl}: ${errorMessage}` }] };
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
    } catch (_) {
      /* expected: URL may be malformed, fallback to string append */
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
