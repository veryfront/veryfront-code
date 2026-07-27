import type { Middleware } from "../types.ts";
import type { SecurityHeadersOptions } from "./types.ts";
import { serializeCSPDirectives } from "./csp.ts";

function requireOptionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`Security headers ${name} must be a boolean`);
  }
  return value as boolean | undefined;
}

function requireOptionalString(value: unknown, name: string): string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`Security headers ${name} must be a string`);
  }
  return value as string | undefined;
}

function normalizeHSTS(
  value: unknown,
): {
  maxAge: number;
  includeSubDomains?: boolean;
  preload?: boolean;
} | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Security headers hsts must be an options object");
  }

  const hsts = value as {
    maxAge?: unknown;
    includeSubDomains?: unknown;
    preload?: unknown;
  };
  if (
    typeof hsts.maxAge !== "number" ||
    !Number.isSafeInteger(hsts.maxAge) ||
    hsts.maxAge < 0
  ) {
    throw new RangeError(
      "Security headers hsts.maxAge must be a non-negative safe integer",
    );
  }

  const includeSubDomains = requireOptionalBoolean(
    hsts.includeSubDomains,
    "hsts.includeSubDomains",
  );
  const preload = requireOptionalBoolean(hsts.preload, "hsts.preload");
  return {
    maxAge: hsts.maxAge,
    ...(includeSubDomains === undefined ? {} : { includeSubDomains }),
    ...(preload === undefined ? {} : { preload }),
  };
}

export function securityHeaders(options?: SecurityHeadersOptions): Middleware {
  if (
    options !== undefined &&
    (typeof options !== "object" || options === null || Array.isArray(options))
  ) {
    throw new TypeError("Security headers configuration must be an options object");
  }

  const noSniff = requireOptionalBoolean(options?.noSniff, "noSniff");
  const xssProtection = requireOptionalBoolean(
    options?.xssProtection,
    "xssProtection",
  );
  const frameOptions = requireOptionalString(
    options?.frameOptions,
    "frameOptions",
  );
  const referrerPolicy = requireOptionalString(
    options?.referrerPolicy,
    "referrerPolicy",
  );
  const permissionsPolicy = requireOptionalString(
    options?.permissionsPolicy,
    "permissionsPolicy",
  );
  const csp = options?.contentSecurityPolicy;
  if (
    csp !== undefined &&
    typeof csp !== "string" &&
    (typeof csp !== "object" || csp === null || Array.isArray(csp))
  ) {
    throw new TypeError(
      "Security headers contentSecurityPolicy must be a string or directives object",
    );
  }
  const hsts = normalizeHSTS(options?.hsts);

  const configuredHeaders = new Headers();
  if (noSniff !== false) {
    configuredHeaders.set("X-Content-Type-Options", "nosniff");
  }
  if (xssProtection === true) {
    configuredHeaders.set("X-XSS-Protection", "1; mode=block");
  }

  configuredHeaders.set("X-Frame-Options", frameOptions ?? "DENY");
  configuredHeaders.set(
    "Referrer-Policy",
    referrerPolicy ?? "strict-origin-when-cross-origin",
  );
  configuredHeaders.set(
    "Permissions-Policy",
    permissionsPolicy ?? "geolocation=(), microphone=(), camera=()",
  );

  if (csp) {
    configuredHeaders.set(
      "Content-Security-Policy",
      typeof csp === "string" ? csp : serializeCSPDirectives(csp),
    );
  }

  if (hsts) {
    configuredHeaders.set("Strict-Transport-Security", buildHSTSHeader(hsts));
  }

  return async (_ctx, next) => {
    const res = await next();
    if (!res) return res;

    const headers = new Headers(res.headers);
    for (const [name, value] of configuredHeaders) headers.set(name, value);

    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
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
