import type { Middleware } from "../types.ts";
import type { CSPDirectives, SecurityHeadersOptions } from "./types.ts";

export function securityHeaders(options?: SecurityHeadersOptions): Middleware {
  return async (_ctx, next) => {
    const res = await next();
    if (!res) return res;
    const headers = new Headers(res.headers);

    if (options?.noSniff !== false) {
      headers.set("X-Content-Type-Options", "nosniff");
    }

    headers.set("X-Frame-Options", options?.frameOptions ?? "DENY");

    const referrerPolicy = options?.referrerPolicy ?? "strict-origin-when-cross-origin";
    headers.set("Referrer-Policy", referrerPolicy);

    const permissionsPolicy = options?.permissionsPolicy ??
      "geolocation=(), microphone=(), camera=()";
    headers.set("Permissions-Policy", permissionsPolicy);

    if (options?.contentSecurityPolicy) {
      const csp = buildCSPHeader(options.contentSecurityPolicy);
      headers.set("Content-Security-Policy", csp);
    }

    if (options?.hsts) {
      const hstsValue = buildHSTSHeader(options.hsts);
      headers.set("Strict-Transport-Security", hstsValue);
    }

    return new Response(res.body, { status: res.status, headers });
  };
}

function buildCSPHeader(csp: string | CSPDirectives): string {
  if (typeof csp === "string") {
    return csp;
  }
  return Object.entries(csp)
    .map(([k, v]) => `${k} ${v}`)
    .join("; ");
}

function buildHSTSHeader(hsts: {
  maxAge: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}): string {
  let hstsValue = `max-age=${hsts.maxAge}`;
  if (hsts.includeSubDomains) {
    hstsValue += "; includeSubDomains";
  }
  if (hsts.preload) {
    hstsValue += "; preload";
  }
  return hstsValue;
}
