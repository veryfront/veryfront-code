import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { serverLogger as logger } from "#veryfront/utils";
import { renderSnippet } from "#veryfront/rendering/snippet-renderer.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { VeryfrontAPIError } from "#veryfront/platform/adapters/veryfront-api-client/types.ts";

const PRIORITY_SNIPPET = 450;

export class SnippetHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SnippetHandler",
    priority: PRIORITY_SNIPPET as HandlerPriority,
    patterns: [{ pattern: /^\/(@\/|@components\/)/, method: "GET" }],
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const { pathname } = url;

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
        const pageId = url.searchParams.get("page_id") ?? undefined;
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
        if (error instanceof VeryfrontAPIError && error.status === 404) {
          logger.debug("[SnippetHandler] Snippet file not found", { filePath });
        } else {
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

  private resolveFilePath(pathname: string): string {
    if (!pathname.startsWith("/@components/")) return pathname.replace("/@/", "");

    let filePath = pathname.replace("/@components/", "components/");
    if (!filePath.endsWith(".snippet.mdx")) filePath += ".snippet.mdx";
    return filePath;
  }

  private getModuleServerUrl(moduleServerUrl: string | undefined, url: URL): string {
    const isFullUrl = moduleServerUrl?.startsWith("http://") ||
      moduleServerUrl?.startsWith("https://");
    return isFullUrl ? moduleServerUrl! : `${url.protocol}//${url.host}`;
  }

  private respondNotFound(ctx: HandlerContext, filePath: string): HandlerResult {
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
}
