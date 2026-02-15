import type * as React from "react";
import type { HandlerContext } from "../../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";
import { join as joinPath } from "#veryfront/compat/path/index.ts";
import { serverLogger } from "#veryfront/utils";
import { buildErrorPageCacheKey } from "#veryfront/cache";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { generateErrorHtml } from "../../../utils/error-html.ts";

const logger = serverLogger.component("error-page-fallback");

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
  const { statusCode, error, pathname } = options;

  try {
    const pagesDir = joinPath(ctx.projectDir, "pages");

    try {
      const st = await ctx.adapter.fs.stat(pagesDir);
      if (!st.isDirectory) return null;
    } catch {
      return null;
    }

    const specificPage: ErrorPageType | null = statusCode === 404
      ? "404"
      : statusCode === 500
      ? "500"
      : null;

    if (specificPage) {
      const ErrorComponent = await tryLoadErrorPage(pagesDir, specificPage, ctx);
      if (ErrorComponent) {
        logger.debug(`Found pages/${specificPage}.tsx`);
        return renderErrorPage(
          req,
          ctx,
          builder,
          ErrorComponent,
          statusCode,
          error,
          pathname,
        );
      }
    }

    const GenericErrorComponent = await tryLoadErrorPage(pagesDir, "_error", ctx);
    if (!GenericErrorComponent) return null;

    logger.debug("Found pages/_error.tsx");
    return renderErrorPage(
      req,
      ctx,
      builder,
      GenericErrorComponent,
      statusCode,
      error,
      pathname,
    );
  } catch (e) {
    logger.debug("Failed to load error page", { error: e });
    return null;
  }
}

const ERROR_PAGE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const;
/** Special value to indicate "not found" in cache (distinguishes from cache miss) */
const CACHE_NOT_FOUND = "__NOT_FOUND__";

const errorPagePathCache = new Map<string, string | null>();

async function getCachedPath(
  cacheKey: string,
): Promise<string | null | undefined> {
  if (!injectedCacheRepo) return errorPagePathCache.get(cacheKey);

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

async function tryLoadErrorPage(
  pagesDir: string,
  pageType: ErrorPageType,
  ctx: HandlerContext,
): Promise<React.ComponentType<unknown> | null> {
  const cacheKey = buildErrorPageCacheKey(ctx.projectId, ctx.projectDir, pageType);

  const cachedPath = await getCachedPath(cacheKey);
  if (cachedPath !== undefined) {
    if (!cachedPath) return null;

    try {
      return await loadErrorComponent(cachedPath, ctx);
    } catch {
      await deleteCachedPath(cacheKey);
    }
  }

  const basePath = joinPath(ctx.projectDir, "pages", pageType);

  if (ctx.adapter.fs.resolveFile) {
    try {
      const resolvedPath = await ctx.adapter.fs.resolveFile(basePath);
      if (!resolvedPath) {
        await setCachedPath(cacheKey, null);
        return null;
      }

      const fullPath = joinPath(ctx.projectDir, resolvedPath);
      const component = await loadErrorComponent(fullPath, ctx);
      if (component) {
        await setCachedPath(cacheKey, fullPath);
        return component;
      }
    } catch {
      // fall through
    }

    await setCachedPath(cacheKey, null);
    return null;
  }

  for (const ext of ERROR_PAGE_EXTENSIONS) {
    const filePath = joinPath(pagesDir, `${pageType}${ext}`);
    try {
      const stat = await ctx.adapter.fs.stat(filePath);
      if (!stat.isFile) continue;

      const component = await loadErrorComponent(filePath, ctx);
      if (component) {
        await setCachedPath(cacheKey, filePath);
        return component;
      }
    } catch {
      // ignore
    }
  }

  await setCachedPath(cacheKey, null);
  return null;
}

async function loadErrorComponent(
  filePath: string,
  ctx: HandlerContext,
): Promise<React.ComponentType<unknown> | null> {
  const src = await ctx.adapter.fs.readFile(filePath);
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
    src,
    filePath,
    ctx.projectDir,
    ctx.adapter,
    {
      projectId: ctx.projectId ?? ctx.projectDir,
      dev: isLocal,
      contentSourceId,
    },
  );

  return typeof Component === "function" ? (Component as React.ComponentType<unknown>) : null;
}

async function renderErrorPage(
  req: Request,
  ctx: HandlerContext,
  builder: ResponseBuilder,
  ErrorComponent: React.ComponentType<unknown>,
  statusCode: number,
  error?: Error,
  pathname?: string,
): Promise<Response> {
  const React = await import("react");
  const { renderToStringAdapter } = await import(
    "#veryfront/react/compat/ssr-adapter/index.ts"
  );

  const errorProps = { statusCode, err: error, pathname };

  const element = React.createElement(
    ErrorComponent as React.ComponentType<typeof errorProps>,
    errorProps,
  );

  try {
    const inner = await renderToStringAdapter(element as React.ReactElement);

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
  } catch (renderError) {
    logger.debug("Failed to render error component", {
      error: renderError,
    });

    const title = statusCode === 404 ? "Not Found" : "Server Error";
    let message = "An unexpected error occurred.";
    if (statusCode === 404) {
      message = pathname ? `The page "${pathname}" could not be found.` : "Page not found.";
    }

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
