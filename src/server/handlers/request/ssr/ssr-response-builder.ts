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
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";
import { serverLogger } from "#veryfront/utils";
import { appendDataResponseMetadata } from "#veryfront/data/response-metadata.ts";

const logger = serverLogger.component("ssr-response-builder");

async function cancelHeadResponseBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (!body) return;

  try {
    await body.cancel();
  } catch (error) {
    logger.debug("SSR response body cancellation failed during HEAD cleanup", { error });
  }
}

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
    const responseBuilder = builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withClientHints()
      .withCache(result.cacheStrategy);
    appendDataResponseMetadata(responseBuilder.headers, result);
    const response = responseBuilder.withContentType(
      getContentType(".html"),
      result.stream,
      result.status,
    );

    if (!isHeadRequest) return response;

    await cancelHeadResponseBody(response.body);
    return new Response(null, { status: response.status, headers: response.headers });
  }

  // ETag match → 304 Not Modified (production only)
  if (!isDev && !builder.nonce && result.etag && hasMatchingEtag(req, result.etag)) {
    const responseBuilder = builder
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache(result.cacheStrategy);
    appendDataResponseMetadata(responseBuilder.headers, result);
    return responseBuilder.notModified(result.etag);
  }

  // Buffered response path
  const renderedContent = typeof result.html === "string"
    ? result.html
    : typeof result.stream === "string"
    ? result.stream
    : undefined;
  // Rendered application HTML already contains nonces on framework-owned
  // tags. Never bless arbitrary application markup at the response boundary.
  // The fallback error document is framework-owned, so its fixed inline tags
  // can receive the response nonce safely.
  const html = renderedContent === undefined
    ? addNonceToHtmlTags(ErrorPages.serverError(), builder.nonce)
    : result.htmlProvenance === "framework"
    ? addNonceToHtmlTags(renderedContent, builder.nonce)
    : renderedContent;
  const body = isHeadRequest ? null : html;

  let response = builder
    .withCORS(req, ctx.securityConfig?.cors)
    .withSecurity(ctx.securityConfig ?? undefined, req)
    .withCache(result.cacheStrategy);

  if (!result.isStreaming) response = response.withClientHints();
  if (result.etag) response = response.withETag(result.etag);
  appendDataResponseMetadata(response.headers, result);

  const finalResponse = response.withContentType(
    getContentType(".html"),
    body,
    result.status,
  );

  if (!isHeadRequest || !finalResponse.body) return finalResponse;

  await cancelHeadResponseBody(finalResponse.body);
  return new Response(null, { status: finalResponse.status, headers: finalResponse.headers });
}
