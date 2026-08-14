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
import { MAX_MDX_MODULE_CODE_BYTES } from "./limits.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/constants/limits.ts";
import { parallelMap } from "#veryfront/utils/parallel.ts";
import { Semaphore } from "#veryfront/modules/react-loader/ssr-module-loader/concurrency/semaphore.ts";
import { assertMdxModuleImportCount, MAX_MDX_MODULE_TRANSFORM_CONCURRENCY } from "./limits.ts";

export interface FetchModuleViaHttpOptions {
  fetchFn?: typeof fetch;
  moduleServerOrigin?: string;
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
  return `${value}.localhost`;
}

function isLocalhostSubdomain(hostname: string): boolean {
  return hostname !== "localhost" && hostname.endsWith(".localhost");
}

/**
 * True for errors that mean "the hostname could not be resolved".
 *
 * Deliberately excludes aborts (timeout/cancellation), which must not be retried.
 */
function isNameResolutionError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (!(error instanceof Error)) return false;
  const text = `${error.message} ${(error.cause as Error | undefined)?.message ?? ""}`
    .toLowerCase();
  return text.includes("dns error") ||
    text.includes("failed to lookup address") ||
    text.includes("enotfound") ||
    text.includes("eai_again") ||
    text.includes("name or service not known");
}

/**
 * Fetch the module, falling back to bare `localhost` when a project subdomain
 * cannot be resolved.
 *
 * RFC 6761 only *recommends* that resolvers map the `.localhost` tree to
 * loopback. macOS, systemd-resolved and CI honour it for arbitrary subdomains,
 * but a plain glibc NSS setup can resolve only the bare name and fail
 * `<slug>.localhost` with EAI_AGAIN/ENOTFOUND, which would make this fallback
 * unable to reach the dev server at all.
 *
 * Pinning the connection to 127.0.0.1 while keeping subdomain routing is not an
 * option: Deno's fetch silently drops a `Host` header override (verified), so
 * the request would arrive with `Host: 127.0.0.1` and lose the project.
 *
 * The retry therefore carries the project in `x-project-slug`, which the dev
 * server reads inbound (see server/context/request-context.ts and
 * server/runtime-handler/project-resolution.ts) and which fetch, unlike `Host`,
 * is allowed to set. Without it a multi-project workspace would lose tenant
 * identity, because resolveDefaultProjectSlug() returns undefined there.
 */
async function fetchModuleWithLoopbackFallback(
  fetchFn: typeof fetch,
  url: URL,
  init: RequestInit,
  log: Logger,
  projectSlug?: string,
): Promise<Response> {
  try {
    return await fetchFn(url.toString(), init);
  } catch (error) {
    if (!isLocalhostSubdomain(url.hostname) || !isNameResolutionError(error)) throw error;
    const fallbackUrl = new URL(url);
    fallbackUrl.hostname = "localhost";
    const headers = new Headers(init.headers);
    if (projectSlug) headers.set("x-project-slug", projectSlug);
    log.debug(
      `${LOG_PREFIX_MDX_LOADER} ${url.hostname} did not resolve; retrying via ${fallbackUrl.host}` +
        `${projectSlug ? ` with x-project-slug: ${projectSlug}` : ""}`,
    );
    return await fetchFn(fallbackUrl.toString(), { ...init, headers });
  }
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
  dependencyPinningCacheKey?: string,
  options: FetchModuleViaHttpOptions = {},
): Promise<string | null> {
  if (!isLocalProject) {
    log.warn(
      `${LOG_PREFIX_MDX_LOADER} Direct read failed in production (module must be pre-loaded): ${normalizedPath}`,
    );
    return null;
  }

  log.debug(`${LOG_PREFIX_MDX_LOADER} Direct read failed, falling back to HTTP: ${normalizedPath}`);

  const timeoutMs = requireFetchTimeout(options.timeoutMs ?? HTTP_FETCH_TIMEOUT_MS);
  const fetchFn = options.fetchFn ?? fetch;
  const moduleServerOrigin = options.moduleServerOrigin ??
    `http://${requireProjectSlug(projectSlug)}:${
      requireLocalDevPort(
        adapter.env.get("VERYFRONT_DEV_PORT") || adapter.env.get("PORT") || "3001",
      )
    }`;
  const moduleServerUrl = new URL(
    moduleServerOrigin,
  );
  if (moduleServerUrl.protocol !== "http:" && moduleServerUrl.protocol !== "https:") {
    throw new TypeError("Module server origin must use http or https");
  }
  const moduleUrl = new URL(moduleServerUrl.origin);
  moduleUrl.pathname = `/${normalizedPath}`;
  moduleUrl.searchParams.set("ssr", "true");
  if (dependencyPinningCacheKey?.startsWith("on:")) {
    moduleUrl.searchParams.set("pins", dependencyPinningCacheKey);
  }
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
      () =>
        fetchModuleWithLoopbackFallback(
          fetchFn,
          moduleUrl,
          {
            signal: controller.signal,
            redirect: "error",
          },
          log,
          projectSlug,
        ),
      {
        "http.method": "GET",
        "http.url": moduleUrlString,
        "http.target": `/${normalizedPath}`,
        "http.host": moduleUrl.host,
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
      ...vfModules.map(({ original, path, suffix, start, end, isDynamic, isSideEffect }) => ({
        original,
        path,
        suffix,
        start,
        end,
        isDynamic,
        isSideEffect,
        key: "nestedPath" as const,
      })),
      ...relative.map(({ original, path, suffix, start, end, isDynamic, isSideEffect }) => ({
        original,
        path,
        suffix,
        start,
        end,
        isDynamic,
        isSideEffect,
        key: "relativePath" as const,
      })),
    ];
    assertMdxModuleImportCount(normalizedPath, allImports.length);

    const results = await parallelMap(
      allImports,
      async ({ original, path, suffix, start, end, isDynamic, isSideEffect, key }) => {
        const nestedFilePath = await fetchAndCacheModuleFn(path, normalizedPath);
        return {
          original,
          start,
          end,
          suffix,
          isDynamic,
          isSideEffect,
          nestedFilePath,
          [key]: path,
        };
      },
      {
        semaphore: new Semaphore(MAX_MDX_MODULE_TRANSFORM_CONCURRENCY),
      },
    );

    const replacements: SourceSpanReplacement[] = [];
    for (
      const { original, start, end, suffix, isDynamic, isSideEffect, nestedFilePath } of results
    ) {
      if (nestedFilePath) {
        replacements.push({
          start,
          end,
          expected: original,
          replacement: isDynamic
            ? `"file://${nestedFilePath}${suffix ?? ""}"`
            : isSideEffect
            ? `import "file://${nestedFilePath}${suffix ?? ""}"`
            : `from "file://${nestedFilePath}${suffix ?? ""}"`,
        });
      }
    }

    return replaceSourceSpans(moduleCode, replacements);
  } finally {
    clearTimeout(timeout);
  }
}
