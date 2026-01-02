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
import { serverLogger as logger } from "@veryfront/utils";
import { renderSnippet } from "@veryfront/rendering/snippet-renderer.ts";

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

    logger.info("[SnippetHandler] Handling snippet request", {
      pathname,
      projectSlug: ctx.projectSlug,
      hasProxyToken: !!ctx.proxyToken,
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

    logger.info("[SnippetHandler] Resolved file path", { filePath });

    // Use proxy context if available
    return this.withProxyContext(ctx, async () => {
      try {
        logger.info("[SnippetHandler] Reading file through adapter", { filePath });

        // Read the file content through the adapter
        const content = await ctx.adapter.fs.readFile(filePath);

        logger.info("[SnippetHandler] File read result", {
          filePath,
          hasContent: !!content,
          contentLength: content?.length ?? 0,
        });

        if (!content) {
          logger.warn("[SnippetHandler] File not found or empty", { filePath });
          return this.continue();
        }

        // Get module server URL from context or request
        // ctx.moduleServerUrl may be just a path like "/_vf_modules", we need a full URL for SSR
        const isFullUrl = ctx.moduleServerUrl?.startsWith("http://") ||
          ctx.moduleServerUrl?.startsWith("https://");
        const moduleServerUrl = isFullUrl ? ctx.moduleServerUrl : `${url.protocol}//${url.host}`;

        // Get page_id from URL params (passed by Studio for postMessage communication)
        const pageId = url.searchParams.get("page_id") || undefined;

        // Render the MDX snippet to HTML
        const result = await renderSnippet(content, {
          mode: ctx.mode || "development",
          projectDir: ctx.projectDir,
          filePath,
          moduleServerUrl,
          projectSlug: ctx.projectSlug,
          config: ctx.config,
          pageId,
        });

        logger.info("[SnippetHandler] Snippet rendered", {
          htmlLength: result.html.length,
          hasFrontmatter: Object.keys(result.frontmatter).length > 0,
        });

        // Return rendered HTML
        const builder = this.createResponseBuilder(ctx);
        // In development mode, relax COOP/CORP headers to allow Studio iframe embedding
        const isDev = ctx.mode === "development";
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
        logger.error("[SnippetHandler] Error rendering snippet", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        return this.continue();
      }
    });
  }

  private withProxyContext<T>(
    ctx: HandlerContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const fsWrapper = ctx.adapter.fs as {
      runWithContext?: <T>(
        slug: string,
        token: string,
        fn: () => Promise<T>,
      ) => Promise<T>;
      setRequestBranch?: (b: string | null) => void;
    };

    // Set branch context from parsed domain (for branch-aware file resolution)
    if (typeof fsWrapper.setRequestBranch === "function") {
      const branch = ctx.parsedDomain?.branch ?? null;
      fsWrapper.setRequestBranch(branch);
    }

    if (!ctx.projectSlug) {
      return fn();
    }

    if (typeof fsWrapper.runWithContext === "function") {
      this.logDebug("Using multi-project context", { projectSlug: ctx.projectSlug }, ctx);
      return fsWrapper.runWithContext(ctx.projectSlug, ctx.proxyToken || "", fn);
    }

    return fn();
  }
}
