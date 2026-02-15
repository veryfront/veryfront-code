import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { joinPath, normalizePath } from "#veryfront/utils/path-utils.ts";
import { createSecureFs } from "#veryfront/security";
import { computeEtag, hasMatchingEtag } from "../utils/etag.ts";
import {
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_MEDIUM_LIB_MODULES,
} from "#veryfront/utils/constants/index.ts";

const ALLOWED_MODULES = new Set(["chat.js", "markdown.js", "mdx.js"]);
const LIB_PREFIX = "/_veryfront/lib/";

export class LibModulesHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "LibModulesHandler",
    priority: PRIORITY_MEDIUM_LIB_MODULES as HandlerPriority,
    patterns: [
      { pattern: /^\/_veryfront\/lib\//, method: "GET" },
      { pattern: /^\/_veryfront\/lib\//, method: "HEAD" },
    ],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return this.continue();

    const pathname = new URL(req.url).pathname;
    if (!pathname.startsWith(LIB_PREFIX)) return this.continue();

    const moduleResolution = ctx.config?.client?.moduleResolution ?? "cdn";
    if (moduleResolution !== "self-hosted") {
      this.logDebug(
        "LibModulesHandler: self-hosted mode not enabled, skipping",
        { moduleResolution },
        ctx,
      );
      return this.continue();
    }

    const modulePath = pathname.slice(LIB_PREFIX.length);
    if (!ALLOWED_MODULES.has(modulePath)) {
      this.logDebug(
        `LibModulesHandler: module not allowed: ${modulePath}`,
        { allowed: Array.from(ALLOWED_MODULES) },
        ctx,
      );
      return this.respondNotFound(req, ctx, method);
    }

    const filePath = this.resolveModulePath(modulePath, ctx.projectDir);
    if (!filePath) return this.continue();

    try {
      const secureFs = createSecureFs({
        baseDir: ctx.projectDir,
        adapter: ctx.adapter,
        context: "internal",
        throwOnError: false,
        validationOptions: {
          allowedDirs: ["node_modules"],
          allowAbsolute: true,
        },
      });

      const content = await secureFs.readFile(filePath);
      const etag = computeEtag(content);

      const builder = this.createResponseBuilder(ctx).withCORS(req, ctx.securityConfig?.cors);

      if (hasMatchingEtag(req, etag)) {
        return this.respond(
          builder.withSecurity(ctx.securityConfig ?? undefined, req).notModified(etag),
        );
      }

      const isDev = !!ctx.isLocalProject;
      const body = method === "HEAD" ? null : content;

      this.logDebug(
        `LibModulesHandler: served ${modulePath}`,
        { size: content.length, filePath },
        ctx,
      );

      return this.respond(
        builder
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache(isDev ? "no-cache" : "immutable")
          .withETag(etag)
          .withContentType("application/javascript; charset=utf-8", body, HTTP_OK),
      );
    } catch (error) {
      this.logDebug(
        `LibModulesHandler: failed to serve ${modulePath}: ${this.getErrorMessage(error)}`,
        { filePath },
        ctx,
      );
      return this.respondNotFound(req, ctx, method);
    }
  }

  private respondNotFound(req: Request, ctx: HandlerContext, method: string): HandlerResult {
    const builder = this.createResponseBuilder(ctx);
    return this.respond(
      builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withCache("no-cache")
        .withContentType(
          "text/plain; charset=utf-8",
          method === "HEAD" ? null : "Module not found",
          HTTP_NOT_FOUND,
        ),
    );
  }

  private resolveModulePath(module: string, projectDir: string): string | null {
    if (!ALLOWED_MODULES.has(module)) return null;

    const distDir = joinPath(joinPath(joinPath(projectDir, "node_modules"), "veryfront"), "dist");
    return normalizePath(joinPath(distDir, module)) ?? null;
  }
}
