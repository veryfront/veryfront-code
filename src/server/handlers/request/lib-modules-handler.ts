/**
 * Library Modules Handler
 * Serves veryfront client modules from /_veryfront/lib/* endpoint
 * for self-hosted mode (when config.client.moduleResolution === 'self-hosted')
 *
 * This handler enables projects to serve veryfront agent, components, and primitives
 * modules from their own server instead of relying on CDN. The modules are read from
 * node_modules/veryfront/dist/ and served with appropriate caching headers.
 */

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

/** Allowed module paths that can be served */
const ALLOWED_MODULES = new Set([
  "agent/react.js",
  "components/ai.js",
  "primitives.js",
]);

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
    // Only handle GET and HEAD requests
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return this.continue();
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    // Check if this is a lib module request
    if (!pathname.startsWith("/_veryfront/lib/")) {
      return this.continue();
    }

    // Check if self-hosted mode is enabled
    const moduleResolution = ctx.config?.client?.moduleResolution ?? "cdn";
    if (moduleResolution !== "self-hosted") {
      // Not in self-hosted mode, return 404 for these endpoints
      this.logDebug(
        "LibModulesHandler: self-hosted mode not enabled, skipping",
        { moduleResolution },
        ctx,
      );
      return this.continue();
    }

    // Extract module path from URL
    const modulePath = pathname.replace("/_veryfront/lib/", "");

    // Validate module path is allowed (security check)
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

    // Resolve module file path
    const filePath = this.resolveModulePath(modulePath, ctx.projectDir);
    if (!filePath) {
      return this.continue();
    }

    try {
      // Create secure filesystem wrapper with custom validation
      // We need to allow reading from node_modules/veryfront/dist which is outside
      // the default static-serving allowed directories (dist, public)
      const secureFs = createSecureFs({
        baseDir: ctx.projectDir,
        adapter: ctx.adapter,
        context: "internal", // Use internal context which is more permissive
        throwOnError: false,
        validationOptions: {
          // Override to allow node_modules path
          allowedDirs: ["node_modules"],
          allowAbsolute: true,
        },
      });

      // Read the module file
      const content = await secureFs.readFile(filePath);
      const etag = computeEtag(content);

      // Check if-none-match for caching
      if (hasMatchingEtag(req, etag)) {
        const builder = this.createResponseBuilder(ctx);
        return this.respond(
          builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .notModified(etag),
        );
      }

      // Build response with appropriate caching based on mode
      // In development, use no-cache to allow debugging with fresh code
      // In production, use immutable caching (modules are versioned)
      const builder = this.createResponseBuilder(ctx);
      const body = method === "HEAD" ? null : content;
      const isDev = ctx.requestContext?.isLocalDev ?? false;

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

      // Module file not found
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

  /**
   * Resolve module path to absolute file path
   * Maps: agent/react.js -> node_modules/veryfront/dist/agent/react.js
   */
  private resolveModulePath(module: string, projectDir: string): string | null {
    if (!ALLOWED_MODULES.has(module)) {
      return null;
    }

    // Path to veryfront dist in node_modules
    const nodeModulesPath = joinPath(projectDir, "node_modules");
    const veryfrontPath = joinPath(nodeModulesPath, "veryfront");
    const distDir = joinPath(veryfrontPath, "dist");
    const distPath = normalizePath(joinPath(distDir, module));

    return distPath;
  }
}
