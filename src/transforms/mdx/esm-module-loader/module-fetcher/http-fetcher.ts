/****
 * HTTP fallback module fetching for local development.
 *
 * When a module cannot be read directly from the filesystem,
 * this fetches it via the local dev server's HTTP endpoint.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/http-fetcher
 */

import type { Logger } from "#veryfront/utils";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { rewriteVeryfrontImports } from "./import-rewriter.ts";
import { findNestedImports } from "./nested-imports.ts";
import { replaceSourceSpans, type SourceSpanReplacement } from "../utils/source-spans.ts";
import { HTTP_MODULE_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { readHttpModuleResponse } from "#veryfront/transforms/shared/http-module-response.ts";
import { errorLogName } from "#veryfront/transforms/shared/log-context.ts";

const MAX_HTTP_FALLBACK_PATH_LENGTH = 2048;
const MAX_NESTED_HTTP_IMPORTS = 512;
const NESTED_IMPORT_CONCURRENCY = 16;
const PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MODULE_PATH_PATTERN = /^[A-Za-z0-9._~!$&'()+,;=@/-]+$/;

function isValidModulePath(path: string): boolean {
  if (
    path.length === 0 ||
    path.length > MAX_HTTP_FALLBACK_PATH_LENGTH ||
    !MODULE_PATH_PATTERN.test(path)
  ) {
    return false;
  }

  return path.replace(/^\/+/, "").split("/").every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".."
  );
}

function getValidPort(adapter: RuntimeAdapter): number | null {
  const rawPort = adapter.env.get("VERYFRONT_DEV_PORT") || adapter.env.get("PORT") || "3001";
  if (!/^\d{1,5}$/.test(rawPort)) return null;
  const port = Number(rawPort);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

/**
 * Fetch module via HTTP as a fallback (local development only).
 *
 * In production, direct read failures are fatal -- modules must be pre-loaded.
 * In local dev, we fall back to fetching from the dev server and resolve
 * nested imports recursively.
 */
export async function fetchModuleViaHTTP(
  normalizedPath: string,
  adapter: RuntimeAdapter,
  fetchAndCacheModuleFn: (path: string, parent?: string) => Promise<string | null>,
  log: Logger,
  projectSlug?: string,
  isLocalProject?: boolean,
): Promise<string | null> {
  if (!isLocalProject) {
    log.warn(`${LOG_PREFIX_MDX_LOADER} Direct read failed in production`);
    return null;
  }

  const port = getValidPort(adapter);
  const projectSlugIsValid = projectSlug === undefined || PROJECT_SLUG_PATTERN.test(projectSlug);
  if (port === null || !projectSlugIsValid || !isValidModulePath(normalizedPath)) {
    log.warn(`${LOG_PREFIX_MDX_LOADER} HTTP fallback configuration is invalid`);
    return null;
  }

  log.debug(`${LOG_PREFIX_MDX_LOADER} Direct read failed, using HTTP fallback`);

  const host = projectSlug ? `${projectSlug}.lvh.me` : "localhost";
  const moduleUrl = new URL(`http://${host}:${port}`);
  moduleUrl.pathname = `/${normalizedPath.replace(/^\/+/, "")}`;
  moduleUrl.searchParams.set("ssr", "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_MODULE_FETCH_TIMEOUT_MS);
  let moduleSource: string | null;
  try {
    const response = await withSpan(
      SpanNames.HTTP_CLIENT_FETCH,
      () => fetch(moduleUrl, { signal: controller.signal }),
      {
        "http.method": "GET",
        "http.scheme": "http",
        "mdx.module_fetch": true,
      },
    );

    if (!response.ok) {
      log.warn(`${LOG_PREFIX_MDX_LOADER} HTTP fallback request failed`, {
        status: response.status,
      });
      return null;
    }

    moduleSource = await readHttpModuleResponse(response);
  } catch (error) {
    log.warn(`${LOG_PREFIX_MDX_LOADER} HTTP fallback request failed`, {
      errorName: errorLogName(error),
      timedOut: controller.signal.aborted,
    });
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (moduleSource === null) {
    log.warn(`${LOG_PREFIX_MDX_LOADER} HTTP fallback response exceeded the size limit`);
    return null;
  }

  const moduleCode = rewriteVeryfrontImports(moduleSource);

  const { vfModules, relative } = findNestedImports(moduleCode);
  const allImports = [
    ...vfModules.map(({ original, path, start, end }) => ({
      original,
      path,
      start,
      end,
      key: "nestedPath" as const,
    })),
    ...relative.map(({ original, path, start, end }) => ({
      original,
      path,
      start,
      end,
      key: "relativePath" as const,
    })),
  ];

  if (allImports.length > MAX_NESTED_HTTP_IMPORTS) {
    log.warn(`${LOG_PREFIX_MDX_LOADER} HTTP fallback module has too many imports`, {
      count: allImports.length,
      limit: MAX_NESTED_HTTP_IMPORTS,
    });
    return null;
  }

  const results: Array<{
    original: string;
    start: number;
    end: number;
    nestedFilePath: string | null;
  }> = [];
  for (
    let startIndex = 0;
    startIndex < allImports.length;
    startIndex += NESTED_IMPORT_CONCURRENCY
  ) {
    const batch = allImports.slice(startIndex, startIndex + NESTED_IMPORT_CONCURRENCY);
    results.push(
      ...await Promise.all(
        batch.map(async ({ original, path, start, end }) => ({
          original,
          start,
          end,
          nestedFilePath: await fetchAndCacheModuleFn(path, normalizedPath),
        })),
      ),
    );
  }

  const replacements: SourceSpanReplacement[] = [];
  for (const { original, start, end, nestedFilePath } of results) {
    if (nestedFilePath) {
      replacements.push({
        start,
        end,
        expected: original,
        replacement: `from ${JSON.stringify(`file://${nestedFilePath}`)}`,
      });
    }
  }

  return replaceSourceSpans(moduleCode, replacements);
}
