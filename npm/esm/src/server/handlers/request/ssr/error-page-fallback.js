import { join as joinPath } from "../../../../platform/compat/path/index.js";
import { serverLogger as logger } from "../../../../utils/index.js";
import { buildErrorPageCacheKey } from "../../../../cache/index.js";
import { computeContentSourceId } from "../../../../cache/keys.js";
import { generateErrorHtml } from "../../../utils/error-html.js";
export async function tryErrorPageFallback(req, ctx, builder, options) {
    const { statusCode, error, pathname } = options;
    try {
        const pagesDir = joinPath(ctx.projectDir, "pages");
        try {
            const st = await ctx.adapter.fs.stat(pagesDir);
            if (!st.isDirectory)
                return null;
        }
        catch {
            return null;
        }
        const specificPage = statusCode === 404
            ? "404"
            : statusCode === 500
                ? "500"
                : null;
        if (specificPage) {
            const ErrorComponent = await tryLoadErrorPage(pagesDir, specificPage, ctx);
            if (ErrorComponent) {
                logger.debug(`[ErrorPageFallback] Found pages/${specificPage}.tsx`);
                return renderErrorPage(req, ctx, builder, ErrorComponent, statusCode, error, pathname);
            }
        }
        const GenericErrorComponent = await tryLoadErrorPage(pagesDir, "_error", ctx);
        if (!GenericErrorComponent)
            return null;
        logger.debug("[ErrorPageFallback] Found pages/_error.tsx");
        return renderErrorPage(req, ctx, builder, GenericErrorComponent, statusCode, error, pathname);
    }
    catch (e) {
        logger.debug("[ErrorPageFallback] Failed to load error page", { error: e });
        return null;
    }
}
const ERROR_PAGE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];
const errorPagePathCache = new Map();
async function tryLoadErrorPage(pagesDir, pageType, ctx) {
    const cacheKey = buildErrorPageCacheKey(ctx.projectId, ctx.projectDir, pageType);
    const cachedPath = errorPagePathCache.get(cacheKey);
    if (cachedPath !== undefined) {
        if (!cachedPath)
            return null;
        try {
            return await loadErrorComponent(cachedPath, ctx);
        }
        catch {
            errorPagePathCache.delete(cacheKey);
        }
    }
    const basePath = joinPath(ctx.projectDir, "pages", pageType);
    if (ctx.adapter.fs.resolveFile) {
        try {
            const resolvedPath = await ctx.adapter.fs.resolveFile(basePath);
            if (!resolvedPath) {
                errorPagePathCache.set(cacheKey, null);
                return null;
            }
            const fullPath = joinPath(ctx.projectDir, resolvedPath);
            const component = await loadErrorComponent(fullPath, ctx);
            if (component) {
                errorPagePathCache.set(cacheKey, fullPath);
                return component;
            }
        }
        catch {
            // fall through
        }
        errorPagePathCache.set(cacheKey, null);
        return null;
    }
    for (const ext of ERROR_PAGE_EXTENSIONS) {
        const filePath = joinPath(pagesDir, `${pageType}${ext}`);
        try {
            const stat = await ctx.adapter.fs.stat(filePath);
            if (!stat.isFile)
                continue;
            const component = await loadErrorComponent(filePath, ctx);
            if (component) {
                errorPagePathCache.set(cacheKey, filePath);
                return component;
            }
        }
        catch {
            // ignore
        }
    }
    errorPagePathCache.set(cacheKey, null);
    return null;
}
async function loadErrorComponent(filePath, ctx) {
    const src = await ctx.adapter.fs.readFile(filePath);
    const { loadComponentFromSource } = await import("../../../../modules/react-loader/component-loader.js");
    const contentSourceId = ctx.enriched?.contentSourceId ??
        computeContentSourceId(ctx.requestContext?.isLocalDev ?? false, ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview", ctx.requestContext?.branch ?? null, ctx.releaseId);
    const Component = await loadComponentFromSource(src, filePath, ctx.projectDir, ctx.adapter, {
        projectId: ctx.projectId ?? ctx.projectDir,
        dev: ctx.requestContext?.isLocalDev ?? false,
        contentSourceId,
    });
    return typeof Component === "function" ? Component : null;
}
async function renderErrorPage(req, ctx, builder, ErrorComponent, statusCode, error, pathname) {
    const React = await import("react");
    const { renderToStringAdapter } = await import("../../../../react/compat/ssr-adapter/index.js");
    const errorProps = { statusCode, err: error, pathname };
    const element = React.createElement(ErrorComponent, errorProps);
    try {
        const inner = await renderToStringAdapter(element);
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
    catch (renderError) {
        logger.debug("[ErrorPageFallback] Failed to render error component", {
            error: renderError,
        });
        const fallbackHtml = generateErrorHtml({
            statusCode,
            title: statusCode === 404 ? "Not Found" : "Server Error",
            message: statusCode === 404
                ? pathname ? `The page "${pathname}" could not be found.` : "Page not found."
                : "An unexpected error occurred.",
            minimal: true,
        });
        return builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .withCache("no-cache")
            .html(fallbackHtml, statusCode);
    }
}
