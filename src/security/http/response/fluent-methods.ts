/**
 * ResponseBuilder - Fluent Builder Methods
 * Fluent methods for configuring response builder state
 */

import { applyCORSHeaders, applyCORSHeadersSync } from "../cors/index.ts";
import { applySecurityHeaders } from "./security-handler.ts";
import { buildCacheControl } from "./cache-handler.ts";
import type { CacheStrategy, CORSConfig, SecurityConfig } from "./types.ts";

/**
 * Internal state interface for fluent methods
 */
export interface FluentMethodsContext {
  headers: Headers;
  status: number;
  securityConfig: SecurityConfig | null;
  isDev: boolean;
  nonce: string;
  cspUserHeader: string | null;
  adapter: import("@veryfront/platform/adapters/base.ts").RuntimeAdapter | undefined;
  studioEmbed: boolean;
}

/**
 * Apply CORS headers based on configuration
 */
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

/**
 * Apply CORS headers asynchronously (for loading config)
 */
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

/**
 * Apply security headers (CSP, COOP, CORP, COEP)
 */
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
    this.studioEmbed,
  );
  return this;
}

/**
 * Apply cache control headers based on strategy
 */
export function withCache<T extends FluentMethodsContext>(
  this: T,
  strategy: CacheStrategy,
): T {
  const cacheControl = buildCacheControl(strategy);
  this.headers.set("cache-control", cacheControl);
  return this;
}

/**
 * Set ETag header
 */
export function withETag<T extends FluentMethodsContext>(
  this: T,
  etag: string,
): T {
  this.headers.set("ETag", etag);
  return this;
}

/**
 * Set custom headers
 */
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

/**
 * Set response status
 */
export function withStatus<T extends FluentMethodsContext>(
  this: T,
  status: number,
): T {
  this.status = status;
  return this;
}

/**
 * Apply Client Hints headers for theme detection
 * This enables browser to send Sec-CH-Prefers-Color-Scheme header
 * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Sec-CH-Prefers-Color-Scheme
 */
export function withClientHints<T extends FluentMethodsContext>(
  this: T,
): T {
  // Tell browser we accept color scheme hints
  this.headers.set("Accept-CH", "Sec-CH-Prefers-Color-Scheme");
  // Vary response by color scheme for correct caching
  const existingVary = this.headers.get("Vary");
  const varyValue = existingVary
    ? `${existingVary}, Sec-CH-Prefers-Color-Scheme`
    : "Sec-CH-Prefers-Color-Scheme";
  this.headers.set("Vary", varyValue);
  return this;
}

/**
 * Set Allow header for OPTIONS requests
 */
export function withAllow<T extends FluentMethodsContext>(
  this: T,
  methods: string | string[],
): T {
  const methodStr = Array.isArray(methods) ? methods.join(", ") : methods;
  this.headers.set("Allow", methodStr);
  this.headers.set("Access-Control-Allow-Methods", methodStr);
  return this;
}
