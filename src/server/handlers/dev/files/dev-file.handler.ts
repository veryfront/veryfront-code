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
} from "#veryfront/transforms/esm/package-registry.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import {
  readSnapshotQuery,
  resolveSnapshotForRequest,
  snapshotConflictResponse,
} from "#veryfront/server/handlers/utils/dependency-snapshot-protocol.ts";
import {
  createLocalControlAccessDeniedResponse,
  isTrustedLocalControlRequest,
} from "#veryfront/security/http/local-control-request.ts";

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
    if (!isTrustedLocalControlRequest(req)) {
      return this.respond(
        createLocalControlAccessDeniedResponse(req, "Development file request rejected"),
      );
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
    const validation = await validateDevFilePath(encoded, ctx);

    if (validation.kind === "rejected") {
      this.logDebug("dev fs validation failed", { message: validation.message }, ctx);
      return this.respond(this.createErrorModule(validation.message, HTTP_NOT_FOUND));
    }
    const absPath = validation.path;

    try {
      const requestUrl = new URL(req.url);
      const dependencyPinningSource = createHandlerDependencyPinningSource(ctx);
      const resolution = await resolveSnapshotForRequest(
        dependencyPinningSource,
        readSnapshotQuery(requestUrl),
      );
      if (resolution.kind === "conflict") {
        return this.respond(
          snapshotConflictResponse(
            this.createResponseBuilder(ctx),
            req,
            ctx.securityConfig,
          ),
        );
      }
      const dependencySnapshot = resolution.snapshot;

      const code = await this.bundleFile(
        absPath,
        ctx,
        dependencySnapshot,
        dependencyPinningSource,
        requestUrl.origin,
      );
      const response = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-cache")
        .javascript(code);

      return this.respond(response);
    } catch (error) {
      const reason = this.getErrorMessage(error);
      this.logDebug("dev fs request failed", { path: absPath, reason }, ctx);
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
      headers: {
        "cache-control": "no-store",
        "content-type": "application/javascript",
      },
    });
  }
}
