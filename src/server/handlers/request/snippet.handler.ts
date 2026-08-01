import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { serverLogger } from "#veryfront/utils";
import { renderSnippet } from "#veryfront/rendering/snippet-renderer.ts";
import { createErrorResponse, FILE_NOT_FOUND, SECURITY_VIOLATION } from "#veryfront/errors";
import { isCanonicalNotFoundError } from "#veryfront/platform/compat/not-found-error.ts";
import { validatePath } from "#veryfront/security";
import {
  createHandlerDependencyPinningSource,
  getHandlerDependencyPinningIdentity,
} from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";

const logger = serverLogger.component("snippet-handler");

const PRIORITY_SNIPPET = 450;

export class SnippetHandler extends BaseHandler {
  constructor(private readonly snippetRenderer: typeof renderSnippet = renderSnippet) {
    super();
  }

  metadata: HandlerMetadata = {
    name: "SnippetHandler",
    priority: PRIORITY_SNIPPET as HandlerPriority,
    patterns: [{ pattern: /^\/(@\/|@components\/)/, method: "GET" }],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const { pathname } = url;

    if (!pathname.startsWith("/@/") && !pathname.startsWith("/@components/")) {
      return this.continue();
    }

    logger.debug("Handling snippet request", {
      pathname,
      projectSlug: ctx.projectSlug,
    });

    const filePath = this.resolveFilePath(pathname);

    const pathResult = await validatePath(filePath, {
      baseDir: ctx.projectDir,
      adapter: ctx.adapter,
      level: "strict",
      allowAbsolute: false,
    });

    if (!pathResult.valid || !pathResult.canonicalPath) {
      logger.warn("Path traversal blocked in snippet request", { pathname, filePath });
      const error = SECURITY_VIOLATION.create({
        detail: "Invalid snippet path",
      });
      return { response: createErrorResponse(error) };
    }
    const admittedPath = pathResult.canonicalPath;

    logger.debug("Resolved file path", { filePath: admittedPath });

    return await this.withProxyContext(ctx, async () => {
      let content: string;
      try {
        content = await ctx.adapter.fs.readFile(admittedPath);
      } catch (error) {
        if (!isCanonicalNotFoundError(error)) throw error;
        logger.debug("Snippet file not found", { filePath });
        return this.respondNotFound(ctx, filePath);
      }

      const moduleServerUrl = this.getModuleServerUrl(ctx.moduleServerUrl, url);
      const pageId = url.searchParams.get("page_id") ?? undefined;
      const isDev = !!ctx.isLocalProject;
      const dependencyIdentity = getHandlerDependencyPinningIdentity(ctx);

      const result = await this.snippetRenderer(content, {
        mode: isDev ? "development" : "production",
        projectDir: ctx.projectDir,
        adapter: ctx.adapter,
        isLocalProject: ctx.isLocalProject,
        projectId: dependencyIdentity.projectId,
        contentSourceId: dependencyIdentity.contentSourceId,
        dependencyPinningSource: createHandlerDependencyPinningSource(ctx),
        filePath: admittedPath,
        moduleServerUrl,
        projectSlug: dependencyIdentity.projectSlug,
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
