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
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/http.ts";
import { readHttpModuleText } from "../../../shared/http-module-response.ts";
import { MAX_MDX_MODULE_CODE_BYTES } from "./recovery-payload.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/constants/limits.ts";
import { assertMdxModuleImportCount } from "./limits.ts";

export interface FetchModuleViaHttpOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

function discardResponseBody(response: Response): void {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation) void cancellation.catch(() => undefined);
  } catch {
    /* cancellation is best-effort cleanup */
  }
}

function requireLocalDevPort(value: string): string {
  if (!/^\d+$/.test(value)) throw new TypeError("Local development port must be numeric");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError("Local development port must be between 1 and 65535");
  }
  return String(port);
}

function requireProjectSlug(value: string | undefined): string {
  if (value === undefined) return "localhost";
  if (
    value.length === 0 ||
    value.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value)
  ) {
    throw new TypeError("Project slug must be a valid DNS label");
  }
  return `${value}.lvh.me`;
}

function requireFetchTimeout(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Local module fetch timeout must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return value;
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
  options: FetchModuleViaHttpOptions = {},
): Promise<string | null> {
  if (!isLocalProject) {
    log.warn(
      `${LOG_PREFIX_MDX_LOADER} Direct read failed in production (module must be pre-loaded): ${normalizedPath}`,
    );
    return null;
  }

  log.debug(`${LOG_PREFIX_MDX_LOADER} Direct read failed, falling back to HTTP: ${normalizedPath}`);

  const port = requireLocalDevPort(
    adapter.env.get("VERYFRONT_DEV_PORT") || adapter.env.get("PORT") || "3001",
  );
  const host = requireProjectSlug(projectSlug);
  const timeoutMs = requireFetchTimeout(options.timeoutMs ?? HTTP_FETCH_TIMEOUT_MS);
  const fetchFn = options.fetchFn ?? fetch;
  const moduleUrl = new URL(`http://${host}:${port}`);
  moduleUrl.pathname = `/${normalizedPath}`;
  moduleUrl.searchParams.set("ssr", "true");
  const moduleUrlString = moduleUrl.toString();
  const controller = new AbortController();
  const timeout = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          `Local module fetch timed out after ${timeoutMs}ms`,
          "TimeoutError",
        ),
      ),
    timeoutMs,
  );

  let response: Response;
  try {
    response = await withSpan(
      SpanNames.HTTP_CLIENT_FETCH,
      () => fetchFn(moduleUrlString, { signal: controller.signal, redirect: "error" }),
      {
        "http.method": "GET",
        "http.url": moduleUrlString,
        "http.target": `/${normalizedPath}`,
        "http.host": host,
        "mdx.module_path": normalizedPath,
      },
    );

    if (!response.ok) {
      discardResponseBody(response);
      log.warn(
        `${LOG_PREFIX_MDX_LOADER} HTTP fetch also failed: ${moduleUrlString} (${response.status})`,
      );
      return null;
    }

    const moduleCode = rewriteVeryfrontImports(
      await readHttpModuleText(
        response,
        MAX_MDX_MODULE_CODE_BYTES,
        controller.signal,
      ),
    );

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
    assertMdxModuleImportCount(normalizedPath, allImports.length);

    const results = [];
    for (const { original, path, start, end, key } of allImports) {
      const nestedFilePath = await fetchAndCacheModuleFn(path, normalizedPath);
      results.push({ original, start, end, nestedFilePath, [key]: path });
    }

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
  } finally {
    clearTimeout(timeout);
  }
}
