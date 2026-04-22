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
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";

export class DevFileHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "DevFileHandler",
    priority: PRIORITY_MEDIUM_DEV_FILES as HandlerPriority,
    patterns: [{ pattern: "/_veryfront/fs/", prefix: true, method: "GET" }],
    // Strictly local-only: exposes project source tree (VULN-SRV-1 / VULN-SRV-2).
    // Preview mode (even host-derived) must not unlock this surface.
    enabled: (ctx) => !!ctx.isLocalProject,
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const { pathname } = new URL(req.url);

    if (!ctx.isLocalProject) return this.continue();

    if (req.method !== "GET" || !pathname.startsWith("/_veryfront/fs/")) {
      return this.continue();
    }

    const fsAdapter = ctx.adapter.fs;
    const isExtended = isExtendedFSAdapter(fsAdapter);

    if (isExtended && fsAdapter.isContextualMode()) {
      try {
        if (ctx.proxyToken) fsAdapter.setRequestToken(ctx.proxyToken);
        fsAdapter.setRequestBranch(ctx.parsedDomain?.branch ?? null);
        fsAdapter.setProductionMode(false, ctx.releaseId);
      } catch (_) {
        /* expected: some fs adapter operations may not be supported */
      }
    }

    return await this.handleWithContext(req, pathname, ctx);
  }

  private async handleWithContext(
    req: Request,
    pathname: string,
    ctx: HandlerContext,
  ): Promise<HandlerResult> {
    const encoded = pathname.slice("/_veryfront/fs/".length).replace(/\.js$/, "");
    const absPath = await validateDevFilePath(encoded, ctx);

    if (absPath.startsWith("Error:")) {
      const message = absPath.slice("Error: ".length);
      this.logDebug("dev fs validation failed", { message }, ctx);
      return this.respond(this.createErrorModule(message, HTTP_NOT_FOUND));
    }

    try {
      const code = await bundleDevFile(absPath, ctx);
      const response = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-cache")
        .javascript(code);

      return this.respond(response);
    } catch (error) {
      const reason = this.getErrorMessage(error);
      this.logDebug("esbuild failed for dev fs", { path: absPath, reason }, ctx);
      return this.respond(
        this.createErrorModule(
          `Build error: ${reason}`,
          HTTP_INTERNAL_SERVER_ERROR,
        ),
      );
    }
  }

  private createErrorModule(message: string, status: number): Response {
    return new Response(`export default null; // ${message}`, {
      status,
      headers: { "content-type": "application/javascript" },
    });
  }
}
