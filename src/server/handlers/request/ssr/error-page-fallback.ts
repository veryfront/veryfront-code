import type * as React from "react";
import type { HandlerContext } from "../../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";
import { isAbsolute, join as joinPath, normalize, relative } from "#veryfront/compat/path/index.ts";
import { getBaseLogger } from "#veryfront/utils";
import { buildErrorPageCacheKey } from "#veryfront/cache";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { generateErrorHtml } from "../../../utils/error-html.ts";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { classifyTelemetryError } from "#veryfront/observability/telemetry-safety.ts";
import { isFallbackDefinitionError } from "./fallback-error-classification.ts";

const logger = getBaseLogger("SERVER").component("error-page-fallback");

type ErrorPageType = "404" | "500" | "_error";

interface ErrorPageOptions {
  statusCode: number;
  error?: Error;
  pathname?: string;
}

/** Injected cache repository for testing */
let injectedCacheRepo: CacheRepository<string> | null = null;

/**
 * Inject a CacheRepository for testing.
 * Call with null to restore default Map-based caching.
 */
export function __injectCacheForTests(
  cacheRepo: CacheRepository<string> | null,
): void {
  injectedCacheRepo = cacheRepo;
}

export async function tryErrorPageFallback(
  req: Request,
  ctx: HandlerContext,
  builder: ResponseBuilder,
  options: ErrorPageOptions,
): Promise<Response | null> {
  const { statusCode } = options;
  const pagesDir = joinPath(
    ctx.projectDir,
    ctx.config?.directories?.pages ?? "pages",
  );

  try {
    const st = await ctx.adapter.fs.stat(pagesDir);
    if (!st.isDirectory) return null;
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    return null;
  }

  const reactVersion = await resolveProjectReactVersion({
    projectDir: ctx.projectDir,
    config: ctx.config,
  });

  const specificPage: ErrorPageType | null = statusCode === 404
    ? "404"
    : statusCode === 500
    ? "500"
    : null;

  if (specificPage) {
    const ErrorComponent = await tryLoadErrorPage(
      pagesDir,
      specificPage,
      ctx,
      reactVersion,
    );
    if (ErrorComponent) {
      logger.debug("Using status-specific custom error page");
      return renderErrorPage(
        req,
        ctx,
        builder,
        ErrorComponent,
        statusCode,
        reactVersion,
      );
    }
  }

  const GenericErrorComponent = await tryLoadErrorPage(
    pagesDir,
    "_error",
    ctx,
    reactVersion,
  );
  if (!GenericErrorComponent) return null;

  logger.debug("Using generic custom error page");
  return renderErrorPage(
    req,
    ctx,
    builder,
    GenericErrorComponent,
    statusCode,
    reactVersion,
  );
}

const ERROR_PAGE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const;
/** Special value to indicate "not found" in cache (distinguishes from cache miss) */
const CACHE_NOT_FOUND = "__NOT_FOUND__";

const errorPagePathCache = new LRUCacheAdapter({ maxEntries: 1000 });

async function getCachedPath(
  cacheKey: string,
): Promise<string | null | undefined> {
  if (!injectedCacheRepo) return errorPagePathCache.get<string | null>(cacheKey);

  const cached = await injectedCacheRepo.get(cacheKey);
  if (cached === CACHE_NOT_FOUND) return null;
  return cached || undefined;
}

async function setCachedPath(cacheKey: string, path: string | null): Promise<void> {
  if (injectedCacheRepo) {
    await injectedCacheRepo.set(cacheKey, path ?? CACHE_NOT_FOUND);
    return;
  }
  errorPagePathCache.set(cacheKey, path);
}

async function deleteCachedPath(cacheKey: string): Promise<void> {
  if (injectedCacheRepo) {
    await injectedCacheRepo.delete(cacheKey);
    return;
  }
  errorPagePathCache.delete(cacheKey);
}

function resolveErrorPagePath(
  resolvedPath: string,
  projectDir: string,
  pagesDir: string,
): string {
  const candidate = normalize(
    isAbsolute(resolvedPath) ? resolvedPath : joinPath(projectDir, resolvedPath),
  );
  const relativePath = relative(normalize(pagesDir), candidate).replaceAll("\\", "/");
  if (
    relativePath === ".." || relativePath.startsWith("../") ||
    isAbsolute(relativePath)
  ) {
    throw new TypeError("Resolved error page is outside the configured pages directory");
  }
  return candidate;
}

type ErrorPageCandidate =
  | { kind: "found"; component: React.ComponentType<unknown> }
  | { kind: "missing" }
  | { kind: "invalid" };

async function loadErrorPageCandidate(
  filePath: string,
  ctx: HandlerContext,
  reactVersion: string,
): Promise<ErrorPageCandidate> {
  let source: string;
  try {
    source = await ctx.adapter.fs.readFile(filePath);
  } catch (error) {
    if (isNotFoundError(error)) return { kind: "missing" };
    throw error;
  }

  try {
    const component = await loadErrorComponent(source, filePath, ctx, reactVersion);
    return { kind: "found", component };
  } catch (error) {
    if (!isFallbackDefinitionError(error)) throw error;

    logger.warn("Custom error page could not be loaded", {
      errorCategory: classifyTelemetryError(error),
    });
    return { kind: "invalid" };
  }
}

