import type { Middleware } from "../types.ts";
import type { SecurityHeadersOptions } from "./types.ts";
import {
  assertSafeHeaderValue,
  buildCSPHeader,
  updateResponseHeaders,
} from "./response-headers.ts";

export function securityHeaders(options?: SecurityHeadersOptions): Middleware {
  if (
    options !== undefined &&
    (options === null || typeof options !== "object" || Array.isArray(options))
  ) {
    throw new TypeError("security header options must be an object");
  }
  if (options?.noSniff !== undefined && typeof options.noSniff !== "boolean") {
    throw new TypeError("noSniff must be a boolean");
  }
  if (options?.xssProtection !== undefined && typeof options.xssProtection !== "boolean") {
    throw new TypeError("xssProtection must be a boolean");
  }
  const configuredHeaders = new Map<string, string>();
  if (options?.noSniff !== false) {
    configuredHeaders.set("X-Content-Type-Options", "nosniff");
  }
  configuredHeaders.set("X-Frame-Options", options?.frameOptions ?? "DENY");
  configuredHeaders.set(
    "Referrer-Policy",
    options?.referrerPolicy ?? "strict-origin-when-cross-origin",
  );
  configuredHeaders.set(
    "Permissions-Policy",
    options?.permissionsPolicy ?? "geolocation=(), microphone=(), camera=()",
  );
  if (options?.xssProtection === true) {
    configuredHeaders.set("X-XSS-Protection", "1; mode=block");
  }

  const csp = options?.contentSecurityPolicy;
  if (csp !== undefined) {
    configuredHeaders.set(
      "Content-Security-Policy",
      typeof csp === "string" ? csp : buildCSPHeader(csp),
    );
  }

  const hsts = options?.hsts;
  if (hsts !== undefined) {
    if (typeof hsts !== "object" || hsts === null || Array.isArray(hsts)) {
      throw new TypeError("hsts must be an object");
    }
    configuredHeaders.set("Strict-Transport-Security", buildHSTSHeader(hsts));
  }

  for (const [name, value] of configuredHeaders) assertSafeHeaderValue(name, value);

  return async (_ctx, next) => {
    const res = await next();
    if (!res) return res;
    return updateResponseHeaders(res, (headers) => {
      for (const [name, value] of configuredHeaders) headers.set(name, value);
    });
  };
}

function buildHSTSHeader(hsts: {
  maxAge: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}): string {
  if (!Number.isSafeInteger(hsts.maxAge) || hsts.maxAge < 0) {
    throw new TypeError("HSTS maxAge must be a non-negative safe integer");
  }
  if (
    hsts.includeSubDomains !== undefined &&
    typeof hsts.includeSubDomains !== "boolean"
  ) {
    throw new TypeError("HSTS includeSubDomains must be a boolean");
  }
  if (hsts.preload !== undefined && typeof hsts.preload !== "boolean") {
    throw new TypeError("HSTS preload must be a boolean");
  }
  const parts = [`max-age=${hsts.maxAge}`];

  if (hsts.includeSubDomains) parts.push("includeSubDomains");
  if (hsts.preload) parts.push("preload");

  return parts.join("; ");
}
