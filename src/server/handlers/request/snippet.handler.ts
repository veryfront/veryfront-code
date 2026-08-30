import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { serverLogger } from "#veryfront/utils";
import { renderSnippet } from "#veryfront/rendering/snippet-renderer.ts";
import {
  createErrorResponse,
  FILE_NOT_FOUND,
  getErrorMessage,
  SECURITY_VIOLATION,
  VeryfrontError,
} from "#veryfront/errors";
import { validatePath, ValidationPresets } from "#veryfront/security";
import { requiresIsolatedProjectRuntime } from "#veryfront/security/project-locality.ts";
import {
  createHandlerDependencyPinningSource,
  getHandlerDependencyPinningIdentity,
} from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import { buildProjectExecutionUnavailableResponse } from "#veryfront/server/handlers/utils/project-execution-unavailable.ts";

const logger = serverLogger.component("snippet-handler");

const PRIORITY_SNIPPET = 450;

export interface SnippetHandlerDeps {
  renderSnippet: typeof renderSnippet;
}

const defaultDeps: SnippetHandlerDeps = { renderSnippet };

export class SnippetHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SnippetHandler",
    priority: PRIORITY_SNIPPET as HandlerPriority,
    patterns: [{ pattern: /^\/(@\/|@components\/)/, method: "GET" }],
  };

  constructor(private readonly deps: SnippetHandlerDeps = defaultDeps) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const { pathname } = url;

    if (!pathname.startsWith("/@/") && !pathname.startsWith("/@components/")) {
      return this.continue();
    }

    if (requiresIsolatedProjectRuntime(ctx)) {
      return this.respond(
        buildProjectExecutionUnavailableResponse(this.helpers, req, ctx, {
          detail:
            "Shared runtimes require a dedicated isolated project runtime for snippet rendering",
          instance: pathname,
        }),
      );
    }

    logger.debug("Handling snippet request", {
      pathname,
      projectSlug: ctx.projectSlug,
    });

    const filePath = this.resolveFilePath(pathname);

    logger.debug("Resolved file path", { filePath });

    return this.withProxyContext(ctx, async () => {
      try {
        const fs = ctx.adapter.fs;
        const stableAdapter = { fs } as typeof ctx.adapter;
        const pathResult = await validatePath(filePath, {
          ...ValidationPresets.internal(ctx.projectDir),
          adapter: stableAdapter,
        });

        if (!pathResult.valid || !pathResult.canonicalPath) {
          logger.warn("Path traversal blocked in snippet request", { pathname, filePath });
          const error = SECURITY_VIOLATION.create({
            detail: "Invalid snippet path",
          });
          return { response: createErrorResponse(error) };
        }

        const admittedPath = pathResult.canonicalPath;
        const content = await fs.readFile(admittedPath);

        if (!content) {
          logger.debug("File not found or empty", { filePath });
          return this.respondNotFound(ctx, admittedPath);
        }

        const moduleServerUrl = this.getModuleServerUrl(ctx.moduleServerUrl, url);
        const pageId = url.searchParams.get("page_id") ?? undefined;
        const isDev = !!ctx.isLocalProject;
        const dependencyIdentity = getHandlerDependencyPinningIdentity(ctx);

        const result = await this.deps.renderSnippet(content, {
          mode: isDev ? "development" : "production",
          projectDir: ctx.projectDir,
          adapter: stableAdapter,
          isLocalProject: ctx.isLocalProject,
          projectId: dependencyIdentity.projectId,
          contentSourceId: dependencyIdentity.contentSourceId,
          releaseId: dependencyIdentity.releaseId,
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
