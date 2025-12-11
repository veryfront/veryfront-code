
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
} from "@veryfront/core/constants/index.ts";

export class DevFileHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevFileHandler",
    priority: PRIORITY_MEDIUM_DEV_FILES as HandlerPriority,
    patterns: [{ pattern: "/_veryfront/fs/", prefix: true, method: "GET" }],
    enabled: (ctx) => ctx.mode === "development",
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (!pathname.startsWith("/_veryfront/fs/") || req.method !== "GET") {
      return this.continue();
    }

    const encoded = pathname.replace("/_veryfront/fs/", "").replace(/\.js$/, "");

    const absPath = await validateDevFilePath(encoded, ctx);

    if (absPath.startsWith("Error:")) {
      const message = absPath.replace("Error: ", "");
      this.logDebug("dev fs validation failed", { message }, ctx);
      return this.respond(this.createErrorModule(message, HTTP_NOT_FOUND));
    }

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

  private createErrorModule(message: string, status: number): Response {
    const code = `export default null; // ${message}`;
    return new Response(code, {
      status,
      headers: { "content-type": "application/javascript" },
    });
  }
}
