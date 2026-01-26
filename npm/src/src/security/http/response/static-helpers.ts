import * as dntShim from "../../../../_dnt.shims.js";
import { CONTENT_TYPES } from "./constants.js";
import type { CacheStrategy, CORSConfig, SecurityConfig } from "./types.js";
import { createError, toError } from "../../../errors/veryfront-error.js";

// deno-lint-ignore no-explicit-any
type ResponseBuilderConstructor = new (config?: {
  securityConfig?: SecurityConfig | null;
  isDev?: boolean;
  cspUserHeader?: string | null;
  adapter?: import("../../../platform/adapters/base.js").RuntimeAdapter;
}) => ResponseBuilderInstance;

interface ResponseBuilderInstance {
  headers: dntShim.Headers;
  status: number;
  // deno-lint-ignore no-explicit-any
  withCORS(req: dntShim.Request, corsConfig?: boolean | CORSConfig): any;
  // deno-lint-ignore no-explicit-any
  withSecurity(config?: SecurityConfig): any;
  // deno-lint-ignore no-explicit-any
  withCache(strategy: CacheStrategy): any;
  // deno-lint-ignore no-explicit-any
  withETag(etag: string): any;
  // deno-lint-ignore no-explicit-any
  withAllow(methods: string | string[]): any;
  json(data: unknown, status?: number): dntShim.Response;
  html(body: string, status?: number): dntShim.Response;
  text(message: string, status?: number): dntShim.Response;
  withContentType(contentType: string, body?: dntShim.BodyInit | null): dntShim.Response;
  build(body?: dntShim.BodyInit | null, status?: number): dntShim.Response;
}

let ResponseBuilderClass: ResponseBuilderConstructor | null = null;

/** Set ResponseBuilder class reference (called by builder.ts to avoid circular deps) */
export function setResponseBuilderClass(builderClass: ResponseBuilderConstructor): void {
  ResponseBuilderClass = builderClass;
}

function createBuilder(
  req: dntShim.Request,
  config?: {
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
    etag?: string;
  },
): ResponseBuilderInstance {
  if (!ResponseBuilderClass) {
    throw toError(
      createError({
        type: "config",
        message: "ResponseBuilder class not initialized",
      }),
    );
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

export function error(
  status: number,
  message: string,
  req: dntShim.Request,
  config?: {
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    contentType?: string;
  },
): dntShim.Response {
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

export function json(
  data: unknown,
  req: dntShim.Request,
  config?: {
    status?: number;
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
    etag?: string;
  },
): dntShim.Response {
  return createBuilder(req, config).json(data, config?.status);
}

export function html(
  body: string,
  req: dntShim.Request,
  config?: {
    status?: number;
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
    etag?: string;
  },
): dntShim.Response {
  return createBuilder(req, config).html(body, config?.status);
}

export function preflight(
  req: dntShim.Request,
  config?: {
    allowMethods?: string | string[];
    allowHeaders?: string | string[];
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
  },
): dntShim.Response {
  const builder = createBuilder(req, config);

  builder.withAllow(config?.allowMethods ?? "GET,POST,PUT,PATCH,DELETE,OPTIONS");

  const headers = config?.allowHeaders ??
    req.headers.get("access-control-request-headers") ??
    "Content-Type,Authorization";

  builder.headers.set(
    "Access-Control-Allow-Headers",
    Array.isArray(headers) ? headers.join(", ") : headers,
  );

  return builder.build(null, 204);
}

export function stream(
  streamData: ReadableStream,
  req: dntShim.Request,
  config?: {
    contentType?: string;
    securityConfig?: SecurityConfig | null;
    corsConfig?: boolean | CORSConfig;
    cache?: CacheStrategy;
  },
): dntShim.Response {
  const builder = createBuilder(req, config);
  return builder.withContentType(config?.contentType ?? "application/octet-stream", streamData);
}
