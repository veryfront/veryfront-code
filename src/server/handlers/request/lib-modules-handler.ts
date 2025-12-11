
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { joinPath, normalizePath } from "@veryfront/utils/path-utils.ts";
import { createSecureFs } from "@veryfront/security";
import { computeEtag, hasMatchingEtag } from "../utils/etag.ts";
import {
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_MEDIUM_LIB_MODULES,
} from "@veryfront/core/constants/index.ts";

const ALLOWED_MODULES = new Set([
  "ai/react.js",
  "ai/components.js",
  "ai/primitives.js",
]);

export class LibModulesHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "LibModulesHandler",
    priority: PRIORITY_MEDIUM_LIB_MODULES as HandlerPriority,
    patterns: [
      { pattern: /^\/_veryfront\/lib\
      { pattern: /^\/_veryfront\/lib\
    ],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return this.continue();
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    if (!pathname.startsWith("/_veryfront/lib/")) {
      return this.continue();
    }

    const moduleResolution = ctx.config?.client?.moduleResolution ?? "cdn";
    if (moduleResolution !== "self-hosted") {
      this.logDebug(
        "LibModulesHandler: self-hosted mode not enabled, skipping",
        { moduleResolution },
        ctx,
      );
      return this.continue();
    }

    const modulePath = pathname.replace("/_veryfront/lib/", "");

    if (!ALLOWED_MODULES.has(modulePath)) {
      this.logDebug(
        `LibModulesHandler: module not allowed: ${modulePath}`,
        { allowed: Array.from(ALLOWED_MODULES) },
        ctx,
      );
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

    const filePath = this.resolveModulePath(modulePath, ctx.projectDir);
    if (!filePath) {
      return this.continue();
    }

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

      if (hasMatchingEtag(req, etag)) {
        const builder = this.createResponseBuilder(ctx);
        return this.respond(
          builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .notModified(etag),
        );
      }

      const builder = this.createResponseBuilder(ctx);
      const body = method === "HEAD" ? null : content;
      const isDev = ctx.mode === "development";

      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache(isDev ? "no-cache" : "immutable")
        .withETag(etag)
        .withContentType("application/javascript; charset=utf-8", body, HTTP_OK);

      this.logDebug(
        `LibModulesHandler: served ${modulePath}`,
        { size: content.length, filePath },
        ctx,
      );

      return this.respond(response);
    } catch (error) {
      this.logDebug(
        `LibModulesHandler: failed to serve ${modulePath}: ${this.getErrorMessage(error)}`,
        { filePath },
        ctx,
      );

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
  }

  private resolveModulePath(module: string, projectDir: string): string | null {
    if (!ALLOWED_MODULES.has(module)) {
      return null;
    }

    const nodeModulesPath = joinPath(projectDir, "node_modules");
    const veryfrontPath = joinPath(nodeModulesPath, "veryfront");
    const distDir = joinPath(veryfrontPath, "dist");
    const distPath = normalizePath(joinPath(distDir, module));

    return distPath;
  }
}
