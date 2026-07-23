import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { serverLogger } from "#veryfront/utils";
import { renderSnippet } from "#veryfront/rendering/snippet-renderer.ts";
import { SECURITY_VIOLATION, VeryfrontError } from "#veryfront/errors";
import { PathValidationError, validatePath } from "#veryfront/security";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getSafeErrorName } from "../../utils/error-name.ts";
import { createProjectCodeUnavailableResponse } from "../../utils/project-code-isolation.ts";
import {
  resolveSnippetFilePath,
  resolveSnippetModuleServerUrl,
} from "./snippet-request.ts";

const logger = serverLogger.component("snippet-handler");

const PRIORITY_SNIPPET = 450;
const MAX_SNIPPET_SOURCE_BYTES = 4 * 1024 * 1024;

export class SnippetHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SnippetHandler",
    priority: PRIORITY_SNIPPET as HandlerPriority,
    patterns: [{ pattern: /^\/(@\/|@components\/)/, method: "GET" }],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (req.method.toUpperCase() !== "GET") return this.continue();

    const url = new URL(req.url);
    const { pathname } = url;

    if (!pathname.startsWith("/@/") && !pathname.startsWith("/@components/")) {
      return this.continue();
    }

    if (ctx.isLocalProject === false) {
      return this.respond(createProjectCodeUnavailableResponse(req));
    }

    const filePath = resolveSnippetFilePath(pathname);
    let pathResult;
    try {
      pathResult = await validatePath(filePath, {
        adapter: ctx.adapter,
        baseDir: ctx.projectDir,
        checkExists: true,
        level: "strict",
      });
    } catch (error) {
      logger.error("Snippet path validation failed", { errorName: getSafeErrorName(error) });
      return this.respondError(req, ctx, 500, "Snippet is unavailable");
    }

    if (!pathResult.valid) {
      if (pathResult.code === PathValidationError.FILE_NOT_FOUND) {
        return this.respondNotFound(req, ctx);
      }
      logger.warn("Invalid snippet path rejected", { reason: pathResult.code ?? "INVALID_PATH" });
      const error = SECURITY_VIOLATION.create({
        detail: "Invalid snippet path",
      });
      return this.respondError(req, ctx, error.status, "Invalid snippet path");
    }
    const canonicalPath = pathResult.canonicalPath!;

    return this.withProxyContext(ctx, async () => {
      try {
        const stat = await ctx.adapter.fs.stat(canonicalPath);
        if (!stat.isFile) return this.respondNotFound(req, ctx);
        if (stat.size > MAX_SNIPPET_SOURCE_BYTES) {
          return this.respondError(req, ctx, 413, "Snippet source is too large");
        }
        const content = await ctx.adapter.fs.readFile(canonicalPath);
        if (new TextEncoder().encode(content).byteLength > MAX_SNIPPET_SOURCE_BYTES) {
          return this.respondError(req, ctx, 413, "Snippet source is too large");
        }

        const moduleServerUrl = resolveSnippetModuleServerUrl(ctx.moduleServerUrl, url);
        const rawPageId = url.searchParams.get("page_id");
        if (rawPageId && rawPageId.length > 256) {
          return this.respondError(req, ctx, 400, "Invalid page identifier");
        }
        const pageId = rawPageId ?? undefined;
        const isDev = !!ctx.isLocalProject;

        const result = await renderSnippet(content, {
          mode: isDev ? "development" : "production",
          projectId: ctx.projectId ?? ctx.projectDir,
          projectDir: ctx.projectDir,
          filePath: canonicalPath,
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
          isNotFoundError(error) ||
          (error instanceof VeryfrontError && error.status === 404)
        ) {
          return this.respondNotFound(req, ctx);
        }

        logger.error("Snippet rendering failed", { errorName: getSafeErrorName(error) });
        return this.respondError(req, ctx, 500, "Snippet rendering failed");
      }
    });
  }

  private respondNotFound(req: Request, ctx: HandlerContext): HandlerResult {
    return this.respondError(req, ctx, 404, "Snippet not found");
  }

  private respondError(
    req: Request,
    ctx: HandlerContext,
    status: number,
    message: string,
  ): HandlerResult {
    const response = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-cache")
      .json({ error: message }, status);
    return this.respond(response);
  }
}
