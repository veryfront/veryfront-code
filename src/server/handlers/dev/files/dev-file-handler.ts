/**
 * Development File Handler
 *
 * Main handler for bundling TypeScript/JSX files on-the-fly in development mode.
 * Orchestrates path validation, bundling, and response generation.
 *
 * @module server/handlers/dev/files/dev-file-handler
 */

import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { validateDevFilePath } from "./path-validator.ts";
import { bundleDevFile } from "./esbuild-bundler.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  PRIORITY_MEDIUM_DEV_FILES,
} from "#veryfront/utils/constants/index.ts";

/**
 * Development File Handler Class
 *
 * Serves TypeScript/JSX files bundled on-the-fly for development.
 *
 * Features:
 * - Base64url path encoding for security
 * - Directory traversal protection
 * - ESBuild bundling with React JSX
 * - External React dependencies
 * - Error handling with JS module fallbacks
 *
 * Priority: 400 (MEDIUM) - runs after health checks, before static files
 * Patterns: /_veryfront/fs/* (GET only)
 * Enabled: Development mode only
 *
 * @example
 * ```typescript
 * const handler = new DevFileHandler();
 * // Request: GET /_veryfront/fs/YXBwL3BhZ2UudHN4.js
 * // Returns: Bundled JavaScript for app/page.tsx
 * ```
 */
export class DevFileHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevFileHandler",
    priority: PRIORITY_MEDIUM_DEV_FILES as HandlerPriority, // Higher than static, lower than health
    patterns: [{ pattern: "/_veryfront/fs/", prefix: true, method: "GET" }],
    enabled: (ctx) => ctx.mode === "development", // Only in dev mode
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (!pathname.startsWith("/_veryfront/fs/") || req.method !== "GET") {
      return this.continue();
    }

    // Extract and decode the file path
    const encoded = pathname.replace("/_veryfront/fs/", "").replace(/\.js$/, "");

    // Validate path
    const absPath = await validateDevFilePath(encoded, ctx);

    // Check for errors
    if (absPath.startsWith("Error:")) {
      const message = absPath.replace("Error: ", "");
      this.logDebug("dev fs validation failed", { message }, ctx);
      return this.respond(this.createErrorModule(message, HTTP_NOT_FOUND));
    }

    // Bundle the file with esbuild
    try {
      const code = await bundleDevFile(absPath, ctx);
      const builder = this.createResponseBuilder(ctx);
      const response = builder
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined)
        .withCache("no-cache")
        .javascript(code);
      return this.respond(response);
    } catch (error) {
      this.logDebug("esbuild failed for dev fs", {
        path: absPath,
        reason: this.getErrorMessage(error),
      }, ctx);
      return this.respond(
        this.createErrorModule(
          `Build error: ${this.getErrorMessage(error)}`,
          HTTP_INTERNAL_SERVER_ERROR,
        ),
      );
    }
  }

  /**
   * Create error module response
   *
   * Returns a valid JavaScript module that exports null with an error comment.
   * This prevents breaking import chains when files fail to load.
   *
   * @param message - Error message
   * @param status - HTTP status code
   * @returns Response with error JS module
   *
   * @internal
   */
  private createErrorModule(message: string, status: number): Response {
    const code = `export default null; // ${message}`;
    return new Response(code, {
      status,
      headers: { "content-type": "application/javascript" },
    });
  }
}