async function tryLoadErrorPage(
  pagesDir: string,
  pageType: ErrorPageType,
  ctx: HandlerContext,
  reactVersion: string,
): Promise<React.ComponentType<unknown> | null> {
  const cacheKey = buildErrorPageCacheKey(ctx.projectId, ctx.projectDir, pageType);

  const cachedPath = await getCachedPath(cacheKey);
  if (cachedPath !== undefined) {
    if (!cachedPath) return null;

    const resolvedCachedPath = resolveErrorPagePath(
      cachedPath,
      ctx.projectDir,
      pagesDir,
    );
    const cachedCandidate = await loadErrorPageCandidate(
      resolvedCachedPath,
      ctx,
      reactVersion,
    );
    if (cachedCandidate.kind === "found") return cachedCandidate.component;

    await deleteCachedPath(cacheKey);
    if (cachedCandidate.kind === "invalid") return null;
  }

  const basePath = joinPath(pagesDir, pageType);

  if (ctx.adapter.fs.resolveFile) {
    let resolvedPath: string | null;
    try {
      resolvedPath = await ctx.adapter.fs.resolveFile(basePath);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      resolvedPath = null;
    }

    if (!resolvedPath) {
      await setCachedPath(cacheKey, null);
      return null;
    }

    const fullPath = resolveErrorPagePath(resolvedPath, ctx.projectDir, pagesDir);
    const candidate = await loadErrorPageCandidate(fullPath, ctx, reactVersion);
    if (candidate.kind === "found") {
      await setCachedPath(cacheKey, fullPath);
      return candidate.component;
    }
    if (candidate.kind === "missing") await setCachedPath(cacheKey, null);
    return null;
  }

  for (const ext of ERROR_PAGE_EXTENSIONS) {
    const filePath = joinPath(pagesDir, `${pageType}${ext}`);
    let isFile: boolean;
    try {
      isFile = (await ctx.adapter.fs.stat(filePath)).isFile;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      continue;
    }
    if (!isFile) continue;

    const candidate = await loadErrorPageCandidate(filePath, ctx, reactVersion);
    if (candidate.kind === "found") {
      await setCachedPath(cacheKey, filePath);
      return candidate.component;
    }
    if (candidate.kind === "invalid") return null;
  }

  await setCachedPath(cacheKey, null);
  return null;
}

async function loadErrorComponent(
  source: string,
  filePath: string,
  ctx: HandlerContext,
  reactVersion: string,
): Promise<React.ComponentType<unknown>> {
  const { loadComponentFromSource } = await import(
    "#veryfront/modules/react-loader/component-loader.ts"
  );

  const isLocal = !!ctx.isLocalProject;
  const contentSourceId = ctx.enriched?.contentSourceId ??
    computeContentSourceId(
      isLocal,
      ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview",
      ctx.requestContext?.branch ?? null,
      ctx.releaseId,
    );

  const Component = await loadComponentFromSource(
    source,
    filePath,
    ctx.projectDir,
    ctx.adapter,
    {
      projectId: ctx.projectId ?? ctx.projectDir,
      dev: false,
      contentSourceId,
      reactVersion,
    },
  );

  return Component as React.ComponentType<unknown>;
}

async function renderErrorPage(
  req: Request,
  ctx: HandlerContext,
  builder: ResponseBuilder,
  ErrorComponent: React.ComponentType<unknown>,
  statusCode: number,
  reactVersion?: string,
): Promise<Response> {
  const { getProjectReact, getReactDOMServer, renderToStringAdapter } = await import(
    "#veryfront/react/compat/ssr-adapter/index.ts"
  );
  const [React] = await Promise.all([
    getProjectReact(reactVersion),
    getReactDOMServer(reactVersion),
  ]);

  const errorProps = { statusCode, err: undefined, pathname: undefined };

  const element = React.createElement(
    ErrorComponent as React.ComponentType<typeof errorProps>,
    errorProps,
  );

  try {
    const inner = await renderToStringAdapter(element as React.ReactElement, {
      reactVersion,
    });

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${statusCode} Error</title>
</head>
<body>${inner}</body>
</html>`;

    return builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-cache")
      .html(html, statusCode);
  } catch (error) {
    logger.warn("Custom error page render failed", {
      errorCategory: classifyTelemetryError(error),
    });

    const title = statusCode === 404 ? "Not Found" : "Server Error";
    const message = statusCode === 404 ? "Page not found." : "An unexpected error occurred.";

    const fallbackHtml = generateErrorHtml({
      statusCode,
      title,
      message,
      minimal: true,
    });

    return builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-cache")
      .html(fallbackHtml, statusCode);
  }
}
