import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { createSecureFs } from "#veryfront/security";
import { computeEtag, hasMatchingEtag } from "../utils/etag.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_MEDIUM_LIB_MODULES,
} from "#veryfront/utils/constants/index.ts";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getSafeErrorName } from "../../utils/error-name.ts";
import {
  isLibModuleName,
  LIB_MODULE_PATHS,
  resolveLibModulePath,
} from "./lib-module-catalog.ts";

export { LIB_MODULE_PATHS };
const LIB_PREFIX = "/_veryfront/lib/";
const MAX_SELF_HOSTED_MODULE_BYTES = 16 * 1024 * 1024;

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
    if (!isLibModuleName(modulePath)) {
      this.logDebug(
        "LibModulesHandler: requested module is not allowed",
        { requestedNameLength: modulePath.length },
        ctx,
      );
      return this.respondNotFound(req, ctx, method);
    }

    const filePath = resolveLibModulePath(modulePath, ctx.projectDir);

    try {
      const secureFs = createSecureFs({
        baseDir: ctx.projectDir,
        adapter: ctx.adapter,
        context: "internal",
        throwOnError: true,
        validationOptions: {
          allowedDirs: ["node_modules"],
          allowAbsolute: true,
        },
      });

      const info = await secureFs.stat(filePath);
      if (
        !info.isFile || !Number.isSafeInteger(info.size) || info.size < 0 ||
        info.size > MAX_SELF_HOSTED_MODULE_BYTES
      ) {
        throw new TypeError("Self-hosted module metadata is invalid or exceeds the size limit");
      }

      const content = await secureFs.readFile(filePath);
      if (new TextEncoder().encode(content).byteLength > MAX_SELF_HOSTED_MODULE_BYTES) {
        throw new TypeError("Self-hosted module content exceeds the size limit");
      }
      const etag = await computeEtag(content);

      const builder = this.createResponseBuilder(ctx).withCORS(req, ctx.securityConfig?.cors);

      if (hasMatchingEtag(req, etag)) {
        return this.respond(
          builder.withSecurity(ctx.securityConfig ?? undefined, req).notModified(etag),
        );
      }

      const isDev = !!ctx.isLocalProject;
      const body = method === "HEAD" ? null : content;

      this.logDebug(
        "LibModulesHandler: served module",
        { module: modulePath, size: content.length },
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
        "LibModulesHandler: module read failed",
        { module: modulePath, errorName: getSafeErrorName(error) },
        ctx,
      );
      return isNotFoundError(error)
        ? this.respondNotFound(req, ctx, method)
        : this.respondUnavailable(req, ctx, method);
    }
  }

  private respondNotFound(req: Request, ctx: HandlerContext, method: string): HandlerResult {
    const builder = this.createResponseBuilder(ctx);
    return this.respond(
      builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-cache")
        .withContentType(
          "text/plain; charset=utf-8",
          method === "HEAD" ? null : "Module not found",
          HTTP_NOT_FOUND,
        ),
    );
  }

  private respondUnavailable(req: Request, ctx: HandlerContext, method: string): HandlerResult {
    const builder = this.createResponseBuilder(ctx);
    return this.respond(
      builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-store")
        .withContentType(
          "text/plain; charset=utf-8",
          method === "HEAD" ? null : "Module unavailable",
          HTTP_INTERNAL_SERVER_ERROR,
        ),
    );
  }
}
