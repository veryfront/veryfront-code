import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { serverLogger } from "#veryfront/utils";
import { renderSnippet } from "#veryfront/rendering/snippet-renderer.ts";
import { getErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { FILE_NOT_FOUND, SECURITY_VIOLATION } from "#veryfront/errors/error-registry.ts";
import { createErrorResponse } from "#veryfront/errors/http-error.ts";
import { validatePathSync } from "#veryfront/security";

const logger = serverLogger.component("snippet-handler");

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

    logger.debug("Handling snippet request", {
      pathname,
      projectSlug: ctx.projectSlug,
    });

    const filePath = this.resolveFilePath(pathname);

    const pathResult = validatePathSync(filePath, {
      baseDir: ctx.projectDir,
    });

    if (!pathResult.valid) {
      logger.warn("Path traversal blocked in snippet request", { pathname, filePath });
      const error = SECURITY_VIOLATION.create({
        detail: "Invalid snippet path",
      });
      return Promise.resolve({ response: createErrorResponse(error) });
    }

    logger.debug("Resolved file path", { filePath });

    return this.withProxyContext(ctx, async () => {
      try {
        const content = await ctx.adapter.fs.readFile(filePath);

        if (!content) {
          logger.debug("File not found or empty", { filePath });
          return this.respondNotFound(ctx, filePath);
        }

        const moduleServerUrl = this.getModuleServerUrl(ctx.moduleServerUrl, url);
        const pageId = url.searchParams.get("page_id") ?? undefined;
        const isDev = !!ctx.isLocalProject;

        const result = await renderSnippet(content, {
          mode: isDev ? "development" : "production",
          projectDir: ctx.projectDir,
          filePath,
          moduleServerUrl,
          projectSlug: ctx.projectSlug,
          config: ctx.config,
          pageId,
        });

        logger.debug("Snippet rendered", {
          htmlLength: result.html.length,
        });

        const builder = this.createResponseBuilder(ctx);

        return this.respond(
          builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined, req)
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
        if (
          error instanceof VeryfrontError && error.slug === "api-client-error" &&
          error.status === 404
        ) {
          logger.debug("Snippet file not found", { filePath });
        } else {
          logger.error("Error rendering snippet", {
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

  private respondNotFound(_ctx: HandlerContext, filePath: string): HandlerResult {
    const error = FILE_NOT_FOUND.create({
      detail: `Snippet file not found: ${filePath}`,
      context: { path: filePath },
    });
    const response = createErrorResponse(error);
    response.headers.set("Cache-Control", "no-cache");
    return { response };
  }
}
