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
import type { ResponseBuilder } from "@veryfront/security/index.ts";
import { join as joinPath } from "std/path/mod.ts";
import { serverLogger as logger } from "@veryfront/utils";

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
    const specificPage = statusCode === 404 ? "404" : statusCode === 500 ? "500" : null;
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

/**
 * Try to load an error page component from the pages directory
 */
async function tryLoadErrorPage(
  pagesDir: string,
  pageType: ErrorPageType,
  ctx: HandlerContext,
): Promise<React.ComponentType<unknown> | null> {
  const extensions = [".tsx", ".jsx", ".ts", ".js"];

  for (const ext of extensions) {
    const filePath = joinPath(pagesDir, `${pageType}${ext}`);
    try {
      const src = await ctx.adapter.fs.readFile(filePath);
      const { loadComponentFromSource } = await import(
        "@veryfront/modules/react-loader/component-loader.ts"
      );
      const Component = await loadComponentFromSource(
        src,
        filePath,
        ctx.projectDir,
        ctx.adapter,
        { projectId: ctx.projectDir, dev: ctx.mode === "development" },
      );
      if (typeof Component === "function") {
        return Component as React.ComponentType<unknown>;
      }
    } catch {
      // Component not found with this extension, try next
    }
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

  const element = React.createElement(ErrorComponent as React.ComponentType<typeof errorProps>, errorProps);
  let inner = "";

  try {
    inner = await renderToStringAdapter(element as React.ReactElement);
  } catch (renderError) {
    logger.debug("[ErrorPageFallback] Failed to render error component", {
      error: renderError,
    });
    // Return null to fall back to default error handling
    return builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined)
      .withCache("no-cache")
      .html(generateFallbackHtml(statusCode, pathname), statusCode);
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

/**
 * Generate a simple fallback HTML when rendering fails
 */
function generateFallbackHtml(statusCode: number, pathname?: string): string {
  const title = statusCode === 404 ? "Not Found" : "Server Error";
  const message = statusCode === 404
    ? `The page ${pathname ? `"${pathname}" ` : ""}could not be found.`
    : "An unexpected error occurred.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${statusCode} ${title}</title>
</head>
<body>
  <h1>${statusCode} ${title}</h1>
  <p>${message}</p>
</body>
</html>`;
}
