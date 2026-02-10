/**
 * SSR Response Builder
 *
 * Builds HTTP responses from SSR render results. Handles streaming responses,
 * HEAD requests, ETag matching, cache headers, CORS, and security headers.
 *
 * @module server/handlers/request/ssr/ssr-response-builder
 */

import type { HandlerContext } from "../../types.ts";
import { hasMatchingEtag } from "../../utils/etag.ts";
import { getContentType } from "../../utils/content-types.ts";
import type { SSRRenderResult } from "../../../services/rendering/ssr.service.ts";
import { ErrorPages } from "../../../utils/error-html.ts";
import type { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";

/**
 * Build an HTTP response from an SSR render result.
 *
 * Handles streaming vs buffered responses, HEAD requests (body cancellation),
 * ETag-based 304 Not Modified, cache strategy, CORS, and security headers.
 */
export async function buildSSRResponse(
  req: Request,
  ctx: HandlerContext,
  result: SSRRenderResult,
  builder: ResponseBuilder,
): Promise<Response> {
  const isHeadRequest = req.method.toUpperCase() === "HEAD";
  const isDev = !!ctx.isLocalProject;

  // Streaming response path
  if (result.isStreaming && result.stream) {
    const response = builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined)
      .withClientHints()
      .withCache("no-cache")
      .withContentType(getContentType(".html"), result.stream, result.status);

    if (!isHeadRequest) return response;

    await response.body?.cancel().catch(() => {});
    return new Response(null, { status: response.status, headers: response.headers });
  }

  // ETag match → 304 Not Modified (production only)
  if (!isDev && result.etag && hasMatchingEtag(req, result.etag)) {
    return builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined)
      .withCache(result.cacheStrategy)
      .notModified(result.etag);
  }

  // Buffered response path
  const content = result.html || result.stream || ErrorPages.serverError();
  const body = isHeadRequest ? null : content;

  let response = builder
    .withCORS(req, ctx.securityConfig?.cors)
    .withSecurity(ctx.securityConfig ?? undefined)
    .withCache(result.cacheStrategy);

  if (!result.isStreaming) response = response.withClientHints();
  if (result.etag) response = response.withETag(result.etag);

  const finalResponse = response.withContentType(
    getContentType(".html"),
    body,
    result.status,
  );

  if (!isHeadRequest || !finalResponse.body) return finalResponse;

  await finalResponse.body.cancel().catch(() => {});
  return new Response(null, { status: finalResponse.status, headers: finalResponse.headers });
}
