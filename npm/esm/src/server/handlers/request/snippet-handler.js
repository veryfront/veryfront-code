import { BaseHandler } from "../response/base.js";
import { serverLogger as logger } from "../../../utils/index.js";
import { renderSnippet } from "../../../rendering/snippet-renderer.js";
import { getErrorMessage } from "../../../errors/veryfront-error.js";
import { VeryfrontAPIError } from "../../../platform/adapters/veryfront-api-client/types.js";
// Priority 450 - before static (500) to handle @/ component previews first
const PRIORITY_SNIPPET = 450;
export class SnippetHandler extends BaseHandler {
    metadata = {
        name: "SnippetHandler",
        priority: PRIORITY_SNIPPET,
        patterns: [{ pattern: /^\/(@\/|@components\/)/, method: "GET" }],
    };
    handle(req, ctx) {
        const url = new URL(req.url);
        const pathname = url.pathname;
        if (!pathname.startsWith("/@/") && !pathname.startsWith("/@components/")) {
            return Promise.resolve(this.continue());
        }
        logger.debug("[SnippetHandler] Handling snippet request", {
            pathname,
            projectSlug: ctx.projectSlug,
        });
        const filePath = this.resolveFilePath(pathname);
        logger.debug("[SnippetHandler] Resolved file path", { filePath });
        return this.withProxyContext(ctx, async () => {
            try {
                const content = await ctx.adapter.fs.readFile(filePath);
                if (!content) {
                    logger.debug("[SnippetHandler] File not found or empty", { filePath });
                    return this.respondNotFound(ctx, filePath);
                }
                const moduleServerUrl = this.getModuleServerUrl(ctx.moduleServerUrl, url);
                const pageId = url.searchParams.get("page_id") || undefined;
                const isDev = ctx.requestContext?.isLocalDev ?? false;
                const result = await renderSnippet(content, {
                    mode: isDev ? "development" : "production",
                    projectDir: ctx.projectDir,
                    filePath,
                    moduleServerUrl,
                    projectSlug: ctx.projectSlug,
                    config: ctx.config,
                    pageId,
                });
                logger.debug("[SnippetHandler] Snippet rendered", {
                    htmlLength: result.html.length,
                });
                const builder = this.createResponseBuilder(ctx);
                return this.respond(builder
                    .withCORS(req, ctx.securityConfig?.cors)
                    .withSecurity(ctx.securityConfig ?? undefined)
                    .withHeaders(isDev
                    ? {
                        "Cross-Origin-Opener-Policy": "unsafe-none",
                        "Cross-Origin-Resource-Policy": "cross-origin",
                    }
                    : {})
                    .withCache("no-cache")
                    .withContentType("text/html; charset=utf-8", result.html, 200));
            }
            catch (error) {
                const is404 = error instanceof VeryfrontAPIError && error.status === 404;
                if (is404) {
                    logger.debug("[SnippetHandler] Snippet file not found", { filePath });
                }
                else {
                    logger.error("[SnippetHandler] Error rendering snippet", {
                        filePath,
                        error: getErrorMessage(error),
                        stack: error instanceof Error ? error.stack : undefined,
                    });
                }
                return this.respondNotFound(ctx, filePath);
            }
        });
    }
    resolveFilePath(pathname) {
        if (pathname.startsWith("/@components/")) {
            let filePath = pathname.replace("/@components/", "components/");
            if (!filePath.endsWith(".snippet.mdx"))
                filePath += ".snippet.mdx";
            return filePath;
        }
        return pathname.replace("/@/", "");
    }
    getModuleServerUrl(moduleServerUrl, url) {
        const isFullUrl = moduleServerUrl?.startsWith("http://") ||
            moduleServerUrl?.startsWith("https://");
        return isFullUrl ? moduleServerUrl : `${url.protocol}//${url.host}`;
    }
    respondNotFound(ctx, filePath) {
        const builder = this.createResponseBuilder(ctx);
        return this.respond(builder
            .withCache("no-cache")
            .withContentType("application/json", JSON.stringify({ error: "Snippet not found", path: filePath }), 404));
    }
}
