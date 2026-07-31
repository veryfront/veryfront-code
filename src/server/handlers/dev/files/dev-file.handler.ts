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
import {
  type DependencyPinningSnapshot,
  type DependencyPinningSourceInput,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { HttpStatus } from "#veryfront/http/responses";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";

const DEPENDENCY_PIN_PATTERN = /^on:[A-Za-z0-9._-]+$/;

type DevFileBundler = (
  absPath: string,
  ctx: HandlerContext,
  dependencySnapshot?: DependencyPinningSnapshot,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
) => Promise<string>;

export class DevFileHandler extends BaseHandler {
  constructor(private readonly bundleFile: DevFileBundler = bundleDevFile) {
    super();
  }

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
      const requestedPinKeys = new URL(req.url).searchParams.getAll("pins");
      const requestedPinKey = requestedPinKeys[0];
      if (
        requestedPinKeys.length > 1 ||
        (requestedPinKey !== undefined &&
          (!DEPENDENCY_PIN_PATTERN.test(requestedPinKey) ||
            requestedPinKey === "on:unknown"))
      ) {
        return this.respondDependencyConflict();
      }

      const dependencyPinningSource = createHandlerDependencyPinningSource(ctx);
      const dependencySnapshot = await resolveRequestedDependencyPinningSnapshot(
        dependencyPinningSource,
        requestedPinKey,
      );
      if (
        !dependencySnapshot ||
        (requestedPinKey === undefined && dependencySnapshot.cacheKey.startsWith("on:"))
      ) {
        return this.respondDependencyConflict();
      }

      const code = await this.bundleFile(
        absPath,
        ctx,
        dependencySnapshot,
        dependencyPinningSource,
        new URL(req.url).origin,
      );
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

  private respondDependencyConflict(): HandlerResult {
    return this.respond(
      this.createErrorModule(
        "Unknown dependency snapshot",
        HttpStatus.CONFLICT,
      ),
    );
  }

  private createErrorModule(message: string, status: number): Response {
    const headers: HeadersInit = {
      "content-type": "application/javascript",
      ...(status === HttpStatus.CONFLICT ? { "cache-control": "no-store" } : {}),
    };
    return new Response(`export default null; // ${message}`, {
      status,
      headers,
    });
  }
}
