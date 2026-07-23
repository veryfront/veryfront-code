/**
 * Request - Rsc
 *
 * @module server/handlers/request/rsc
 */

import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { isRSCEnabled } from "#veryfront/utils";
import { handleRSCEndpoint } from "../../../services/rsc/endpoints/index.ts";
import { applySecurityHeadersWithNonce } from "../api/security-headers.ts";
import { applyCORSHeaders } from "#veryfront/security";
import { HTTP_NOT_FOUND, PRIORITY_MEDIUM } from "#veryfront/utils/constants/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { generateNonce } from "#veryfront/security/http/response/security-handler.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { computeContentSourceId } from "#veryfront/cache/keys.ts";
import { getRequestTokenProvenance } from "../../../context/request-context.ts";

export class RSCHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "RSCHandler",
    priority: PRIORITY_MEDIUM as HandlerPriority,
    patterns: [{ pattern: "/_veryfront/rsc/", prefix: true }],
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const { pathname } = new URL(req.url);

    if (!pathname.startsWith("/_veryfront/rsc/")) {
      return Promise.resolve(this.continue());
    }

    const endpoint = pathname.slice("/_veryfront/rsc/".length);

    return withSpan(
      "rsc.handle",
      async () => {
        const isHydrationScript = endpoint === "client.js" || endpoint === "dom.js";
        const isClientModuleEndpoint = endpoint === "module";
        const isDeprecatedEndpoint = endpoint === "flight_page";

        if (
          !isRSCEnabled(ctx.config) &&
          !isHydrationScript &&
          !isClientModuleEndpoint &&
          !isDeprecatedEndpoint
        ) {
          return this.respond(new Response("Not Found", { status: HTTP_NOT_FOUND }));
        }

        const nonce = generateNonce();
        const isLocalProject = ctx.isLocalProject === true;
        const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode ?? "preview";
        const contentSourceId = ctx.enriched?.contentSourceId ?? computeContentSourceId(
          isLocalProject,
          environment,
          ctx.requestContext?.branch ?? null,
          ctx.releaseId,
        );
        const execute = () =>
          handleRSCEndpoint({
            req,
            pathname,
            projectDir: ctx.projectDir,
            projectId: ctx.projectId,
            projectSlug: ctx.projectSlug,
            contentSourceId,
            releaseId: ctx.releaseId,
            adapter: ctx.adapter,
            config: ctx.config,
            isLocalProject,
            mode: isRSCProductionMode(ctx) ? "production" : "development",
            nonce,
          });
        const fsAdapter = ctx.adapter.fs;
        const isMultiProject = ctx.projectSlug &&
          isExtendedFSAdapter(fsAdapter) &&
          fsAdapter.isMultiProjectMode();

        const res = isMultiProject
          ? await fsAdapter.runWithContext(
            ctx.projectSlug!,
            ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || "",
            execute,
            ctx.projectId,
            {
              productionMode: isRSCProductionMode(ctx),
              releaseId: ctx.releaseId,
              branch: ctx.resolvedEnvironment === "production"
                ? null
                : ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null,
              environmentName: ctx.environmentName,
              tokenProvenance: getRequestTokenProvenance(
                ctx.requestContext,
                ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || "",
              ),
            },
          )
          : await execute();

        if (!res) {
          return this.continue();
        }

        const headers = new Headers(res.headers);
        await applyCORSHeaders({
          request: req,
          headers,
          config: ctx.securityConfig?.cors,
        });
        applySecurityHeadersWithNonce(headers, ctx, nonce, req);

        return this.respond(
          new Response(res.body, {
            status: res.status,
            statusText: res.statusText,
            headers,
          }),
        );
      },
      { "rsc.pathname": pathname, "rsc.endpoint": endpoint },
    );
  }
}

function isRSCProductionMode(ctx: HandlerContext): boolean {
  if (ctx.config?.fs?.veryfront?.productionMode === true) return true;
  return (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "production";
}
