
import { applyCORSHeaders, applyCORSHeadersSync } from "../cors/index.ts";
import { applySecurityHeaders } from "./security-handler.ts";
import { buildCacheControl } from "./cache-handler.ts";
import type { CacheStrategy, CORSConfig, SecurityConfig } from "./types.ts";

export interface FluentMethodsContext {
  headers: Headers;
  status: number;
  securityConfig: SecurityConfig | null;
  isDev: boolean;
  nonce: string;
  cspUserHeader: string | null;
  adapter: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter | undefined;
}

export function withCORS<T extends FluentMethodsContext>(
  this: T,
  req: Request,
  corsConfig?: boolean | CORSConfig,
): T {
  const config = corsConfig ?? this.securityConfig?.cors;
  applyCORSHeadersSync({
    request: req,
    headers: this.headers,
    config,
  });
  return this;
}

export function withCORSAsync<T extends FluentMethodsContext>(
  this: T,
  req: Request,
): Promise<T> {
  return applyCORSHeaders({
    request: req,
    headers: this.headers,
    config: this.securityConfig?.cors,
  }).then(() => this);
}

export function withSecurity<T extends FluentMethodsContext>(
  this: T,
  config?: SecurityConfig,
): T {
  const cfg = config ?? this.securityConfig;
  applySecurityHeaders(
    this.headers,
    this.isDev,
    this.nonce,
    this.cspUserHeader,
    cfg,
    this.adapter,
  );
  return this;
}

export function withCache<T extends FluentMethodsContext>(
  this: T,
  strategy: CacheStrategy,
): T {
  const cacheControl = buildCacheControl(strategy);
  this.headers.set("cache-control", cacheControl);
  return this;
}

export function withETag<T extends FluentMethodsContext>(
  this: T,
  etag: string,
): T {
  this.headers.set("ETag", etag);
  return this;
}

export function withHeaders<T extends FluentMethodsContext>(
  this: T,
  headers: HeadersInit | Record<string, string>,
): T {
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      this.headers.set(key, value);
    });
  } else if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      this.headers.set(key, value);
    });
  } else {
    Object.entries(headers).forEach(([key, value]) => {
      this.headers.set(key, value);
    });
  }
  return this;
}

export function withStatus<T extends FluentMethodsContext>(
  this: T,
  status: number,
): T {
  this.status = status;
  return this;
}

export function withAllow<T extends FluentMethodsContext>(
  this: T,
  methods: string | string[],
): T {
  const methodStr = Array.isArray(methods) ? methods.join(", ") : methods;
  this.headers.set("Allow", methodStr);
  this.headers.set("Access-Control-Allow-Methods", methodStr);
  return this;
}
