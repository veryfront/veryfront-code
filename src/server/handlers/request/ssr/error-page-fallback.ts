/**
 * Error Page Fallback Handler
 *
 * Handles Pages Router custom error pages (_error.tsx, 404.tsx, 500.tsx).
 * Searches pages directory for error page components and renders them.
 *
 * @module server/handlers/request/ssr/error-page-fallback
 */

import type * as React from "react";
import type { HandlerContext } from "../../types.ts";
import type { ResponseBuilder } from "#veryfront/security/index.ts";
import { join as joinPath } from "#veryfront/platform/compat/path/index.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { buildErrorPageCacheKey } from "#veryfront/cache";
import { generateErrorHtml } from "../../../utils/error-html.ts";

type ErrorPageType = "404" | "500" | "_error";

interface ErrorPageOptions {
  statusCode: number;
  error?: Error;
  pathname?: string;
}

/**
 * Try rendering custom error page from pages directory
 *
 * Priority order:
 * 1. pages/{statusCode}.tsx (e.g., pages/404.tsx)
 * 2. pages/_error.tsx (generic error handler)
 *
 * @param req - Incoming request
 * @param ctx - Handler context
 * @param builder - Response builder instance
 * @param options - Error options (statusCode, error object, pathname)
 * @returns Response with custom error page or null
 */
export async function tryErrorPageFallback(
  req: Request,
  ctx: HandlerContext,
  builder: ResponseBuilder,
  options: ErrorPageOptions,
): Promise<Response | null> {
  const { statusCode, error, pathname } = options;

  try {
    const pagesDir = joinPath(ctx.projectDir, "pages");

    // Check if pages directory exists
    try {
      const st = await ctx.adapter.fs.stat(pagesDir);
      if (!st.isDirectory) return null;
    } catch {
      return null;
    }

    // Priority 1: Try specific error page (404.tsx, 500.tsx)
    let specificPage: ErrorPageType | null = null;
    if (statusCode === 404) {
      specificPage = "404";
    } else if (statusCode === 500) {
      specificPage = "500";
    }
    if (specificPage) {
      const ErrorComponent = await tryLoadErrorPage(pagesDir, specificPage, ctx);
      if (ErrorComponent) {
        logger.debug(`[ErrorPageFallback] Found pages/${specificPage}.tsx`);
        return await renderErrorPage(
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

    // Priority 2: Try generic _error.tsx
    const GenericErrorComponent = await tryLoadErrorPage(pagesDir, "_error", ctx);
    if (GenericErrorComponent) {
      logger.debug("[ErrorPageFallback] Found pages/_error.tsx");
      return await renderErrorPage(
        req,
        ctx,
        builder,
        GenericErrorComponent,
        statusCode,
        error,
        pathname,
      );
    }
  } catch (e) {
    logger.debug("[ErrorPageFallback] Failed to load error page", { error: e });
  }

  return null;
}

/** Extension priority for error pages */
const ERROR_PAGE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"] as const;

/** Cache for resolved error page paths to avoid repeated lookups */
const errorPagePathCache = new Map<string, string | null>();

/**
 * Try to load an error page component from the pages directory.
 * Uses resolveFile for fast pattern-based file resolution when available.
 */
async function tryLoadErrorPage(
  pagesDir: string,
  pageType: ErrorPageType,
  ctx: HandlerContext,
): Promise<React.ComponentType<unknown> | null> {
  const cacheKey = buildErrorPageCacheKey(ctx.projectId, ctx.projectDir, pageType);

  // Check if we've already resolved (or failed to resolve) this error page
  if (errorPagePathCache.has(cacheKey)) {
    const cachedPath = errorPagePathCache.get(cacheKey);
    if (!cachedPath) {
      return null; // Previously failed to find this error page
    }
    // Try to load from cached path
    try {
      return await loadErrorComponent(cachedPath, ctx);
    } catch {
      // Cache might be stale, clear and try fresh resolution
      errorPagePathCache.delete(cacheKey);
    }
  }

  const basePath = joinPath(ctx.projectDir, "pages", pageType);

  // Use resolveFile if available - this uses the file index and avoids sequential API calls
  if (ctx.adapter.fs.resolveFile) {
    try {
      const resolvedPath = await ctx.adapter.fs.resolveFile(basePath);
      if (resolvedPath) {
        const fullPath = joinPath(ctx.projectDir, resolvedPath);
        const component = await loadErrorComponent(fullPath, ctx);
        if (component) {
          errorPagePathCache.set(cacheKey, fullPath);
          return component;
        }
      }
    } catch {
      // resolveFile not supported or failed, fall through
    }

    // If resolveFile returned null, the file doesn't exist - cache and return
    errorPagePathCache.set(cacheKey, null);
    return null;
  }

  // Fallback for local filesystem: check with stat first, then readFile
  // This avoids slow API calls by using the index when available
  for (const ext of ERROR_PAGE_EXTENSIONS) {
    const filePath = joinPath(pagesDir, `${pageType}${ext}`);
    try {
      const stat = await ctx.adapter.fs.stat(filePath);
      if (stat.isFile) {
        const component = await loadErrorComponent(filePath, ctx);
        if (component) {
          errorPagePathCache.set(cacheKey, filePath);
          return component;
        }
      }
    } catch {
      // File doesn't exist with this extension
    }
  }

  // Cache negative result to avoid repeated lookups
  errorPagePathCache.set(cacheKey, null);
  return null;
}

/**
 * Load a component from a file path
 */
async function loadErrorComponent(
  filePath: string,
  ctx: HandlerContext,
): Promise<React.ComponentType<unknown> | null> {
  const src = await ctx.adapter.fs.readFile(filePath);
  const { loadComponentFromSource } = await import(
    "@veryfront/modules/react-loader/component-loader.ts"
  );
  const Component = await loadComponentFromSource(
    src,
    filePath,
    ctx.projectDir,
    ctx.adapter,
    { projectId: ctx.projectId ?? ctx.projectDir, dev: ctx.requestContext?.isLocalDev ?? false },
  );
  if (typeof Component === "function") {
    return Component as React.ComponentType<unknown>;
  }
  return null;
}

/**
 * Render an error page component to HTML
 */
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
    "@veryfront/react/compat/ssr-adapter/index.ts"
  );

  // Create props for the error component (Next.js-like interface)
  const errorProps = {
    statusCode,
    err: error,
    pathname,
  };

  const element = React.createElement(
    ErrorComponent as React.ComponentType<typeof errorProps>,
    errorProps,
  );
  let inner = "";

  try {
    inner = await renderToStringAdapter(element as React.ReactElement);
  } catch (renderError) {
    logger.debug("[ErrorPageFallback] Failed to render error component", {
      error: renderError,
    });
    // Return null to fall back to default error handling
    const fallbackHtml = generateErrorHtml({
      statusCode,
      title: statusCode === 404 ? "Not Found" : "Server Error",
      message: statusCode === 404
        ? (pathname ? `The page "${pathname}" could not be found.` : "Page not found.")
        : "An unexpected error occurred.",
      minimal: true,
    });
    return builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined)
      .withCache("no-cache")
      .html(fallbackHtml, statusCode);
  }

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
    .withSecurity(ctx.securityConfig ?? undefined)
    .withCache("no-cache")
    .html(html, statusCode);
}

