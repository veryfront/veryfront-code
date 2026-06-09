/****
 * HTTP fallback module fetching for local development.
 *
 * When a module cannot be read directly from the filesystem,
 * this fetches it via the local dev server's HTTP endpoint.
 *
 * @module transforms/mdx/esm-module-loader/module-fetcher/http-fetcher
 */

import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { LOG_PREFIX_MDX_LOADER } from "../constants.ts";
import { rewriteVeryfrontImports } from "./import-rewriter.ts";
import { findNestedImports } from "./nested-imports.ts";
import { replaceSourceSpans, type SourceSpanReplacement } from "../utils/source-spans.ts";

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
    log.warn(
      `${LOG_PREFIX_MDX_LOADER} Direct read failed in production (module must be pre-loaded): ${normalizedPath}`,
    );
    return null;
  }

  log.debug(`${LOG_PREFIX_MDX_LOADER} Direct read failed, falling back to HTTP: ${normalizedPath}`);

  const port = adapter.env.get("VERYFRONT_DEV_PORT") || adapter.env.get("PORT") || "3001";
  const host = projectSlug ? `${projectSlug}.lvh.me` : "localhost";
  const moduleUrl = `http://${host}:${port}/${normalizedPath}?ssr=true`;

  const response = await withSpan(
    SpanNames.HTTP_CLIENT_FETCH,
    () => fetch(moduleUrl),
    {
      "http.method": "GET",
      "http.url": moduleUrl,
      "http.target": `/${normalizedPath}`,
      "http.host": host,
      "mdx.module_path": normalizedPath,
    },
  );

  if (!response.ok) {
    log.warn(`${LOG_PREFIX_MDX_LOADER} HTTP fetch also failed: ${moduleUrl} (${response.status})`);
    return null;
  }

  const moduleCode = rewriteVeryfrontImports(await response.text());

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

  const results = await Promise.all(
    allImports.map(async ({ original, path, start, end, key }) => {
      const nestedFilePath = await fetchAndCacheModuleFn(path, normalizedPath);
      return { original, start, end, nestedFilePath, [key]: path };
    }),
  );

  const replacements: SourceSpanReplacement[] = [];
  for (const { original, start, end, nestedFilePath } of results) {
    if (nestedFilePath) {
      replacements.push({
        start,
        end,
        expected: original,
        replacement: `from "file://${nestedFilePath}"`,
      });
    }
  }

  return replaceSourceSpans(moduleCode, replacements);
}
