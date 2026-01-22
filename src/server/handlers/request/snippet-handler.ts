/**
 * Snippet Handler
 *
 * Handles preview requests for component snippets (@/ prefixed paths).
 * These are MDX files that get compiled and rendered as standalone component previews.
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
// Priority 450 - before static (500) to handle @/ component previews first
const PRIORITY_SNIPPET = 450;
import { serverLogger as logger } from "#veryfront/utils";
import { renderSnippet } from "#veryfront/rendering/snippet-renderer.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { VeryfrontAPIError } from "#veryfront/platform/adapters/veryfront-api-client/types.ts";
import { isLocalDev } from "../../context/request-context.ts";

/**
 * SnippetHandler handles @/ and @components/ prefixed paths.
 * These are component snippets that need to be rendered as previews.
 */
export class SnippetHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SnippetHandler",
    priority: PRIORITY_SNIPPET as HandlerPriority, // Before static (500), after dev handlers
    patterns: [{ pattern: /^\/(@\/|@components\/)/, method: "GET" }],
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Only handle @/ and @components/ paths
    if (!pathname.startsWith("/@/") && !pathname.startsWith("/@components/")) {
      return Promise.resolve(this.continue());
    }

    logger.debug("[SnippetHandler] Handling snippet request", {
      pathname,
      projectSlug: ctx.projectSlug,
    });

    // Strip the @/ or @components/ prefix to get the file path
    let filePath: string;
    if (pathname.startsWith("/@components/")) {
      // @components/Button -> components/Button.snippet.mdx
      // But if path already ends with .snippet.mdx, don't add it again
      filePath = pathname.replace("/@components/", "components/");
      if (!filePath.endsWith(".snippet.mdx")) {
        filePath += ".snippet.mdx";
      }
    } else {
      // @/components/Button.snippet.mdx -> components/Button.snippet.mdx
      filePath = pathname.replace("/@/", "");
    }

    logger.debug("[SnippetHandler] Resolved file path", { filePath });

    // Use proxy context if available
    return this.withProxyContext(ctx, async () => {
      try {
        // Read the file content through the adapter
        const content = await ctx.adapter.fs.readFile(filePath);

        if (!content) {
          logger.debug("[SnippetHandler] File not found or empty", { filePath });
          const builder = this.createResponseBuilder(ctx);
          return this.respond(
            builder
              .withCache("no-cache")
              .withContentType(
                "application/json",
                JSON.stringify({ error: "Snippet not found", path: filePath }),
                404,
              ),
          );
        }

        // Get module server URL from context or request
        // ctx.moduleServerUrl may be just a path like "/_vf_modules", we need a full URL for SSR
        const isFullUrl = ctx.moduleServerUrl?.startsWith("http://") ||
          ctx.moduleServerUrl?.startsWith("https://");
        const moduleServerUrl = isFullUrl ? ctx.moduleServerUrl : `${url.protocol}//${url.host}`;

        // Get page_id from URL params (passed by Studio for postMessage communication)
        const pageId = url.searchParams.get("page_id") || undefined;

        // Render the MDX snippet to HTML
        const isDev = isLocalDev();
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

        // Return rendered HTML
        const builder = this.createResponseBuilder(ctx);
        // In local dev mode, relax COOP/CORP headers to allow Studio iframe embedding
        return this.respond(
          builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .withHeaders(
              isDev
                ? {
                  "Cross-Origin-Opener-Policy": "unsafe-none",
                  "Cross-Origin-Resource-Policy": "cross-origin",
                }
                : {},
            )
            .withCache("no-cache")
            .withContentType("text/html; charset=utf-8", result.html, 200),
        );
      } catch (error) {
        // Return 404 directly for file-not-found errors instead of falling through to SSR handler
        // This prevents 30s timeouts when snippet files don't exist
        const is404 = error instanceof VeryfrontAPIError && error.status === 404;

        if (is404) {
          logger.debug("[SnippetHandler] Snippet file not found", { filePath });
        } else {
          logger.error("[SnippetHandler] Error rendering snippet", {
            filePath,
            error: getErrorMessage(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }

        const builder = this.createResponseBuilder(ctx);
        return this.respond(
          builder
            .withCache("no-cache")
            .withContentType(
              "application/json",
              JSON.stringify({ error: "Snippet not found", path: filePath }),
              404,
            ),
        );
      }
    });
  }
}
