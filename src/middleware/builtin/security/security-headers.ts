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
    headers.set(
      "Referrer-Policy",
      options?.referrerPolicy ?? "strict-origin-when-cross-origin",
    );
    headers.set(
      "Permissions-Policy",
      options?.permissionsPolicy ?? "geolocation=(), microphone=(), camera=()",
    );

    const csp = options?.contentSecurityPolicy;
    if (csp) {
      headers.set("Content-Security-Policy", buildCSPHeader(csp));
    }

    const hsts = options?.hsts;
    if (hsts) {
      headers.set("Strict-Transport-Security", buildHSTSHeader(hsts));
    }

    return new Response(res.body, { status: res.status, headers });
  };
}

function buildCSPHeader(csp: string | CSPDirectives): string {
  if (typeof csp === "string") return csp;

  return Object.entries(csp)
    .map(([k, v]) => `${k} ${v}`)
    .join("; ");
}

function buildHSTSHeader(hsts: {
  maxAge: number;
  includeSubDomains?: boolean;
  preload?: boolean;
}): string {
  const parts = [`max-age=${hsts.maxAge}`];

  if (hsts.includeSubDomains) parts.push("includeSubDomains");
  if (hsts.preload) parts.push("preload");

  return parts.join("; ");
}
