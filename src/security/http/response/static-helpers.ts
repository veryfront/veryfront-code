/**
 * ResponseBuilder - Static Helper Methods
 * Static utility methods for common response patterns
 */

import { CONTENT_TYPES } from "./constants.ts";
import type { CacheStrategy, CORSConfig, SecurityConfig } from "./types.ts";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";

/**
 * Type definition for ResponseBuilder constructor
 * Using a minimal interface to avoid circular dependency
 */
interface ResponseBuilderConstructor {
  new (config?: {
    securityConfig?: SecurityConfig | null;
    isDev?: boolean;
    cspUserHeader?: string | null;
    adapter?: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter;
  }): ResponseBuilderInstance;
}

/**
 * Type definition for ResponseBuilder instance
 */
interface ResponseBuilderInstance {
  headers: Headers;
  status: number;
  withCORS(req: Request, corsConfig?: boolean | CORSConfig): ResponseBuilderInstance;
  withSecurity(config?: SecurityConfig): ResponseBuilderInstance;
  withCache(strategy: CacheStrategy): ResponseBuilderInstance;
  withETag(etag: string): ResponseBuilderInstance;
  withAllow(methods: string | string[]): ResponseBuilderInstance;
  json(data: unknown, status?: number): Response;
  html(body: string, status?: number): Response;
  text(message: string, status?: number): Response;
  withContentType(contentType: string, body?: BodyInit | null): Response;
  build(body?: BodyInit | null, status?: number): Response;
}

// Forward declaration - will be set by builder.ts to avoid circular dependency
let ResponseBuilderClass: ResponseBuilderConstructor | null = null;

/**
 * Set the ResponseBuilder class reference
 * This is called by builder.ts to avoid circular dependencies
 */
export function setResponseBuilderClass(builderClass: ResponseBuilderConstructor): void {
  ResponseBuilderClass = builderClass;
}

/**
 * Create and configure a ResponseBuilder with common options.
 */
function createBuilder(
  req: Request,
  config?: {
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
    etag?: string;
  },
): ResponseBuilderInstance {
  if (!ResponseBuilderClass) {
    throw toError(createError({
      type: "config",
      message: "ResponseBuilder class not initialized",
    }));
  }
  const builder = new ResponseBuilderClass(config);
  builder.withCORS(req, config?.corsConfig);
  if (config?.securityConfig !== undefined) {
    builder.withSecurity(config.securityConfig ?? undefined);
  }
  if (config?.cache) {
    builder.withCache(config.cache);
  }
  if (config?.etag) {
    builder.withETag(config.etag);
  }
  return builder;
}

/**
 * Static helper for error responses
 */
export function error(
  status: number,
  message: string,
  req: Request,
  config?: {
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    contentType?: string;
  },
): Response {
  const builder = createBuilder(req, config);
  const contentType = config?.contentType ?? CONTENT_TYPES.TEXT;

  if (contentType === CONTENT_TYPES.JSON) {
    return builder.json({ error: message }, status);
  }
  if (contentType === CONTENT_TYPES.HTML) {
    return builder.html(message, status);
  }
  return builder.text(message, status);
}

/**
 * Static helper for JSON responses
 */
export function json(
  data: unknown,
  req: Request,
  config?: {
    status?: number;
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
    etag?: string;
  },
): Response {
  return createBuilder(req, config).json(data, config?.status);
}

/**
 * Static helper for HTML responses
 */
export function html(
  body: string,
  req: Request,
  config?: {
    status?: number;
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
    etag?: string;
  },
): Response {
  return createBuilder(req, config).html(body, config?.status);
}

/**
 * Static helper for OPTIONS preflight responses
 */
export function preflight(
  req: Request,
  config?: {
    allowMethods?: string | string[];
    allowHeaders?: string | string[];
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
  },
): Response {
  const builder = createBuilder(req, config);

  const methods = config?.allowMethods ?? "GET,POST,PUT,PATCH,DELETE,OPTIONS";
  builder.withAllow(methods);

  const headers = config?.allowHeaders ??
    req.headers.get("access-control-request-headers") ??
    "Content-Type,Authorization";
  builder.headers.set(
    "Access-Control-Allow-Headers",
    Array.isArray(headers) ? headers.join(", ") : headers,
  );

  return builder.build(null, 204);
}

/**
 * Static helper for streaming responses
 */
export function stream(
  streamData: ReadableStream,
  req: Request,
  config?: {
    contentType?: string;
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
  },
): Response {
  const builder = createBuilder(req, config);
  const contentType = config?.contentType ?? "application/octet-stream";
  return builder.withContentType(contentType, streamData);
}
