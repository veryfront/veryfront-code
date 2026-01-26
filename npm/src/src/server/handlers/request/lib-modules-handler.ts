import * as dntShim from "../../../../_dnt.shims.js";
import { BaseHandler } from "../response/base.js";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.js";
import { joinPath, normalizePath } from "../../../utils/path-utils.js";
import { createSecureFs } from "../../../security/index.js";
import { computeEtag, hasMatchingEtag } from "../utils/etag.js";
import {
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_MEDIUM_LIB_MODULES,
} from "../../../utils/constants/index.js";

const ALLOWED_MODULES = new Set(["agent/react.js", "components/ai.js", "primitives.js"]);

export class LibModulesHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "LibModulesHandler",
    priority: PRIORITY_MEDIUM_LIB_MODULES as HandlerPriority,
    patterns: [
      { pattern: /^\/_veryfront\/lib\//, method: "GET" },
      { pattern: /^\/_veryfront\/lib\//, method: "HEAD" },
    ],
  };

  async handle(req: dntShim.Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return this.continue();

    const pathname = new URL(req.url).pathname;
    if (!pathname.startsWith("/_veryfront/lib/")) return this.continue();

    const moduleResolution = ctx.config?.client?.moduleResolution ?? "cdn";
    if (moduleResolution !== "self-hosted") {
      this.logDebug(
        "LibModulesHandler: self-hosted mode not enabled, skipping",
        { moduleResolution },
        ctx,
      );
      return this.continue();
    }

    const modulePath = pathname.slice("/_veryfront/lib/".length);
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

      const builder = this.createResponseBuilder(ctx);

      if (hasMatchingEtag(req, etag)) {
        return this.respond(
          builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .notModified(etag),
        );
      }

      const isDev = ctx.requestContext?.isLocalDev ?? false;
      const body = method === "HEAD" ? null : content;

      this.logDebug(
        `LibModulesHandler: served ${modulePath}`,
        { size: content.length, filePath },
        ctx,
      );

      return this.respond(
        builder
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined)
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

  private respondNotFound(req: dntShim.Request, ctx: HandlerContext, method: string): HandlerResult {
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

    const nodeModulesDir = joinPath(projectDir, "node_modules");
    const veryfrontDir = joinPath(nodeModulesDir, "veryfront");
    const distDir = joinPath(veryfrontDir, "dist");
    return normalizePath(joinPath(distDir, module)) ?? null;
  }
}
