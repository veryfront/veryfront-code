/**
 * Static File Handler
 *
 * Thin orchestration layer for static file serving.
 * Delegates business logic to StaticFileService, handles HTTP concerns.
 *
 * Security: Uses secure filesystem wrapper to prevent path traversal attacks
 *
 * @module server/handlers/request/static-handler
 */

import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { hasMatchingEtag } from "../utils/etag.ts";
import {
  HTTP_NOT_FOUND,
  HTTP_OK,
  PRIORITY_MEDIUM_STATIC,
} from "#veryfront/utils/constants/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { StaticFileService } from "../../services/static/index.ts";
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";
import { computeEtag } from "../utils/etag.ts";
import { isVersionedProdHydrationModulePath } from "#veryfront/html/hydration-script-builder/prod-scripts.ts";

function isHtmlResponse(contentType: string): boolean {
  return /\btext\/html\b/i.test(contentType);
}

function toStaticResponseBody(data: Uint8Array): BodyInit {
  if (data.buffer instanceof ArrayBuffer) {
    return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
      ? data.buffer
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  // BodyInit excludes SharedArrayBuffer-backed views in the type contract.
  // Copy only that uncommon representation; ordinary asset bytes transfer
  // their existing ArrayBuffer without the former unconditional slice.
  return Uint8Array.from(data);
}

function isProductionBuildAssetPath(pathname: string): boolean {
  return pathname === "/_veryfront/app.js" ||
    pathname === "/_veryfront/client.js" ||
    pathname === "/_veryfront/router.js" ||
    pathname === "/_veryfront/prefetch.js" ||
    pathname === "/_veryfront/hydration-runtime.js" ||
    isVersionedProdHydrationModulePath(pathname) ||
    pathname === "/_veryfront/manifest.json" ||
    pathname.startsWith("/_veryfront/chunks/") ||
    pathname.startsWith("/_veryfront/pages/") ||
    pathname.startsWith("/_veryfront/data/") ||
    pathname.startsWith("/_vf/assets/");
}

function isDynamicBuildFallbackPath(pathname: string): boolean {
  return pathname.startsWith("/_veryfront/pages/") ||
    pathname.startsWith("/_veryfront/data/");
}

function isProjectApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function createManifestCacheIdentity(ctx: HandlerContext): string {
  const contentSourceId = ctx.enriched?.contentSourceId;
  const contentIdentity = contentSourceId === undefined
    ? [
      "fallback",
      ctx.resolvedEnvironment ?? null,
      ctx.requestContext?.mode ?? null,
      ctx.releaseId ?? null,
      ctx.requestContext?.branch ?? null,
    ]
    : ["content-source-id", contentSourceId];

  // JSON array encoding is collision-free for admitted string/null fields and
  // preserves which authority supplied each value. Delimiter concatenation
  // can alias distinct release/branch tuples when either contains `:` or NUL.
  return JSON.stringify([
    "static-manifest-cache-v1",
    [
      "project",
      ctx.projectId ?? null,
      ctx.projectSlug ?? null,
      ctx.projectDir,
    ],
    contentIdentity,
  ]);
}

export class StaticHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "StaticHandler",
    priority: PRIORITY_MEDIUM_STATIC as HandlerPriority,
    patterns: [
      { pattern: /^\/(?!api(?:\/|$))[^_].*/, method: "GET" },
      { pattern: /^\/(?!api(?:\/|$))[^_].*/, method: "HEAD" },
    ],
  };

  private staticService = new StaticFileService();

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const method = req.method.toUpperCase();
    if (method !== "GET" && method !== "HEAD") return Promise.resolve(this.continue());

    const pathname = new URL(req.url).pathname;
    if (isProjectApiPath(pathname)) {
      return Promise.resolve(this.continue());
    }
    if (pathname.startsWith("/_") && !isProductionBuildAssetPath(pathname)) {
      return Promise.resolve(this.continue());
    }

    return this.withProxyContext(ctx, async () => {
      const response = await this.tryServeStatic(req, pathname, ctx);
      return response ? this.respond(response) : this.continue();
    });
  }

  private tryServeStatic(
    req: Request,
    pathname: string,
    ctx: HandlerContext,
  ): Promise<Response | null> {
    return withSpan(
      "static.tryServeStatic",
      async () => {
        const method = req.method.toUpperCase();
        const isHead = method === "HEAD";
        const isLocal = !!ctx.isLocalProject;
        const isPreviewMode = ctx.requestContext?.mode === "preview" && !isLocal;
        const manifestCacheIdentity = createManifestCacheIdentity(ctx);
        const builder = this.createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors);
        const resolveOptions = {
          projectDir: ctx.projectDir,
          adapter: ctx.adapter,
          isPreviewMode,
          isLocalProject: isLocal,
          manifestCacheIdentity,
        };

        const result = await this.staticService.resolveFile(pathname, resolveOptions);

        if (!result) {
          if (
            pathname === "/favicon.ico" &&
            await this.staticService.resolveFile("/favicon.svg", resolveOptions)
          ) {
            return builder
              .withSecurity(ctx.securityConfig ?? undefined, req)
              .withCache("no-cache")
              .withHeaders({ location: new URL("/favicon.svg", req.url).toString() })
              .withStatus(307)
              .build();
          }

          if (isDynamicBuildFallbackPath(pathname)) return null;
          if (!this.staticService.isAssetRequest(pathname)) return null;

          return builder
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .withCache("no-cache")
            .withContentType(
              "text/plain; charset=utf-8",
              isHead ? null : "Not Found",
              HTTP_NOT_FOUND,
            );
        }

        const responseData = isHtmlResponse(result.contentType)
          ? new TextEncoder().encode(
            addNonceToHtmlTags(new TextDecoder().decode(result.data), builder.nonce),
          )
          : result.data;
        const etag = computeEtag(responseData);

        if (hasMatchingEtag(req, etag)) {
          return builder
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .notModified(etag);
        }

        const body: BodyInit | null = isHead ? null : toStaticResponseBody(responseData);
        const response = builder
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache(result.cacheStrategy)
          .withETag(etag)
          .withContentType(result.contentType, body, HTTP_OK);

        this.logDebug(
          `Served static file: ${result.path}`,
          {
            contentType: result.contentType,
            cacheStrategy: result.cacheStrategy,
            size: result.data.byteLength,
            source: result.source,
          },
          ctx,
        );

        return response;
      },
      { "static.pathname": pathname, "static.projectSlug": ctx.projectSlug || "unknown" },
    );
  }
}
